import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { CommissionDurationType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import type { ProgramFormValues } from "@/lib/programValidation";
import { originFor } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { ProgramSheet } from "./ProgramSheet";
import { createProgramAction, updateProgramAction } from "./programActions";

/**
 * Every set of terms this product offers, one card each, with creating and
 * editing in a sheet the URL opens: ?new=1 for a fresh one, ?edit=<id> for an
 * existing one. The two routes those used to be redirect here, so a bookmark
 * still lands on the right panel.
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

      {/* Content sized rows, scrolling as a set: the cards say what they have
          to say and the page underneath them never scrolls. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto lg:grid-cols-2">
        {programs.map((p) => (
          <Section key={p.id}>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-sm text-muted-foreground">
                  {String(p.defaultCommissionRate)}% {durationLabel(p)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.attributionWindowDays} day window, {p.holdingPeriodDays} day hold
                </p>
              </div>
              <p className="text-sm tabular-nums">
                {p.affiliateCount === 1 ? "1 affiliate" : `${p.affiliateCount} affiliates`}
              </p>
              <div className="flex items-center gap-2">
                <CopyLinkButton
                  link={`${originFor(merchant.domain)}/affiliates/signup/${p.slug}`}
                  size="sm"
                  label="Copy signup link"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer"
                  render={<Link href={`${base}?edit=${p.id}`} />}
                >
                  Edit
                </Button>
              </div>
            </div>
          </Section>
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
