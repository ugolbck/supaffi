import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Flag, Plug, Radio, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { getOwnerMetrics, getProductMetrics } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { PageShell, PageHeader, SignalRow, Band, cardGrid } from "@/components/dashboard/PageGrid";
import { StatTile } from "@/components/dashboard/StatTile";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { GhostCard } from "@/components/dashboard/GhostCard";
import { BarChart } from "@/components/charts/BarChart";
import { ProductCard } from "./ProductCard";

/**
 * Every product, and how the account as a whole is doing.
 *
 * Setup used to live here as a one-time wizard, which only worked while there
 * was exactly one product: a checklist on this page has no way to say which
 * product it means. Everything after "add a product" now lives on that
 * product's own page.
 */

function money(totals: { currency: string; total: string }[]): string {
  if (totals.length === 0) return "0.00";
  const [first] = totals;
  return `${first.total} ${first.currency.toUpperCase()}`;
}

function moneyHint(totals: { currency: string; total: string }[]): string | undefined {
  if (totals.length < 2) return undefined;
  return totals
    .slice(1)
    .map((t) => `${t.total} ${t.currency.toUpperCase()}`)
    .join("  ·  ");
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchants = await listMerchantsForOwner(ownerId);

  // Adding the first product is the one step that belongs to the account
  // rather than to a product, so it is the only thing this page ever asks for.
  // Also the one screen allowed a centred column, because there is genuinely
  // one thing to do and filling the viewport around it would be noise.
  if (merchants.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 py-20 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">
            Add your first product
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Everything else is set up per product, so this comes first.
          </p>
        </div>
        <Link href="/dashboard/products/new">
          <Button size="lg" className="cursor-pointer">
            Add your product
          </Button>
        </Link>
      </div>
    );
  }

  const [metrics, setups, perProduct] = await Promise.all([
    getOwnerMetrics(ownerId),
    Promise.all(merchants.map((m) => getProductSetup(ownerId, m.id))),
    Promise.all(merchants.map((m) => getProductMetrics(ownerId, m.id))),
  ]);

  // What is actually asking for the Owner's time, in the order it should be
  // dealt with. Money first, then anything silently not working.
  const attention: { icon: typeof Flag; text: string; href: string }[] = [];
  if (metrics.flagged > 0) {
    const first = merchants[0];
    attention.push({
      icon: Flag,
      text: `${metrics.flagged} flagged commission${metrics.flagged === 1 ? "" : "s"} to review`,
      href: `/dashboard/products/${first.slug}/commissions?status=FLAGGED`,
    });
  }
  merchants.forEach((merchant, i) => {
    const setup = setups[i];
    if (!setup.integrationsConnected) {
      attention.push({
        icon: Plug,
        text: `${merchant.name}: finish connecting your tools`,
        href: `/dashboard/products/${merchant.slug}/integrations`,
      });
    } else if (setup.trackingStatus === "not-started") {
      attention.push({
        icon: Radio,
        text: `${merchant.name}: tracking is not installed`,
        href: `/dashboard/products/${merchant.slug}/tracking`,
      });
    }
  });

  const grid = cardGrid(merchants.length);

  return (
    <PageShell>
      <PageHeader
        title="Products"
        subtitle={merchants.length === 1 ? "1 product" : `${merchants.length} products`}
        actions={
          <Link href="/dashboard/products/new">
            <Button className="cursor-pointer">
              <Plus />
              Add product
            </Button>
          </Link>
        }
      />

      <SignalRow columns={5}>
        <StatTile label="Products" value={String(metrics.products)} hint="on this instance" />
        <StatTile
          label="Affiliates"
          value={String(metrics.affiliates)}
          hint="across every product"
        />
        <StatTile
          label="Clicks, 30 days"
          value={String(metrics.clicks)}
          series={metrics.series.map((d) => d.clicks)}
        />
        <StatTile
          label="Owed"
          value={money(metrics.owed)}
          hint={moneyHint(metrics.owed)}
          tone={metrics.owed.length > 0 ? "success" : "neutral"}
        />
        <StatTile
          label="Needs you"
          value={String(attention.length)}
          hint={attention.length === 0 ? "all clear" : "open items"}
          tone={attention.length > 0 ? "warning" : "neutral"}
        />
      </SignalRow>

      <Band columns={grid.columns} scrolls>
        {merchants.map((merchant, i) => (
          <ProductCard
            key={merchant.id}
            name={merchant.name}
            domain={merchant.domain}
            slug={merchant.slug}
            setup={setups[i]}
            clicks={perProduct[i].clicks}
            series={perProduct[i].series.map((d) => d.clicks)}
            index={i}
          />
        ))}
        {/* Ends the row flush. One product would otherwise leave two holes. */}
        <GhostCard href="/dashboard/products/new" label="Add a product" span={grid.ghostSpan} />
      </Band>

      <Band>
        <DashboardCard
          title="Across all products"
          className="lg:col-span-8"
          action={<span className="text-xs text-muted-foreground">Last 30 days</span>}
        >
          {metrics.clicks === 0 && metrics.affiliates === 0 ? (
            <CardEmpty
              icon={Radio}
              title="No clicks yet. The first affiliate link someone follows shows up here."
            />
          ) : (
            <BarChart series={metrics.series} />
          )}
        </DashboardCard>

        <DashboardCard title="Needs your attention" className="lg:col-span-4" bodyScrolls>
          {attention.length === 0 ? (
            <CardEmpty icon={CheckCircle2} title="Everything is set up and nothing is waiting." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {attention.map((item) => (
                <li key={item.text}>
                  <Link
                    href={item.href}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted"
                  >
                    <item.icon className="mt-0.5 size-4 shrink-0 text-status-warning" />
                    <span className="min-w-0 flex-1 text-balance">{item.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </Band>
    </PageShell>
  );
}
