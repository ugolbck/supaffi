import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "./AppSidebar";
import { DashboardBreadcrumb } from "./DashboardBreadcrumb";
import { AccountMenu } from "./AccountMenu";

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
      <AppSidebar merchants={merchants} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <DashboardBreadcrumb merchants={merchants} />
          <div className="flex-1" />
          <AccountMenu email={session.user.email ?? ""} />
        </header>
        <div className="flex flex-1 flex-col overflow-y-auto p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
