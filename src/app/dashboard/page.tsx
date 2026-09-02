import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { Button } from "@/components/ui/button";

/**
 * The product list, and nothing else.
 *
 * Setup used to live here as a one-time wizard, which only worked while there
 * was exactly one product: a checklist on this page has no way to say which
 * product it means. Everything after "add a product" now lives on that
 * product's own page, and this page only has to get the Owner there.
 */
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchants = await listMerchantsForOwner(ownerId);
  const setups = await Promise.all(merchants.map((m) => getProductSetup(ownerId, m.id)));

  // Adding the first product is the one step that belongs to the account
  // rather than to a product, so it is the only thing this page ever asks for.
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
          <Button size="lg">Add your product</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            {merchants.length === 1 ? "1 product" : `${merchants.length} products`}
          </p>
        </div>
        <Link href="/dashboard/products/new">
          <Button>
            <Plus />
            Add product
          </Button>
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        {merchants.map((merchant, i) => {
          const setup = setups[i];

          return (
            <Link
              key={merchant.id}
              href={`/dashboard/products/${merchant.id}`}
              // Only transform and box-shadow transition, never `all`.
              className="group/product flex animate-in cursor-pointer flex-col gap-3 fill-mode-both fade-in slide-in-from-bottom-2 rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] p-4 shadow-[var(--edge-light),var(--shadow-sm)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-[var(--edge-light),var(--shadow-lg)] active:scale-[0.995]"
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-heading text-base font-semibold tracking-tight">
                    {merchant.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{merchant.domain}</span>
                </div>

                {setup.complete ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-status-success-bg px-2 py-0.5 text-xs font-medium text-status-success">
                    <Check className="size-3" strokeWidth={3} />
                    Live
                  </span>
                ) : (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                    {setup.doneCount} of {setup.totalSteps} set up
                  </span>
                )}
              </div>

              {/* Progress only while there is progress left to make. A finished
                  product does not need a full bar explaining that it is full. */}
              {!setup.complete && (
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-[var(--ease-out)]"
                    style={{ width: `${(setup.doneCount / setup.totalSteps) * 100}%` }}
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {setup.affiliateCount === 1
                    ? "1 affiliate"
                    : `${setup.affiliateCount} affiliates`}
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-foreground opacity-0 transition-opacity duration-200 ease-[var(--ease-out)] group-hover/product:opacity-100">
                  {setup.complete ? "Open" : "Finish setup"}
                  <ArrowRight className="size-3" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
