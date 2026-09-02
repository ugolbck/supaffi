"use client";

import type { ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function CommissionTabs({
  activeTab,
  payoutsContent,
  flaggedContent,
}: {
  activeTab: "payouts" | "flagged";
  payoutsContent: ReactNode;
  flaggedContent: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <Tabs
      value={activeTab}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", String(next));
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="flex flex-1 flex-col gap-4"
    >
      <TabsList>
        <TabsTrigger value="payouts" className="cursor-pointer">
          Payouts
        </TabsTrigger>
        <TabsTrigger value="flagged" className="cursor-pointer">
          Flagged
        </TabsTrigger>
      </TabsList>
      <TabsContent value="payouts">{payoutsContent}</TabsContent>
      <TabsContent value="flagged">{flaggedContent}</TabsContent>
    </Tabs>
  );
}
