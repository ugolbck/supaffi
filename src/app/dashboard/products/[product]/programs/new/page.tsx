import { redirect } from "next/navigation";

/**
 * Creating a program is a sheet on the list now. This route stays as the
 * redirect to it: onboarding's setup steps and older links still point here.
 */
export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  redirect(`/dashboard/products/${product}/programs?new=1`);
}
