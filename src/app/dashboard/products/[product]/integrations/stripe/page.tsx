import { redirect } from "next/navigation";

/** Connecting Stripe is a sheet on the settings page now. */
export default async function ConnectStripePage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  redirect(`/dashboard/products/${product}/settings?replace=stripe-key`);
}
