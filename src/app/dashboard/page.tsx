import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main>
      <h1>Supaffi</h1>
      <p>Logged in as {session.user.email}.</p>
      <form action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}>
        <button type="submit" className="cursor-pointer">Log out</button>
      </form>
    </main>
  );
}
