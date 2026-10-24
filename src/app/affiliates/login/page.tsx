import { headers } from "next/headers";
import { getMerchantByDomain } from "@/lib/merchant";
import { CenteredShell } from "@/components/CenteredShell";
import { LoginForm } from "./LoginForm";

export default async function AffiliateLoginPage() {
  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;

  return (
    <CenteredShell>
      <LoginForm merchantName={merchant?.name ?? null} />
    </CenteredShell>
  );
}
