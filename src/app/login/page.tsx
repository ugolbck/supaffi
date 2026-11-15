import Link from "next/link";
import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/owner";
import { staticExt } from "@/extensions/static";
import { CenteredShell } from "@/components/CenteredShell";
import { LoginForm } from "./LoginForm";

// Without this, Next.js statically prerenders the page at build time (the
// ownerExists() check isn't a dynamic API Next can see) and bakes in
// whichever branch was true during `next build`, never re-checking it in
// production. Same fix as src/app/page.tsx and src/app/setup/page.tsx.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { signupPath } = staticExt.owners;
  if (!(await ownerExists())) {
    redirect(signupPath ?? "/setup");
  }

  return (
    <CenteredShell>
      <LoginForm />
      {signupPath && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          No account yet?{" "}
          <Link href={signupPath} className="cursor-pointer text-foreground underline underline-offset-4">
            Create one
          </Link>
        </p>
      )}
    </CenteredShell>
  );
}
