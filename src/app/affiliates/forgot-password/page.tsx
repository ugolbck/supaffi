import { redirect } from "next/navigation";
import { merchantOnHost } from "@/app/affiliates/merchantOnHost";
import { requestHost } from "@/lib/requestHost";
import { productHasEmail } from "@/lib/mail";
import { CenteredShell } from "@/components/CenteredShell";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

/** Only there while the product has email on; otherwise login says who to ask. */
export default async function ForgotPasswordPage() {
  const host = await requestHost();
  const merchant = await merchantOnHost(host);
  if (!merchant || !(await productHasEmail(merchant.id))) redirect("/affiliates/login");

  return (
    <CenteredShell>
      <ForgotPasswordForm merchantName={merchant.name} />
    </CenteredShell>
  );
}
