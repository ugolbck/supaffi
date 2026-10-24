import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/owner";
import { setupTokenExists } from "@/lib/setupToken";
import { CenteredShell } from "@/components/CenteredShell";
import { SetupForm } from "./SetupForm";
import { SetupClosed } from "./SetupClosed";

// Without this, Next.js statically prerenders the page at build time (the
// ownerExists() check isn't a dynamic API Next can see) and bakes in
// whichever branch was true during `next build`, never re-checking it in
// production — meaning the wizard would stay servable after an Owner is
// created. Same fix as src/app/page.tsx and src/app/login/page.tsx.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await ownerExists()) {
    redirect("/login"); // setup is a one-time, first-run-only flow
  }

  return (
    <CenteredShell>{setupTokenExists() ? <SetupForm /> : <SetupClosed />}</CenteredShell>
  );
}
