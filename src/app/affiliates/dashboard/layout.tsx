import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { AffiliateSidebar } from "./AffiliateSidebar";

export default async function AffiliateDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email, merchant } = await requireAffiliate();

  return (
    <SidebarProvider>
      <AffiliateSidebar merchantName={merchant.name} email={email} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-elevated/70 px-6 backdrop-blur-md backdrop-saturate-150">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col overflow-y-auto p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
