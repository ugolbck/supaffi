import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { getAffiliatePayoutDetails } from "@/lib/affiliate";
import { AffiliateSidebar } from "./AffiliateSidebar";

/**
 * The same shell the owner dashboard has: the floating sidebar at the same
 * width, and a content area that is the viewport minus its padding, so a
 * screen is built to fit rather than to scroll.
 */

/** Just the host. A scheme and a trailing slash are noise under a name. */
function siteHost(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).host;
  } catch {
    return websiteUrl;
  }
}

export default async function AffiliateDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { affiliateId, email, merchant } = await requireAffiliate();
  const payoutDetails = await getAffiliatePayoutDetails(affiliateId);

  return (
    <SidebarProvider style={{ "--sidebar-width": "240px" } as React.CSSProperties}>
      <AffiliateSidebar
        merchantName={merchant.name}
        merchantSite={siteHost(merchant.websiteUrl)}
        email={email}
        payoutDetailsMissing={payoutDetails === null}
      />
      <SidebarInset>
        {/* Screens are built to fit, so this should never scroll. It is a
            safety net, not a layout. */}
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
