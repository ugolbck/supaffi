import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";
import { countAffiliatesForMerchant } from "@/lib/affiliate";
import { listProgramsForMerchant } from "@/lib/program";
import { getCommissionTotals } from "@/lib/commission";
import { getTrackingStatus } from "@/lib/tracking";
import { availableUpdate, installedVersion } from "@/lib/version";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar, type Counts } from "./AppSidebar";

// Defense-in-depth: every page under /dashboard already checks role itself
// (added during the Affiliate Auth plan). This layout-level check is an
// additional, cheap guard — it does not replace the per-page checks, which
// stay as-is.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  const ownerId = session.user.id;

  const merchants = await listMerchantsForOwner(ownerId);

  // A dashboard with nothing in it is not a dashboard. Until a product
  // exists, the only screen that makes sense is the first onboarding step.
  if (merchants.length === 0) redirect("/onboarding");

  // Counted for every product, not just the open one. A layout does not
  // re-render when the user moves between two products, so a server-picked
  // active product would go stale the moment they switched; the sidebar reads
  // the active slug from the URL on the client and looks its counts up here.
  // An owner has a handful of products, and mutations elsewhere already call
  // revalidatePath("/dashboard", "layout"), which refreshes these.
  const counted = await Promise.all(
    merchants.map(async (m): Promise<[string, Counts]> => {
      const [affiliates, programs, totals, tracking] = await Promise.all([
        countAffiliatesForMerchant(m.id),
        listProgramsForMerchant(ownerId, m.id),
        getCommissionTotals(ownerId, m.id),
        getTrackingStatus(m.id),
      ]);
      return [
        m.slug,
        {
          affiliates,
          programs: programs.length,
          payable: totals.find((t) => t.status === "PAYABLE")?.count ?? 0,
          tracking,
        },
      ];
    })
  );
  const counts = Object.fromEntries(counted);

  // Answers from cache and never waits on the network, so a server that cannot
  // reach GitHub does not pay for the check on every dashboard load. A stale
  // cache refreshes in the background and the notice appears on the next
  // navigation.
  const update = availableUpdate();

  return (
    <SidebarProvider style={{ "--sidebar-width": "240px" } as React.CSSProperties}>
      <AppSidebar
        merchants={merchants}
        counts={counts}
        email={session.user.email ?? ""}
        version={installedVersion()}
        update={update && { version: update.version, url: update.url, security: update.security }}
      />
      <SidebarInset>
        {/* Views are built to fit, so this should never scroll. It is a
            safety net, not a layout: a view that does overflow scrolls rather
            than losing whatever sat below the fold. */}
        <div className="flex h-svh flex-col overflow-y-auto p-8">
          {/* The sidebar is a sheet below md, so it needs something to open
              it. Above md it is always on screen and this would be noise. */}
          <SidebarTrigger className="-mt-2 mb-2 self-start md:hidden" />
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
