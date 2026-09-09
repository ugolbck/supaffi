import { notFound, redirect } from "next/navigation";
import { isStepId, stepIds, stepPath } from "@/lib/onboarding";
import { loadStepContext } from "../checks";
import { Subdomain } from "../steps/Subdomain";

export default async function StepPage({ params }: { params: Promise<{ product: string; step: string }> }) {
  const { product, step } = await params;
  if (!isStepId(step)) notFound();
  const ctx = await loadStepContext(product);
  // A step the instance does not have — the email pair in console mode —
  // is not a 404, it is a URL that stopped existing. Land on the one after it.
  if (!stepIds(ctx.emailRequired).includes(step)) redirect(stepPath(product, "terms"));
  if (step === "product") redirect(stepPath(product, "subdomain"));

  switch (step) {
    case "subdomain":
      return <Subdomain ctx={ctx} />;
    default:
      notFound();
  }
}
