import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug, getStripeKeyKind } from "@/lib/merchant";
import { runProductChecks } from "@/lib/checks/product";
import { resendDomainsUrl } from "@/lib/checks/email";
import { restrictedKeyUrl } from "@/lib/stripeRestrictedKey";
import { webhookCreateUrl } from "@/lib/stripeWebhookLink";
import { Button } from "@/components/ui/button";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { Light } from "@/components/dashboard/Light";
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
 * this page off Stripe and Resend on every visit.
 *
 * Replacing a credential opens the matching sheet from `?replace=`, which is
 * where the two connect screens and the four routes that used to lead to them
 * ended up.
 */

const KEY_LABEL = {
  restricted: "Restricted key",
  secret: "Full account key",
} as const;

function ConnectionRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[7rem_1fr] sm:gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function CheckLine({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      {children}
      {action}
    </div>
  );
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ replace?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const [checks, keyKind] = await Promise.all([
    runProductChecks(ownerId, merchant.id),
    getStripeKeyKind(ownerId, merchant.id),
  ]);

  const productRef = { id: merchant.id, slug: merchant.slug };
  const settingsHref = `/dashboard/products/${merchant.slug}/settings`;

  const replaceLink = (which: string, label: string) => (
    <Button
      variant="ghost"
      size="sm"
      className="cursor-pointer"
      render={<Link href={`${settingsHref}?replace=${which}`} />}
    >
      {label}
    </Button>
  );

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
      createLabel: "Create webhook in Stripe",
      createUrl: webhookCreateUrl(merchant.domain),
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
          lights={
            <>
              <Light result={checks.dns.resolves} label="Resolves" />
              <Light result={checks.dns.https} label="HTTPS" />
            </>
          }
        />
      </Section>

      <Section title="Connections">
        <div className="flex flex-col gap-5">
          <ConnectionRow
            label="Stripe"
            detail={keyKind ? KEY_LABEL[keyKind] : "Not connected"}
          >
            <CheckLine action={replaceLink("stripe-key", "Replace")}>
              <Light result={checks.stripe.key} label="Key works" />
            </CheckLine>
            <CheckLine action={replaceLink("stripe-webhook", "Replace")}>
              <Light result={checks.stripe.webhook} label="Stripe is sending events" />
            </CheckLine>
            {keyKind === "secret" && (
              <p className="text-xs text-muted-foreground">
                This is a full account key. A restricted key is safer.{" "}
                <a
                  className="cursor-pointer underline"
                  href={restrictedKeyUrl(merchant.name)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Create one in Stripe
                </a>
              </p>
            )}
          </ConnectionRow>

          <ConnectionRow label="Email" detail="Resend">
            <CheckLine action={replaceLink("email-key", "Replace")}>
              <Light result={checks.email.key} label="Key works" />
            </CheckLine>
            <CheckLine
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer"
                  render={<a href={resendDomainsUrl()} target="_blank" rel="noreferrer" />}
                >
                  Open Resend
                </Button>
              }
            >
              <Light result={checks.email.domain} label="Sending domain verified" />
            </CheckLine>
          </ConnectionRow>
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
