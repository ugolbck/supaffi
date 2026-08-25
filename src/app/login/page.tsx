import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/owner";
import { login } from "./actions";

export default async function LoginPage() {
  if (!(await ownerExists())) {
    redirect("/setup");
  }

  return (
    <main>
      <h1>Log in</h1>
      <form action={async (formData) => {
        "use server";
        const result = await login(formData);
        if (result?.error) {
          // Next.js Server Actions can't return client-visible errors without
          // useActionState — deferred to a future pass, out of scope for this
          // plan's core deliverable (a working login flow).
        }
      }}>
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <label>
          Password
          <input type="password" name="password" required />
        </label>
        <button type="submit">Log in</button>
      </form>
    </main>
  );
}
