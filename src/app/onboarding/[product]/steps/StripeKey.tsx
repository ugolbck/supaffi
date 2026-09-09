import Link from "next/link";
import { Button } from "@/components/ui/button";
import { restrictedKeyUrl } from "@/lib/stripeRestrictedKey";
import { stepIndex, stepPath } from "@/lib/onboarding";
import { StepFrame } from "../../StepFrame";
import { Light } from "../../Light";
import { PasteField } from "./PasteField";
import { saveStripeKeyAction } from "../actions";
import type { Ctx } from "../checks";

export function StripeKey({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, setup } = ctx;
  // The key alone, not the whole Stripe connection: someone who has pasted a
  // key and still owes the signing secret needs a way on to the webhook step,
  // not a screen that only offers to replace what it already has.
  const stored = setup.stripeKeyStored;
  return (
    <StepFrame
      index={stepIndex("stripe-key", ctx.emailRequired)}
      total={ctx.total}
      title="Let Supaffi read your Stripe payments"
      lede="Read only. Nothing is charged or created."
    >
      <Button variant="secondary" className="w-fit cursor-pointer" render={<a href={restrictedKeyUrl(merchant.name)} target="_blank" rel="noreferrer" />}>
        Create key in Stripe
      </Button>
      <p className="-mt-3 text-xs text-muted-foreground">Opens Stripe with the right permissions already set.</p>
      {stored ? (
        <>
          <div className="rounded-xl border border-border/70 p-4">
            <Light result={checks.stripe.key} label="Key works" />
          </div>
          <div>
            <Button size="lg" className="cursor-pointer" render={<Link href={stepPath(merchant.slug, "stripe-webhook")} />}>
              Continue
            </Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Replace the key</summary>
            <div className="mt-3">
              <PasteField
                label="Paste the new key"
                placeholder="rk_live_..."
                action={saveStripeKeyAction.bind(null, { id: merchant.id, slug: merchant.slug })}
                submitLabel="Save"
              />
            </div>
          </details>
        </>
      ) : (
        <PasteField
          label="Then paste it here"
          placeholder="rk_live_..."
          action={saveStripeKeyAction.bind(null, { id: merchant.id, slug: merchant.slug })}
        />
      )}
    </StepFrame>
  );
}
