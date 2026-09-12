import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CheckList } from "@/components/onboarding/CheckList";
import { checkState, stripeKeyPending } from "@/components/onboarding/checkRows";
import { CodeBlock } from "@/components/onboarding/CodeBlock";
import { StepShell } from "@/components/onboarding/StepShell";
import { TaskCard, TaskCardSection } from "@/components/onboarding/TaskCard";
import { PasteField } from "@/components/PasteField";
import { restrictedKeyUrl } from "@/lib/stripeRestrictedKey";
import { displayStep, nextStep, stepPath } from "@/lib/onboarding";
import { isLocalDomain } from "@/lib/url";
import { saveStripeKeyAction, saveWebhookSecretAction } from "../actions";
import type { Ctx } from "../checks";

export function StripeKey({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, setup } = ctx;
  const stored = setup.stripeKeyStored;
  const next = nextStep("stripe-key", ctx.emailRequired)!;
  const product = { id: merchant.id, slug: merchant.slug };
  // Stripe cannot reach a machine on your desk, so the only way to see a real
  // event locally is to have Stripe's own CLI forward it. This is the one
  // place the signing secret is ever typed by hand; on a real domain the
  // endpoint is created with the key and there is nothing to paste.
  const local = isLocalDomain(merchant.domain);

  return (
    <StepShell
      step={displayStep("stripe-key", ctx.emailRequired)}
      title="Let Supaffi read your Stripe payments"
      lede="The link opens Stripe with the permissions already ticked."
      action={
        stored ? (
          <Button size="lg" render={<Link href={stepPath(merchant.slug, next)} />}>
            Continue
          </Button>
        ) : undefined
      }
    >
      <div>
        <Button
          variant="secondary"
          size="lg"
          render={<a href={restrictedKeyUrl(merchant.name)} target="_blank" rel="noreferrer" />}
        >
          <Image src="/logos/stripe.svg" alt="" width={16} height={16} className="mr-1 size-4" />
          Create the key in Stripe
        </Button>
      </div>

      {stored && (
        <TaskCard>
          <TaskCardSection sunken>
            <CheckList
              rows={[
                {
                  id: "key",
                  state: checkState(checks.stripe.key, stripeKeyPending),
                  pending: "Checking the key",
                  passed: "Supaffi can read your Stripe payments",
                  failed: "Stripe rejected that key",
                  hint: checks.stripe.key.detail || "Create a new one and paste it again.",
                },
              ]}
            />
          </TaskCardSection>
        </TaskCard>
      )}

      <PasteField
        label={stored ? "Replace the key" : "Paste the key here"}
        placeholder="rk_live_..."
        action={saveStripeKeyAction.bind(null, product)}
        submitLabel={stored ? "Replace" : "Continue"}
      />

      {stored && local && (
        <>
          <CodeBlock
            title="Local instance: forward events with the Stripe CLI"
            code={`stripe listen --forward-to ${merchant.domain}/api/webhooks/stripe`}
          />
          <PasteField
            label={setup.stripeWebhookStored ? "Replace the signing secret it prints" : "Paste the signing secret it prints"}
            placeholder="whsec_..."
            action={saveWebhookSecretAction.bind(null, product)}
            submitLabel="Save"
          />
        </>
      )}
    </StepShell>
  );
}
