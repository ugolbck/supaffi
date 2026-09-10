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

  return (
    <main className="min-h-dvh bg-background px-4 py-14 sm:py-20">
      <SignupScreen
        merchantName={merchant.name}
        terms={{
          rate: program.defaultCommissionRate,
          attributionWindowDays: program.attributionWindowDays,
          durationType: program.commissionDurationType,
          durationMonths: program.commissionDurationMonths,
        }}
        action={action}
      />
    </main>
  );
}
