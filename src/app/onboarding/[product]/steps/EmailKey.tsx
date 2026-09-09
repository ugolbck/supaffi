import { Button } from "@/components/ui/button";
import { stepIndex } from "@/lib/onboarding";
import { StepFrame } from "../../StepFrame";
import { Light } from "@/components/dashboard/Light";
import { PasteField } from "@/components/PasteField";
import { saveEmailKeyAction } from "../actions";
import type { Ctx } from "../checks";

export function EmailKey({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, setup } = ctx;
  return (
    <StepFrame
      index={stepIndex("email-key", ctx.emailRequired)}
      total={ctx.total}
      title="Let Supaffi email your affiliates"
      lede="Affiliates log in with a link sent to their inbox."
    >
      <Button variant="secondary" className="w-fit cursor-pointer" render={<a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" />}>
        Create key in Resend
      </Button>
      {setup.emailConnected && (
        <div className="rounded-(--radius-md) border border-border/70 p-4">
          <Light result={checks.email.key} label="Key works" />
        </div>
      )}
      <PasteField
        label={setup.emailConnected ? "Replace the key" : "Then paste it here"}
        placeholder="re_..."
        action={saveEmailKeyAction.bind(null, { id: merchant.id, slug: merchant.slug })}
      />
    </StepFrame>
  );
}
