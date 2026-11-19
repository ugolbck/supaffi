import { notFound, redirect } from "next/navigation";
import { merchantOnHost } from "@/app/affiliates/merchantOnHost";
import { requestHost } from "@/lib/requestHost";
import { getDefaultProgramSlug } from "@/lib/program";

/**
 * Where a product's affiliate address sends a visitor: the signup of the
 * first open program, or the login when none is open. Never a choice between
 * programs: the address is the public link, and any other program is reached
 * by its own link, so opening one later does not change what it shows.
 */
export default async function AffiliateEntryPage() {
  const host = await requestHost();
  const merchant = await merchantOnHost(host);
  if (!merchant) notFound();

  const slug = await getDefaultProgramSlug(merchant.id);
  redirect(slug ? `/affiliates/signup/${slug}` : "/affiliates/login");
}
