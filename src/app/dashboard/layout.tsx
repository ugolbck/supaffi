import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";
import { getProductSetup, sectionGates } from "@/lib/productSetup";
import { availableUpdate, installedVersion } from "@/lib/version";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { DashboardBreadcrumb } from "./DashboardBreadcrumb";

// Defense-in-depth: every page under /dashboard already checks role itself
// (added during the Affiliate Auth plan). This layout-level check is an
// additional, cheap guard — it does not replace the per-page checks, which
// stay as-is.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchants = await listMerchantsForOwner(ownerId);

  // One setup read per product, on every dashboard navigation. Precedented:
  // the products home already does exactly this per merchant. The sidebar
  // cannot compute the gates itself (it is a client component), and a section
  // that reads unlocked while its page redirects is worse than the query.
  const gates = await Promise.all(
    merchants.map(async (merchant) => ({
      slug: merchant.slug,
      ...sectionGates(await getProductSetup(ownerId, merchant.id)),
    }))
  );

  // Answers from cache and never waits on the network, so a server that cannot
  // reach GitHub does not pay for the check on every dashboard load. A stale
  // cache refreshes in the background and the notice appears on the next
  // navigation.
  const update = availableUpdate();

  return (
    <SidebarProvider>
      <AppSidebar
        merchants={merchants}
        gates={gates}
        email={session.user.email ?? ""}
        version={installedVersion()}
        update={update && { version: update.version, url: update.url, security: update.security }}
      />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-elevated/70 px-6 backdrop-blur-md backdrop-saturate-150">
          <SidebarTrigger />
          <div className="h-4 w-px shrink-0 bg-border" />
          <DashboardBreadcrumb merchants={merchants} />
        </header>
        <div className="flex flex-1 flex-col overflow-y-auto p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
