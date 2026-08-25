import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/owner";
import { completeSetup } from "./actions";

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
    <main>
      <h1>Set up Supaffi</h1>
      <p>Create the Owner account for this Instance. This can only be done once.</p>
      <form action={async (formData) => {
        "use server";
        const result = await completeSetup(formData);
        if (result?.error) {
          // Next.js Server Actions can't return client-visible errors without
          // useActionState — deferred to a future pass, out of scope for this
          // plan's core deliverable (a working setup flow). Same known gap as
          // src/app/login/page.tsx.
        }
      }}>
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <label>
          Password
          <input type="password" name="password" required minLength={12} />
        </label>
        <label>
          Confirm password
          <input type="password" name="confirmPassword" required minLength={12} />
        </label>
        <button type="submit" className="cursor-pointer">Create account</button>
      </form>
    </main>
  );
}
