import { getMerchantByDomain } from "@/lib/merchant";
import { requestHost } from "@/lib/requestHost";
import { getDefaultProgramSlug } from "@/lib/program";
import { CenteredShell } from "@/components/CenteredShell";
import { LoginForm } from "./LoginForm";

export default async function AffiliateLoginPage() {
  const host = await requestHost();
  const merchant = host ? await getMerchantByDomain(host) : null;
  const canJoin = merchant ? (await getDefaultProgramSlug(merchant.id)) !== null : false;

  return (
    <CenteredShell>
      <LoginForm merchantName={merchant?.name ?? null} canJoin={canJoin} />
    </CenteredShell>
  );
}
