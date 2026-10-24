import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/owner";
import { CenteredShell } from "@/components/CenteredShell";
import { LoginForm } from "./LoginForm";

// Without this, Next.js statically prerenders the page at build time (the
// ownerExists() check isn't a dynamic API Next can see) and bakes in
// whichever branch was true during `next build`, never re-checking it in
// production. Same fix as src/app/page.tsx and src/app/setup/page.tsx.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await ownerExists())) {
    redirect("/setup");
  }

  return (
    <CenteredShell>
      <LoginForm />
    </CenteredShell>
  );
}
