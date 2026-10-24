import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMerchantByDomain } from "@/lib/merchant";
import { listOpenPrograms } from "@/lib/program";
import { CenteredShell } from "@/components/CenteredShell";
import { ProgramChoice } from "./ProgramChoice";

/**
 * Where a product's affiliate address sends a visitor: the signup of the one
 * open program, a choice when there are several, the login when none is open.
 */
export default async function AffiliateEntryPage() {
  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (!merchant) notFound();

  const programs = await listOpenPrograms(merchant.id);
  if (programs.length === 0) redirect("/affiliates/login");
  if (programs.length === 1) redirect(`/affiliates/signup/${programs[0].slug}`);

  return (
    <CenteredShell>
      <ProgramChoice merchantName={merchant.name} programs={programs} />
    </CenteredShell>
  );
}
