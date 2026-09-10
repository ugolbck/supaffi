import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";
import type { CommissionDurationType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import { runProductChecks } from "@/lib/checks/product";
import { deliveryMode } from "@/lib/email/transport";
import type { ProgramFormValues } from "@/lib/programValidation";
import { originFor } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { Page, PageTitle } from "@/components/dashboard/Page";
import { ProgramCard } from "@/components/dashboard/ProgramCard";
import { ProgramSheet } from "./ProgramSheet";
import { createProgramAction, updateProgramAction } from "./programActions";

/**
 * Every set of terms this product offers, one card each, with creating and
 * editing in a sheet the URL opens: ?new=1 for a fresh one, ?edit=<id> for an
 * existing one. The two routes those used to be redirect here, so a bookmark
 * still lands on the right panel.
 *
 * A signup link handed out before the sending domain is verified takes
 * affiliates as far as the form and no further: the login email cannot leave
 * the instance. Onboarding lets an Owner finish with that still pending,
 * because verification can take hours and is not theirs to hurry, so the
 * consequence is carried to the one screen where the link is copied.
 */

type Program = {
  id: string;
  slug: string;
  name: string;
  defaultCommissionRate: unknown;
  commissionDurationType: CommissionDurationType;
  commissionDurationMonths: number | null;
  attributionWindowDays: number;
  holdingPeriodDays: number;
  affiliateCount: number;
};

/**
 * Whether the login email would fail today. Live rather than a stored flag: a
 * domain unverified in Resend this morning is verified this afternoon without
 * anything here writing a row. `runProductChecks` serves a section it ran less
 * than a minute ago from its own cache, so visiting this page costs nothing on
 * the second visit. An instance that prints its email has no domain to verify
 * and no warning to give.
 */
async function sendingDomainPending(ownerId: string, merchantId: string, programCount: number): Promise<boolean> {
  if (programCount === 0 || deliveryMode() !== "send") return false;
  const checks = await runProductChecks(ownerId, merchantId);
  return !(checks.email.key.ok && checks.email.domain.ok);
}

function durationLabel(p: Program): string {
  if (p.commissionDurationType === "FOREVER") return "forever";
  if (p.commissionDurationType === "ONE_TIME") return "on the first payment";
  // The month count is nullable in the schema even for FIXED_MONTHS, so this
  // says what is known rather than inventing a number.
  if (p.commissionDurationMonths === null) return "for a fixed term";
  return `for ${p.commissionDurationMonths} month${p.commissionDurationMonths === 1 ? "" : "s"}`;
}

function toFormValues(p: Program): ProgramFormValues {
  return {
    name: p.name,
    defaultCommissionRate: String(p.defaultCommissionRate),
    commissionDurationType: p.commissionDurationType,
    commissionDurationMonths: p.commissionDurationMonths
      ? String(p.commissionDurationMonths)
      : "",
    attributionWindowDays: String(p.attributionWindowDays),
    holdingPeriodDays: String(p.holdingPeriodDays),
  };
}

export default async function ProgramsPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ new?: string; edit?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const base = `/dashboard/products/${merchant.slug}/programs`;
  const programs = await listProgramsForMerchant(ownerId, merchant.id);
  const emailPending = await sendingDomainPending(ownerId, merchant.id, programs.length);
  const productRef = { id: merchant.id, slug: merchant.slug };

  // An id that names nothing opens nothing, rather than an empty form.
  const editing = query.edit ? programs.find((p) => p.id === query.edit) ?? null : null;

  return (
    <Page>
      <PageTitle
        title="Programs"
        actions={
          <Button className="cursor-pointer" render={<Link href={`${base}?new=1`} />}>
            <Plus data-icon="inline-start" /> New program
          </Button>
        }
      />

      {emailPending && (
        <p className="flex shrink-0 items-start gap-2.5 rounded-(--radius-md) border border-status-warning/30 bg-status-warning-bg px-4 py-2.5 text-[13px] text-neutral-700">
          <TriangleAlert className="mt-px size-4 shrink-0 text-status-warning" />
          <span>
            Affiliates can sign up but cannot log in until your sending domain is verified.{" "}
            <Link
              href={`/dashboard/products/${merchant.slug}/settings`}
              className="cursor-pointer font-medium text-status-warning underline decoration-status-warning/40 underline-offset-2 transition-colors hover:decoration-status-warning"
            >
              Check your email setup
            </Link>
          </span>
        </p>
      )}

      {/* Content sized rows, scrolling as a set: the cards say what they have
          to say and the page underneath them never scrolls. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto lg:grid-cols-2">
        {programs.map((p) => (
          <ProgramCard
            key={p.id}
            name={p.name}
            rate={String(p.defaultCommissionRate)}
            duration={durationLabel(p)}
            attributionDays={p.attributionWindowDays}
            holdingDays={p.holdingPeriodDays}
            affiliateCount={p.affiliateCount}
            signupLink={`${originFor(merchant.domain)}/affiliates/signup/${p.slug}`}
            editHref={`${base}?edit=${p.id}`}
          />
        ))}
      </div>

      {query.new && (
        <ProgramSheet
          title="New program"
          action={createProgramAction.bind(null, productRef)}
          listHref={base}
        />
      )}
      {editing && (
        <ProgramSheet
          title={`Edit ${editing.name}`}
          action={updateProgramAction.bind(null, productRef, editing.id)}
          initial={toFormValues(editing)}
          listHref={base}
        />
      )}
    </Page>
  );
}
