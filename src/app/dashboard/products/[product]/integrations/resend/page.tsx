import { redirect } from "next/navigation";

/** Connecting Resend is a sheet on the settings page now. */
export default async function ConnectResendPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  redirect(`/dashboard/products/${product}/settings?replace=email-key`);
}
