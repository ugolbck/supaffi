import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";
import { countAffiliatesForMerchant } from "@/lib/affiliate";
import { getProductMetrics } from "@/lib/analytics";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";

/**
 * Every product the owner has, one row each.
 *
 * The account-wide numbers that used to sit above this list are gone. They
 * summed across products that share nothing but an owner, so the row they
 * filled said less than the per-product rows underneath it.
 *
 * No empty state either: the layout redirects an owner with no products into
 * onboarding before this ever renders.
 */
export default async function ProductsPage() {
  const session = await auth();
  // The layout checks the role too. Kept here because every page under
  // /dashboard carries its own check and none of them lean on the layout.
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  const ownerId = session.user.id;
  const merchants = await listMerchantsForOwner(ownerId);

  // One product is not a list. Home is that product.
  if (merchants.length === 1) redirect(`/dashboard/products/${merchants[0].slug}`);

  const rows = await Promise.all(
    merchants.map(async (m) => {
      // `onboardingCompletedAt` rides along on the merchant row, so telling a
      // live product from one still in setup costs no query of its own.
      const [affiliates, metrics] = await Promise.all([
        countAffiliatesForMerchant(m.id),
        getProductMetrics(ownerId, m.id),
      ]);
      return {
        ...m,
        affiliates,
        owed: money(metrics.owed),
        live: m.onboardingCompletedAt !== null,
      };
    })
  );

  return (
    <Page>
      <PageTitle
        title="Products"
        actions={
          <Button className="cursor-pointer" render={<Link href="/onboarding" />}>
            <Plus data-icon="inline-start" /> Add a product
          </Button>
        }
      />
      {/* Flush, and clipped, so the rows are the card: they carry their own
          padding and their hover fill has to stop at the rounded corners.
          Scrolls inside itself because the dashboard layout is
          overflow-hidden, so a long list would otherwise be cut off with no
          way to reach the rest of it. */}
      <Section flush scroll className="overflow-hidden">
        <ul className="divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.id}>
              {/* A "setup" row lands on the product page, which redirects
                  into onboarding where that product stopped. */}
              <Link
                href={`/dashboard/products/${row.slug}`}
                className="flex cursor-pointer items-center gap-4 px-5 py-4 hover:bg-black/[0.02]"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-accent-700 text-xs font-semibold text-accent-100">
                  {row.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.domain}</span>
                </span>
                <span className="w-28 text-right text-sm tabular-nums">
                  {row.affiliates} affiliates
                </span>
                <span className="w-32 text-right text-sm tabular-nums">{row.owed} pending</span>
                <span
                  className={
                    row.live
                      ? "w-14 text-right text-xs text-status-success"
                      : "w-14 text-right text-xs text-status-warning"
                  }
                >
                  {row.live ? "live" : "setup"}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}
