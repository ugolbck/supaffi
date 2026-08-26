import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchants = await listMerchantsForOwner(session.user.id);

  return (
    <main>
      <h1>Supaffi</h1>
      <p>Logged in as {session.user.email}.</p>

      <h2>Merchants</h2>
      {merchants.length === 0 ? (
        <p>No Merchants yet.</p>
      ) : (
        <ul>
          {merchants.map((m) => (
            <li key={m.id}>
              <Link href={`/dashboard/merchants/${m.id}`} className="cursor-pointer">
                {m.name}
              </Link>{" "}
              ({m.domain})
            </li>
          ))}
        </ul>
      )}
      <Link href="/dashboard/merchants/new" className="cursor-pointer">
        Connect a Merchant
      </Link>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="cursor-pointer">
          Log out
        </button>
      </form>
    </main>
  );
}
