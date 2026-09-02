import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getMerchantByDomain } from "@/lib/merchant";
import { getProgramForSignup } from "@/lib/program";
import { createAffiliateSignup } from "./createAffiliateSignup";
import { SignupForm } from "./SignupForm";

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
    <main className="mx-auto flex max-w-md flex-col justify-center px-4 py-16">
      <SignupForm action={action} programName={program.name} merchantName={merchant.name} />
    </main>
  );
}
