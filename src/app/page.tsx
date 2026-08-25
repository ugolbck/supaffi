import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ownerExists } from "@/lib/owner";

// Routes by live Owner/session state on every request. Without this, Next.js
// statically prerenders the page at build time (no cookies()/searchParams
// usage is visible before the first redirect() branch runs), baking in
// whichever Owner-existence branch was true during `next build` and never
// re-checking it in production.
export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await ownerExists())) {
    redirect("/setup");
  }
  const session = await auth();
  redirect(session ? "/dashboard" : "/login");
}
