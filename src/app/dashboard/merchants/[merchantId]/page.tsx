import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMerchantForOwner } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/stripeWebhookEvents";

export default async function MerchantDetailPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  const programs = await listProgramsForMerchant(session.user.id, merchant.id);

  const webhookUrl = `https://${merchant.domain}/api/webhooks/stripe`;

  return (
    <main>
      <h1>{merchant.name}</h1>
      <p>Domain: {merchant.domain}</p>
      <Link href={`/dashboard/merchants/${merchant.id}/edit`} className="cursor-pointer">
        Edit connection details
      </Link>

      <h2>Stripe webhook setup</h2>
      <p>In your Stripe Dashboard, add a webhook endpoint pointing at:</p>
      <code>{webhookUrl}</code>
      <p>Enable these events:</p>
      <ul>
        {REQUIRED_STRIPE_WEBHOOK_EVENTS.map((event) => (
          <li key={event}>{event}</li>
        ))}
      </ul>

      <h2>Programs</h2>
      {programs.length === 0 ? (
        <p>No Programs yet.</p>
      ) : (
        <ul>
          {programs.map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/merchants/${merchant.id}/programs/${p.id}/edit`}
                className="cursor-pointer"
              >
                {p.name}
              </Link>{" "}
              — {String(p.defaultCommissionRate)}%
            </li>
          ))}
        </ul>
      )}
      <Link href={`/dashboard/merchants/${merchant.id}/programs/new`} className="cursor-pointer">
        Create a Program
      </Link>
    </main>
  );
}
