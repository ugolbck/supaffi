import { merchantOnHost } from "@/app/affiliates/merchantOnHost";
import { requestHost } from "@/lib/requestHost";
import { getDefaultProgramSlug } from "@/lib/program";
import { productHasEmail } from "@/lib/mail";
import { CenteredShell } from "@/components/CenteredShell";
import { LoginForm } from "./LoginForm";

export default async function AffiliateLoginPage() {
  const host = await requestHost();
  const merchant = await merchantOnHost(host);
  const canJoin = merchant ? (await getDefaultProgramSlug(merchant.id)) !== null : false;
  const canReset = merchant ? await productHasEmail(merchant.id) : false;

  return (
    <CenteredShell>
      <LoginForm merchantName={merchant?.name ?? null} canJoin={canJoin} canReset={canReset} />
    </CenteredShell>
  );
}
