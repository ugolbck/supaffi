import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOwner } from "@/app/requireOwner";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import { importFetched, latestImport } from "@/lib/import/jobs";
import { previewImport } from "@/lib/import/preview";
import { IMPORT_SOURCES, type ImportSourceKey, type ImportSummary } from "@/lib/import/types";
import { formatCount, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { StartImportForm } from "./StartImportForm";
import { Refresher } from "./Refresher";
import { confirmImportAction, discardImportAction, inviteAction, startImportAction } from "./importActions";

/**
 * Moving a program over from Rewardful, Tolt, FirstPromoter or Affonso: read
 * it through the tool's API, check what came back, pick a program for each
 * campaign, then write it. Old links keep working, and affiliates hear nothing
 * until the Owner invites them.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-neutral-200 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

function money(rows: { currency: string; total: string; count: number }[]): string {
  if (rows.length === 0) return "None";
  return rows.map((r) => `${formatMoney(r.total, r.currency)} (${formatCount(r.count)})`).join(", ");
}

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ invited?: string; new?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const ownerId = await requireOwner();
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const productRef = { id: merchant.id, slug: merchant.slug };
  const job = await latestImport(ownerId, merchant.id);
  const label = job ? IMPORT_SOURCES[job.source as ImportSourceKey].label : null;
  // A new import once the last one is done, from the same tool or another.
  const showForm =
    !job || (job.status === "FAILED" && !job.hasFetched) || (query.new === "1" && job.status === "DONE");

  if (showForm) {
    return (
      <Page>
        <PageTitle title="Import" />
        {job?.status === "FAILED" && job.error && <p className="text-[13px] text-status-warning">{job.error}</p>}
        <StartImportForm action={startImportAction.bind(null, productRef)} />
      </Page>
    );
  }

  if (job.status === "FETCHING" || job.status === "IMPORTING") {
    return (
      <Page>
        <PageTitle title="Import" />
        <Refresher />
        <Section>
          <p className="text-sm">
            {job.status === "FETCHING" ? `Reading your ${label} program.` : `Importing from ${label}.`} This can take a few
            minutes. You can leave this page.
          </p>
        </Section>
      </Page>
    );
  }

  if (job.status === "DONE") {
    const s = job.summary as unknown as ImportSummary;
    const invited = query.invited === "off" ? "Email is off for this product. Turn it on in Settings first." : query.invited ? `${formatCount(Number(query.invited))} invited.` : null;
    return (
      <Page>
        <PageTitle title="Import" subtitle={`Imported from ${label}`} />
        <Section title="Done" className="max-w-lg">
          <Row label="Affiliates added" value={formatCount(s.affiliatesCreated)} />
          <Row label="Already here, kept" value={formatCount(s.affiliatesMatched)} />
          <Row label="Referred customers" value={formatCount(s.referrals)} />
          <Row label="Subscriptions still earning" value={formatCount(s.subscriptionsLinked)} />
          <Row label="Commissions owed" value={formatCount(s.commissionsOwed)} />
          <Row label="Commissions paid" value={formatCount(s.commissionsPaid)} />
          {s.codesTaken.length > 0 && <Row label="Codes another product uses" value={s.codesTaken.join(", ")} />}
          {s.codesInvalid?.length > 0 && <Row label="Codes not valid here" value={s.codesInvalid.join(", ")} />}
        </Section>
        <div className="flex max-w-lg flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Affiliates were not emailed. Invite them once your site runs this product&apos;s tracking script.
          </p>
          {invited && <p className="text-[13px] text-muted-foreground">{invited}</p>}
          <div className="flex gap-2">
            <form action={inviteAction.bind(null, productRef)}>
              <Button type="submit" className="cursor-pointer">
                Invite affiliates to set a password
              </Button>
            </form>
            <Button variant="ghost" className="cursor-pointer" render={<Link href="?new=1" />}>
              Import again
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  // READY, or a write that failed and can be run again.
  const fetched = await importFetched(ownerId, merchant.id, job.id);
  if (!fetched) notFound();
  const [preview, programs] = await Promise.all([
    previewImport(merchant, job.source as ImportSourceKey, fetched),
    listProgramsForMerchant(ownerId, merchant.id),
  ]);
  const items = Object.fromEntries(programs.map((p) => [p.id, p.name]));

  return (
    <Page>
      <PageTitle title="Import" subtitle={`Read from ${label}. Nothing is written yet.`} />
      {job.status === "FAILED" && job.error && <p className="text-[13px] text-status-warning">{job.error}</p>}
      <form action={confirmImportAction.bind(null, productRef, job.id)} className="flex max-w-lg flex-col gap-5">
        <Section title="What comes over">
          <Row label="Affiliates" value={formatCount(preview.affiliates)} />
          {preview.existingEmails > 0 && <Row label="Already here, kept" value={formatCount(preview.existingEmails)} />}
          <Row label="Referred customers" value={formatCount(preview.referrals)} />
          <Row label="Subscriptions that keep earning" value={formatCount(preview.renewalsLinkable)} />
          <Row label="Owed" value={money(preview.owed)} />
          <Row label="Paid" value={money(preview.paid)} />
          {preview.alreadyImported > 0 && <Row label="Imported before, skipped" value={formatCount(preview.alreadyImported)} />}
          {preview.codesTaken.length > 0 && (
            <Row label="Codes another product uses, replaced" value={preview.codesTaken.join(", ")} />
          )}
          {preview.codesInvalid.length > 0 && (
            <Row label="Codes not valid here, replaced" value={preview.codesInvalid.join(", ")} />
          )}
        </Section>
        {preview.campaigns.length > 0 && (
          <Section title="Programs">
            <div className="flex flex-col gap-3">
              {preview.campaigns.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="min-w-0 truncate">
                    {c.name} <span className="text-muted-foreground">({formatCount(c.affiliates)})</span>
                  </span>
                  <Select name={`program:${c.id}`} items={items} defaultValue={programs[0]?.id}>
                    <SelectTrigger className="h-9 w-48 cursor-pointer" aria-label={`Program for ${c.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {programs.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="cursor-pointer">
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </Section>
        )}
        <div className="flex gap-2">
          <Button type="submit" className="cursor-pointer">
            Import
          </Button>
          <Button type="submit" variant="ghost" className="cursor-pointer" formAction={discardImportAction.bind(null, productRef, job.id)}>
            Start over
          </Button>
        </div>
      </form>
    </Page>
  );
}
