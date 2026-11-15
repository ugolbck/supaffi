import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug, getStripeKeyKind, getWebhookEndpointId } from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { runProductChecks, type CheckSection } from "@/lib/checks/product";
import { restrictedKeyUrl } from "@/lib/payments/stripe/restrictedKey";
import { webhookEndpointUrl } from "@/lib/payments/stripe/webhookLink";
import { polarDashboardUrl, polarWebhookUrl } from "@/lib/payments/polar/webhookEvents";
import { CopyValue } from "@/components/CopyValue";
import { Button } from "@/components/ui/button";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { CheckList } from "@/components/onboarding/CheckList";
import { dnsCheckRows, type CheckRow } from "@/components/onboarding/checkRows";
import { isDevInstance } from "@/lib/instanceMode";
import { isLocalDomain } from "@/lib/url";
import { ProductForm, type SubdomainWebhook } from "./ProductForm";
import { ConnectionSheet } from "./ConnectionSheet";
import { DeleteProduct } from "./DeleteProduct";
import { MailSettings } from "./MailSettings";
import { mailStatus } from "@/lib/mail";
import {
  replacePolarTokenAction,
  replaceStripeKeyAction,
  replaceWebhookSecretAction,
} from "./settingsActions";

/**
 * What a product owns that is not affiliates: its details, its credentials,
 * its mail server and its own existence.
 *
 * The lights are live rather than a stored flag, so a key revoked in the
 * payment provider this morning says so here this afternoon.
 * `runProductChecks` serves a section it ran less than a minute ago from its
 * cache, which is what keeps this page off the provider on every visit. `?fresh=<section>` is how a
 * write says its section is worth re-running: without it the light for the
 * thing just replaced would keep reading from a result taken before the fix.
 *
 * Replacing a credential opens the matching sheet from `?replace=`, which is
 * where the two connect screens and the four routes that used to lead to them
 * ended up.
 *
 * `?webhook=manual` is a subdomain change Supaffi could not carry into the
 * payment provider, and says what to change there.
 */

const SECTIONS: CheckSection[] = ["dns", "payments", "tracking"];

/** A section name in the URL, or nothing when it names none. */
function freshSection(raw: string | undefined): CheckSection | null {
  return SECTIONS.find((section) => section === raw) ?? null;
}

const KEY_LABEL = {
  restricted: "Restricted key",
  secret: "Full account key",
} as const;

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ replace?: string; fresh?: string; webhook?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const fresh = freshSection(query.fresh);
  const [checks, keyKind, setup, mail, endpointId] = await Promise.all([
    runProductChecks(ownerId, merchant.id, fresh ? { fresh: new Set([fresh]) } : {}),
    getStripeKeyKind(ownerId, merchant.id),
    getProductSetup(ownerId, merchant.id),
    mailStatus(ownerId, merchant.id),
    getWebhookEndpointId(ownerId, merchant.id),
  ]);
  const local = isDevInstance() || isLocalDomain(merchant.domain);
  const polar = merchant.paymentProvider === "POLAR";
  const provider = polar ? "Polar" : "Stripe";
  const webhooksUrl = polar ? polarDashboardUrl(merchant.paymentSandbox) : "https://dashboard.stripe.com/webhooks";
  const webhookUrl = polar ? polarWebhookUrl(merchant.domain) : webhookEndpointUrl(merchant.domain);
  // The same rules the save follows (the provider's moveWebhookEndpoint).
  const subdomainWebhook: SubdomainWebhook =
    !setup.webhookSecretStored || isLocalDomain(merchant.domain)
      ? null
      : { move: setup.paymentKeyStored && endpointId ? "moves" : "manual", provider };

  const productRef = { id: merchant.id, slug: merchant.slug };
  const settingsHref = `/dashboard/products/${merchant.slug}/settings`;

  const replaceLink = (which: string) => (
    <Button variant="secondary" size="sm" render={<Link href={`${settingsHref}?replace=${which}`} />}>
      Replace
    </Button>
  );

  // Every row says what is true right now, in that order: connected, still
  // being checked, or wrong. "Key works" sitting next to an amber ring was
  // the label of a check, not a statement about the key, and read as either.
  const paymentRows: CheckRow[] = [
    {
      id: "payment-key",
      state: !setup.paymentKeyStored ? "pending" : checks.payments.key.ok ? "ok" : "failed",
      pending: polar ? "No Polar token yet" : "No Stripe key yet",
      passed: `Connected to ${provider}`,
      failed: polar ? "Polar rejected the token" : "Stripe rejected the key",
      hint: "Replace it with a new one.",
      action: replaceLink("payment-key"),
    },
    {
      id: "webhook-secret",
      state: !setup.webhookSecretStored ? "pending" : checks.payments.webhook.ok ? "ok" : "pending",
      pending: setup.webhookSecretStored ? `Waiting for the first event from ${provider}` : "No webhook yet",
      passed: `Receiving events from ${provider}`,
      action: replaceLink("webhook-secret"),
    },
  ];
  const dnsRows: CheckRow[] = local ? [] : dnsCheckRows(checks.dns);

  const sheets = {
    "payment-key": polar
      ? {
          title: "Replace the Polar token",
          lede: "An organization access token with the webhooks:read, webhooks:write, discounts:read and discounts:write scopes.",
          createLabel: "Open Polar",
          createUrl: polarDashboardUrl(merchant.paymentSandbox),
          fieldLabel: "Paste the new token",
          placeholder: "polar_oat_...",
          action: replacePolarTokenAction.bind(null, productRef),
        }
      : {
      title: "Replace the Stripe key",
      lede: "The link opens Stripe with the permissions already ticked. It never moves money.",
      createLabel: "Create key in Stripe",
      createUrl: restrictedKeyUrl(merchant.name),
      fieldLabel: "Paste the new key",
      placeholder: "rk_live_...",
      action: replaceStripeKeyAction.bind(null, productRef),
    },
    "webhook-secret": {
      title: "Replace the signing secret",
      lede: `${provider} signs every event it sends with this.`,
      createLabel: `Open ${provider} webhooks`,
      createUrl: webhooksUrl,
      fieldLabel: "Paste the signing secret",
      placeholder: "whsec_...",
      action: replaceWebhookSecretAction.bind(null, productRef),
    },
  };

  // A value that names no sheet opens none, rather than an empty panel.
  const sheet = query.replace && query.replace in sheets
    ? sheets[query.replace as keyof typeof sheets]
    : null;

  return (
    <Page>
      <PageTitle title="Settings" subtitle={merchant.name} />

      <Section title="Product">
        <ProductForm
          product={productRef}
          initial={{
            name: merchant.name,
            domain: merchant.domain,
            websiteUrl: merchant.websiteUrl,
          }}
          lights={dnsRows.length > 0 ? <CheckList rows={dnsRows} /> : null}
          webhook={subdomainWebhook}
        />
        {query.webhook === "manual" && setup.webhookSecretStored && (
          <div
            role="alert"
            className="mt-4 flex flex-col gap-3 rounded-(--radius) border border-status-warning/30 bg-status-warning-bg px-4 py-3 text-sm"
          >
            <p>
              {provider} is not sending sales to the new address yet. Set the webhook address in {provider} to:
            </p>
            <CopyValue value={webhookUrl} className="font-mono text-xs" />
            <Button
              variant="secondary"
              size="sm"
              className="w-fit cursor-pointer"
              render={<a href={webhooksUrl} target="_blank" rel="noreferrer" />}
            >
              Open {provider} webhooks
            </Button>
          </div>
        )}
      </Section>

      <Section title="Connections" flush>
        <div className="divide-y divide-neutral-200">
          <div className="grid grid-cols-[7rem_1fr] gap-4 px-5 py-4">
            <div className="flex flex-col gap-0.5 pt-3">
              <span className="text-sm">{provider}</span>
              <span className="text-xs text-muted-foreground">
                {polar ? (setup.paymentKeyStored ? "Organization token" : "Not connected") : keyKind ? KEY_LABEL[keyKind] : "Not connected"}
              </span>
            </div>
            <div className="rounded-(--radius) border border-neutral-200 bg-neutral-50">
              <CheckList rows={paymentRows} />
            </div>
          </div>
          {keyKind === "secret" && (
            <p className="px-5 py-3 text-xs text-muted-foreground">
              This is a full account key. A restricted key is safer.{" "}
              <a className="cursor-pointer underline" href={restrictedKeyUrl(merchant.name)} target="_blank" rel="noreferrer">
                Create one in Stripe
              </a>
            </p>
          )}
        </div>
      </Section>

      <MailSettings product={productRef} status={mail} />

      <Section title="Danger">
        <DeleteProduct product={productRef} name={merchant.name} />
      </Section>

      {sheet && (
        <ConnectionSheet
          title={sheet.title}
          lede={sheet.lede}
          createLabel={sheet.createLabel}
          createUrl={sheet.createUrl}
          fieldLabel={sheet.fieldLabel}
          placeholder={sheet.placeholder}
          action={sheet.action}
          settingsHref={settingsHref}
        />
      )}
    </Page>
  );
}
