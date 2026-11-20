import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertOwnsMerchant } from "@/lib/ownership";
import { decrypt, encrypt } from "@/lib/crypto";
import { applyImport } from "./apply";
import { ImportApiError } from "./http";
import { fetchProgram } from "./sources";
import { IMPORT_SOURCES, type CampaignMapping, type FetchedProgram, type ImportSourceKey } from "./types";

/**
 * An import runs in the worker, in two steps the Owner sits between: reading
 * the other tool's API, then, once they have checked what came back and
 * picked a program for each campaign, writing it. Both can take minutes.
 */

/** How long a job may run before another worker takes it over, as after a crash. */
const LEASE_MS = 60 * 60 * 1000;

/** A job a worker took this many times without finishing is failed rather than taken again. */
const MAX_ATTEMPTS = 3;

export type StartResult = { error: string } | { error: null; id: string };

export async function startImport(
  ownerId: string,
  merchantId: string,
  source: ImportSourceKey,
  apiKey: string,
  accountId: string | null,
  currency: string | null = null
): Promise<StartResult> {
  await assertOwnsMerchant(ownerId, merchantId);
  const key = apiKey.trim();
  if (!key || key.length > 500) return { error: "Paste the API key." };
  const account = accountId?.trim() || null;
  const accountCurrency = currency?.trim().toLowerCase() || null;
  if (IMPORT_SOURCES[source].needsAccountId) {
    if (!account || account.length > 100) return { error: "Paste the account ID too." };
    if (!accountCurrency || !/^[a-z]{3}$/.test(accountCurrency)) return { error: "Enter the account's currency, like USD." };
  }
  const running = await db.import.findFirst({
    where: { merchantId, status: { in: ["FETCHING", "IMPORTING"] } },
    select: { id: true },
  });
  if (running) return { error: "An import is already running on this product." };

  const created = await db.import.create({
    data: {
      merchantId,
      source,
      apiKeyEnc: encrypt(key),
      accountRef: account,
      currency: IMPORT_SOURCES[source].needsAccountId ? accountCurrency : null,
    },
    select: { id: true },
  });
  // Wakes the worker now rather than at its next poll.
  await db.$executeRaw`SELECT pg_notify('webhook_event_inserted', '')`.catch(() => {});
  return { error: null, id: created.id };
}

/**
 * The Owner's go, with a program of this product for each campaign. Only a
 * read import waiting for it moves on.
 */
export async function confirmImport(
  ownerId: string,
  merchantId: string,
  importId: string,
  mapping: CampaignMapping
): Promise<boolean> {
  await assertOwnsMerchant(ownerId, merchantId);
  const programs = new Set(
    (await db.program.findMany({ where: { merchantId }, select: { id: true } })).map((p) => p.id)
  );
  const clean: CampaignMapping = {};
  for (const [campaign, program] of Object.entries(mapping)) {
    if (typeof program === "string" && programs.has(program)) clean[campaign] = program;
  }
  // A failed write can be run again: what it wrote is matched, not repeated.
  const { count } = await db.import.updateMany({
    where: { id: importId, merchantId, status: { in: ["READY", "FAILED"] }, NOT: { fetched: { equals: Prisma.DbNull } } },
    data: { status: "IMPORTING", mapping: clean, claimedAt: null, attempts: 0 },
  });
  if (count > 0) await db.$executeRaw`SELECT pg_notify('webhook_event_inserted', '')`.catch(() => {});
  return count > 0;
}

/** Drops a read import the Owner does not want, and what was read with it. */
export async function discardImport(ownerId: string, merchantId: string, importId: string): Promise<void> {
  await assertOwnsMerchant(ownerId, merchantId);
  await db.import.deleteMany({ where: { id: importId, merchantId, status: { in: ["READY", "FAILED"] } } });
}

/** The product's latest import, without what was read: the page asks for that only when it shows it. */
export async function latestImport(ownerId: string, merchantId: string) {
  await assertOwnsMerchant(ownerId, merchantId);
  const job = await db.import.findFirst({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, source: true, status: true, summary: true, error: true, createdAt: true },
  });
  if (!job) return null;
  const read = await db.import.count({ where: { id: job.id, NOT: { fetched: { equals: Prisma.DbNull } } } });
  return { ...job, hasFetched: read > 0 };
}

export async function importFetched(ownerId: string, merchantId: string, importId: string): Promise<FetchedProgram | null> {
  await assertOwnsMerchant(ownerId, merchantId);
  const job = await db.import.findFirst({ where: { id: importId, merchantId }, select: { fetched: true } });
  return (job?.fetched as unknown as FetchedProgram) ?? null;
}

/** Takes the oldest job waiting on the worker, or one whose worker stopped. */
async function claim(): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Import" SET "claimedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "Import"
      WHERE status IN ('FETCHING', 'IMPORTING')
        AND ("claimedAt" IS NULL OR "claimedAt" < now() - make_interval(secs => ${LEASE_MS / 1000}))
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

function reasonOf(err: unknown): string {
  if (err instanceof ImportApiError) return err.message;
  console.error("[worker] import failed", err);
  return "The import stopped on an error. The server log has the details.";
}

async function runOne(id: string): Promise<void> {
  const job = await db.import.findUniqueOrThrow({
    where: { id },
    include: { merchant: { select: { id: true, paymentProvider: true, paymentKeyEnc: true } } },
  });
  const source = job.source as ImportSourceKey;
  if (job.attempts > MAX_ATTEMPTS) {
    await db.import.update({
      where: { id },
      data: { status: "FAILED", error: "The import kept stopping before it finished. The server log has the details.", apiKeyEnc: null },
    });
    return;
  }

  if (job.status === "FETCHING") {
    try {
      if (!job.apiKeyEnc) throw new ImportApiError("The API key is gone. Start again.");
      const fetched = await fetchProgram(source, decrypt(job.apiKeyEnc), job.accountRef, job.currency);
      await db.import.update({
        where: { id },
        data: { status: "READY", fetched: fetched as unknown as Prisma.InputJsonValue, apiKeyEnc: null, accountRef: null, attempts: 0 },
      });
    } catch (err) {
      await db.import.update({
        where: { id },
        data: { status: "FAILED", error: reasonOf(err), apiKeyEnc: null, accountRef: null },
      });
    }
    return;
  }

  try {
    const summary = await applyImport(
      job.merchant,
      source,
      job.fetched as unknown as FetchedProgram,
      (job.mapping ?? {}) as CampaignMapping
    );
    // What was read is let go once written: it holds every affiliate's email.
    await db.import.update({
      where: { id },
      data: { status: "DONE", summary: summary as unknown as Prisma.InputJsonValue, fetched: Prisma.DbNull },
    });
  } catch (err) {
    // What was written stays: running it again writes only the rest.
    await db.import.update({ where: { id }, data: { status: "FAILED", error: reasonOf(err) } });
  }
}

let running = false;

/** Runs every job waiting, one at a time. Called on each worker tick. */
export async function runImports(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let id = await claim(); id; id = await claim()) await runOne(id);
  } finally {
    running = false;
  }
}
