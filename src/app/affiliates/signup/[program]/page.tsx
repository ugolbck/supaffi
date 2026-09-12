import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getMerchantByDomain } from "@/lib/merchant";
import { getProgramForSignup } from "@/lib/program";
import { createAffiliateSignup } from "./createAffiliateSignup";
import { SignupScreen } from "./SignupScreen";

export default async function AffiliateSignupPage({
  params,
}: {
  params: Promise<{ program: string }>;
}) {
  const { program: programSlug } = await params;
  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (!merchant) notFound();

  const program = await getProgramForSignup(merchant.id, programSlug);
  if (!program) notFound();

  const action = createAffiliateSignup.bind(null, programSlug);
  // What the affiliate's link is a link on, not where the signup page itself
  // is hosted: the two domains differ whenever the program runs on its own
  // subdomain.
  const linkHost = merchant.websiteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  return (
    <main className="flex min-h-dvh items-center bg-background px-4 py-10 sm:px-8">
      <SignupScreen
        merchantName={merchant.name}
        terms={{
          rate: program.defaultCommissionRate,
          durationType: program.commissionDurationType,
          durationMonths: program.commissionDurationMonths,
        }}
        linkHost={linkHost}
        action={action}
      />
    </main>
  );
}
