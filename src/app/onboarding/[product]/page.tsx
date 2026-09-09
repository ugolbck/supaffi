import { redirect } from "next/navigation";
import { resumeStep, stepPath } from "@/lib/onboarding";
import { loadStepContext } from "./checks";

// The product with no step named. Someone who trimmed the URL, or came back
// days later, lands on the first thing still outstanding rather than a 404.
export default async function ProductOnboarding({ params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const ctx = await loadStepContext(product);
  redirect(stepPath(product, resumeStep(ctx.setup, ctx.onboardingCompletedAt)));
}
