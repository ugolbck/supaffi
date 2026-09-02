import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";
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

  const merchants = await listMerchantsForOwner(session.user.id);

  return (
    <SidebarProvider>
      <AppSidebar merchants={merchants} email={session.user.email ?? ""} />
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
