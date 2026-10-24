import { headers } from "next/headers";
import { getMerchantByDomain } from "@/lib/merchant";
import { LoginForm } from "./LoginForm";

export default async function AffiliateLoginPage() {
  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;

  return (
    <main className="mx-auto flex max-w-md flex-col justify-center px-4 py-16">
      <LoginForm merchantName={merchant?.name ?? null} />
    </main>
  );
}
