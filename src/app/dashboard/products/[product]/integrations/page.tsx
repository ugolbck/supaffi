import { redirect } from "next/navigation";

/**
 * Connections live on the settings page now, with their own live lights. This
 * route stays as the redirect to it: onboarding's setup steps and older links
 * still point here.
 */
export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  redirect(`/dashboard/products/${product}/settings`);
}
