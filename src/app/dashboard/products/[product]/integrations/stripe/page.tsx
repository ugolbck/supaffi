import { redirect, notFound } from "next/navigation";
import { Check } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug, getIntegrationStatus } from "@/lib/merchant";
import { getProductSetup, stepAfter } from "@/lib/productSetup";
import { SetupShell, SetupPanel } from "../../SetupShell";
import { StripeConnectForm } from "./StripeConnectForm";
import { BrandMark } from "../BrandMark";
import { PAYMENT_PROVIDERS } from "../providers";

export default async function ConnectStripePage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwnerBySlug(session.user.id, product);
  if (!merchant) notFound();

  const [status, setup] = await Promise.all([
    getIntegrationStatus(session.user.id, merchant.id),
    getProductSetup(session.user.id, merchant.id),
  ]);
  const webhookUrl = `https://${merchant.domain}/api/webhooks/stripe`;

  // Once payments are in, the way forward is whatever is still missing. Until
  // then it is the other half of this step, back on the integrations screen.
  const next = setup.integrationsConnected
    ? stepAfter(merchant.slug, setup, 1)
    : { label: "Back to integrations", href: `/dashboard/products/${merchant.slug}/integrations` };

  return (
    <SetupShell
      step={1}
      title="Connect Stripe"
      lede="Read-only access. Nothing is charged or created on your account."
      mark={<BrandMark provider={PAYMENT_PROVIDERS[0]} size={36} />}
      status={
        status.stripe ? (
          <span className="inline-flex animate-in items-center gap-1 rounded-full bg-status-success-bg px-2 py-0.5 text-xs font-medium text-status-success zoom-in-95 duration-200 ease-[var(--ease-out)]">
            <Check className="size-3" strokeWidth={3} />
            Connected
          </span>
        ) : null
      }
      next={next}
    >
      <SetupPanel className="lg:flex-1 lg:overflow-y-auto">
        <StripeConnectForm
          product={{ id: merchant.id, slug: merchant.slug }}
          productName={merchant.name}
          webhookUrl={webhookUrl}
          alreadyConnected={status.stripe}
        />
      </SetupPanel>
    </SetupShell>
  );
}
