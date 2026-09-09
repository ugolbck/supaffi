import Link from "next/link";
import { Button } from "@/components/ui/button";
import { webhookCreateUrl, webhookEndpointUrl, WEBHOOK_EVENTS } from "@/lib/stripeWebhookLink";
import { nextStep, stepPath, stepIndex } from "@/lib/onboarding";
import { StepFrame } from "../../StepFrame";
import { Light } from "../../Light";
import { AutoRefresh } from "../../AutoRefresh";
import { Copyable } from "../../Copyable";
import { PasteField } from "./PasteField";
import { saveWebhookSecretAction } from "../actions";
import type { loadStepContext } from "../checks";

type Ctx = Awaited<ReturnType<typeof loadStepContext>>;

export function StripeWebhook({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, setup } = ctx;
  // The signing secret alone. A stored key says nothing about this step, and
  // reading both from one flag hid the paste form from the one person who
  // still needed it.
  const next = nextStep("stripe-webhook", ctx.emailRequired)!;
  return (
    <StepFrame index={stepIndex("stripe-webhook", ctx.emailRequired)} total={ctx.total} title="Let Stripe tell Supaffi about sales">
      <AutoRefresh active={setup.stripeWebhookStored && !checks.stripe.webhook.ok} />
      <Button variant="secondary" className="w-fit cursor-pointer" render={<a href={webhookCreateUrl(merchant.domain)} target="_blank" rel="noreferrer" />}>
        Create webhook in Stripe
      </Button>
      <details className="-mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">If the form opens empty</summary>
        <div className="mt-2 flex flex-col gap-2">
          <span>Endpoint</span>
          <Copyable value={webhookEndpointUrl(merchant.domain)} />
          <span>Events: {WEBHOOK_EVENTS.join(", ")}</span>
        </div>
      </details>

      {setup.stripeWebhookStored ? (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-border/70 p-4">
            <Light result={checks.stripe.webhook} label="Stripe is sending events" />
            {!checks.stripe.webhook.ok && (
              <p className="pl-6 text-xs text-muted-foreground">
                In Stripe, open the webhook you just made and click Send test event.
              </p>
            )}
          </div>
          <div>
            <Button size="lg" className="cursor-pointer" render={<Link href={stepPath(merchant.slug, next)} />}>
              Continue
            </Button>
          </div>
        </>
      ) : (
        <PasteField
          label="Then paste the signing secret"
          placeholder="whsec_..."
          action={saveWebhookSecretAction.bind(null, { id: merchant.id, slug: merchant.slug })}
          submitLabel="Save"
        />
      )}
    </StepFrame>
  );
}
