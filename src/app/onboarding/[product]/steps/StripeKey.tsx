import { Button } from "@/components/ui/button";
import { restrictedKeyUrl } from "@/lib/stripeRestrictedKey";
import { stepIndex } from "@/lib/onboarding";
import { StepFrame } from "../../StepFrame";
import { Light } from "../../Light";
import { PasteField } from "./PasteField";
import { saveStripeKeyAction } from "../actions";
import type { loadStepContext } from "../checks";

type Ctx = Awaited<ReturnType<typeof loadStepContext>>;

export function StripeKey({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, setup } = ctx;
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
      {setup.stripeConnected ? (
        <div className="rounded-xl border border-border/70 p-4">
          <Light result={checks.stripe.key} label="Key works" />
        </div>
      ) : null}
      <PasteField
        label={setup.stripeConnected ? "Replace the key" : "Then paste it here"}
        placeholder="rk_live_..."
        action={saveStripeKeyAction.bind(null, { id: merchant.id, slug: merchant.slug })}
      />
    </StepFrame>
  );
}
