import { redirect } from "next/navigation";
import { setAffiliatePassword } from "./setAffiliatePassword";
import { CenteredShell } from "@/components/CenteredShell";
import { SetPasswordForm } from "./SetPasswordForm";

/**
 * Where a password link the Owner copied lands. Opening it changes nothing:
 * the link is only spent when the form is submitted, so a chat app or mail
 * scanner previewing it cannot use it up.
 */
export default async function AffiliatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  if (typeof token !== "string" || !token) redirect("/affiliates/login");

  return (
    <CenteredShell>
      <SetPasswordForm action={setAffiliatePassword.bind(null, token)} />
    </CenteredShell>
  );
}
