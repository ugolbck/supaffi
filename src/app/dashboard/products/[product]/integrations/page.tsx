import { redirect, notFound } from "next/navigation";
import { Check, CreditCard, Mail } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMerchantForOwner, getIntegrationStatus } from "@/lib/merchant";
import { deliveryMode } from "@/lib/email/transport";
import { getProductSetup, stepAfter } from "@/lib/productSetup";
import { SetupShell } from "../SetupShell";
import { ProviderCard } from "./ProviderCard";
import { PAYMENT_PROVIDERS, EMAIL_PROVIDERS, type Provider } from "./providers";

// Both categories get the same treatment: icon, heading, one line of purpose,
// and their own pill. Email used to sit under a "your payments" headline, which
// made a hard requirement read like an afterthought.
function CategoryHeader({
  icon: Icon,
  title,
  blurb,
  connected,
  optionalLabel,
}: {
  icon: typeof CreditCard;
  title: string;
  blurb: string;
  connected: boolean;
  /** Shown instead of "Required" when this category is not blocking setup. */
  optionalLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-(--radius-md) bg-accent-100 text-accent-800">
        <Icon className="size-4" />
      </span>
      <h2 className="font-heading text-sm font-semibold tracking-tight">{title}</h2>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          connected
            ? "bg-status-success-bg text-status-success"
            : optionalLabel
              ? "bg-accent-100 text-accent-800"
              : "bg-status-warning-bg text-status-warning"
        }`}
      >
        {connected && <Check className="size-3" strokeWidth={3} />}
        {connected ? "Connected" : (optionalLabel ?? "Required")}
      </span>
      <p className="w-full text-xs leading-relaxed text-muted-foreground">{blurb}</p>
    </div>
  );
}

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId: merchantId } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  const [status, setup] = await Promise.all([
    getIntegrationStatus(session.user.id, merchantId),
    getProductSetup(session.user.id, merchantId),
  ]);
  const base = `/dashboard/products/${merchantId}/integrations`;

  // Nothing to connect when the instance prints emails instead of sending
  // them, which is the only way to run against a `localhost` domain.
  const emailOptional = deliveryMode() === "console";

  function isConnected(provider: Provider): boolean {
    if (provider.id === "stripe") return status.stripe;
    if (provider.id === "resend") return status.email;
    return false;
  }

  // Only offered once this step is genuinely done, so it can never be used to
  // skip a provider that is still missing.
  const next = setup.integrationsConnected ? stepAfter(merchantId, setup, 1) : null;

  // A single running index across both groups so the entrance stagger reads as
  // one cascade down the page rather than two that restart.
  let order = 0;

  return (
    <SetupShell
      step={1}
      title={`Connect ${merchant.name}`}
      lede="Read-only access. Nothing is charged or created on your accounts."
      merchantId={merchantId}
      next={next}
    >
      <div className="flex flex-col gap-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <section className="flex shrink-0 flex-col gap-3">
          <CategoryHeader
            icon={CreditCard}
            title="Payments"
            blurb="So Supaffi can see which sales an affiliate brought in."
            connected={status.stripe}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PAYMENT_PROVIDERS.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                href={`${base}/${provider.id}`}
                connected={isConnected(provider)}
                index={order++}
              />
            ))}
          </div>
        </section>

        <section className="flex shrink-0 flex-col gap-3">
          <CategoryHeader
            icon={Mail}
            title="Affiliate emails"
            blurb={
              emailOptional && !status.email
                ? "Login links are printed to the server terminal on this instance. Connect a provider to send them for real."
                : "Affiliates log in with a link sent to their inbox."
            }
            connected={status.email}
            optionalLabel={emailOptional ? "Printed to terminal" : undefined}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {EMAIL_PROVIDERS.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                href={`${base}/${provider.id}`}
                connected={isConnected(provider)}
                index={order++}
              />
            ))}
          </div>
        </section>
      </div>
    </SetupShell>
  );
}
