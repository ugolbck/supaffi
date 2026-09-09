import { redirect } from "next/navigation";

/**
 * A product's details are edited on its settings page now. This route stays as
 * the redirect to it, for bookmarks and for older links.
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  redirect(`/dashboard/products/${product}/settings`);
}
