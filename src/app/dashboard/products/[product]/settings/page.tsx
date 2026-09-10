import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug, getStripeKeyKind } from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { runProductChecks, type CheckSection } from "@/lib/checks/product";
import { resendDomainsUrl } from "@/lib/checks/email";
import { restrictedKeyUrl } from "@/lib/stripeRestrictedKey";
import { Button } from "@/components/ui/button";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { CheckList, checkState, dnsCheckRows, emailDomainPending, type CheckRow } from "@/components/onboarding/CheckList";
import { isDevInstance } from "@/lib/instanceMode";
import { isLocalDomain } from "@/lib/url";
import { ProductForm } from "./ProductForm";
import { ConnectionSheet } from "./ConnectionSheet";
import { DeleteProduct } from "./DeleteProduct";
import {
  replaceStripeKeyAction,
  replaceWebhookSecretAction,
  replaceEmailKeyAction,
} from "./settingsActions";

/**
 * The three things a product owns that are not affiliates: its details, its
 * credentials and its own existence.
 *
 * The lights are live rather than a stored flag, so a key revoked in Stripe
 * this morning says so here this afternoon. `runProductChecks` serves a
 * section it ran less than a minute ago from its cache, which is what keeps
 * this page off Stripe and Resend on every visit. `?fresh=<section>` is how a
 * write says its section is worth re-running: without it the light for the
 * thing just replaced would keep reading from a result taken before the fix.
 *
 * Replacing a credential opens the matching sheet from `?replace=`, which is
 * where the two connect screens and the four routes that used to lead to them
 * ended up.
 */

const SECTIONS: CheckSection[] = ["dns", "stripe", "email", "tracking"];

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
  searchParams: Promise<{ replace?: string; fresh?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const fresh = freshSection(query.fresh);
  const [checks, keyKind, setup] = await Promise.all([
    runProductChecks(ownerId, merchant.id, fresh ? { fresh: new Set([fresh]) } : {}),
    getStripeKeyKind(ownerId, merchant.id),
    getProductSetup(ownerId, merchant.id),
  ]);
  const local = isDevInstance() || isLocalDomain(merchant.domain);

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
  const stripeRows: CheckRow[] = [
    {
      id: "stripe-key",
      state: !setup.stripeKeyStored ? "pending" : checks.stripe.key.ok ? "ok" : "failed",
      pending: "No Stripe key yet",
      passed: "Connected to Stripe",
      failed: "Stripe rejected the key",
      hint: "Replace it with a new one.",
      action: replaceLink("stripe-key"),
    },
    {
      id: "stripe-webhook",
      state: !setup.stripeWebhookStored ? "pending" : checks.stripe.webhook.ok ? "ok" : "pending",
      pending: setup.stripeWebhookStored ? "Waiting for the first event from Stripe" : "No webhook yet",
      passed: "Receiving events from Stripe",
      action: replaceLink("stripe-webhook"),
    },
  ];
  const emailRows: CheckRow[] = [
    {
      id: "email-key",
      state: !setup.emailConnected ? "pending" : checks.email.key.ok ? "ok" : "failed",
      pending: "No Resend key yet",
      passed: "Connected to Resend",
      failed: "Resend rejected the key",
      hint: "Replace it with a new one.",
      action: replaceLink("email-key"),
    },
    {
      id: "email-domain",
      state: !setup.emailConnected
        ? "pending"
        : checkState(checks.email.domain, emailDomainPending),
      pending: setup.emailConnected ? `Waiting for Resend to verify ${merchant.domain}` : "No sending domain yet",
      passed: `Sending from ${merchant.domain}`,
      failed: checks.email.domain.detail,
      hint: "Open Resend and check the record it asked for.",
      action: (
        <Button variant="secondary" size="sm" render={<a href={resendDomainsUrl()} target="_blank" rel="noreferrer" />}>
          Open Resend
        </Button>
      ),
    },
  ];
  const dnsRows: CheckRow[] = local ? [] : dnsCheckRows(checks.dns);

  const sheets = {
    "stripe-key": {
      title: "Replace the Stripe key",
      lede: "Read only. Nothing is charged or created.",
      createLabel: "Create key in Stripe",
      createUrl: restrictedKeyUrl(merchant.name),
      fieldLabel: "Paste the new key",
      placeholder: "rk_live_...",
      action: replaceStripeKeyAction.bind(null, productRef),
    },
    "stripe-webhook": {
      title: "Replace the signing secret",
      lede: "Stripe signs every event it sends with this.",
      createLabel: "Open Stripe webhooks",
      createUrl: "https://dashboard.stripe.com/webhooks",
      fieldLabel: "Paste the signing secret",
      placeholder: "whsec_...",
      action: replaceWebhookSecretAction.bind(null, productRef),
    },
    "email-key": {
      title: "Replace the Resend key",
      lede: "Affiliates log in with a link sent to their inbox.",
      createLabel: "Create key in Resend",
      createUrl: "https://resend.com/api-keys",
      fieldLabel: "Paste the new key",
      placeholder: "re_...",
      action: replaceEmailKeyAction.bind(null, productRef),
    },
  } as const;

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
        />
      </Section>

      <Section title="Connections" flush>
        <div className="divide-y divide-neutral-200">
          <div className="grid grid-cols-[7rem_1fr] gap-4 px-5 py-4">
            <div className="flex flex-col gap-0.5 pt-3">
              <span className="text-sm">Stripe</span>
              <span className="text-xs text-muted-foreground">{keyKind ? KEY_LABEL[keyKind] : "Not connected"}</span>
            </div>
            <div className="rounded-(--radius) border border-neutral-200 bg-neutral-50">
              <CheckList rows={stripeRows} />
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
          <div className="grid grid-cols-[7rem_1fr] gap-4 px-5 py-4">
            <div className="flex flex-col gap-0.5 pt-3">
              <span className="text-sm">Email</span>
              <span className="text-xs text-muted-foreground">Resend</span>
            </div>
            <div className="rounded-(--radius) border border-neutral-200 bg-neutral-50">
              <CheckList rows={emailRows} />
            </div>
          </div>
        </div>
      </Section>

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
