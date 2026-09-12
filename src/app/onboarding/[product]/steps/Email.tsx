import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CheckList } from "@/components/onboarding/CheckList";
import { checkState, emailDomainPending, emailKeyPending } from "@/components/onboarding/checkRows";
import { RecordTable } from "@/components/onboarding/RecordTable";
import { StepShell } from "@/components/onboarding/StepShell";
import { TaskCard, TaskCardHeader, TaskCardSection } from "@/components/onboarding/TaskCard";
import { PasteField } from "@/components/PasteField";
import { resendDomainsUrl } from "@/lib/checks/email";
import { displayStep, nextStep, stepPath } from "@/lib/onboarding";
import { AutoRefresh } from "../../AutoRefresh";
import { recheckAction, saveEmailKeyAction } from "../actions";
import type { Ctx } from "../checks";

/**
 * One screen for the whole of Resend: add the domain, then paste a key.
 *
 * Nothing is checked until the key is in, because nothing can be: both
 * answers come from Resend and Resend will not answer without one. So the
 * screen is two tasks and a field, and the two lights arrive together the
 * moment the key is saved, rising into place rather than appearing.
 *
 * The key is the gate. Without it Supaffi cannot send a single login link,
 * so Continue waits for it. The domain is not a gate: verification can take
 * a while at the registrar's pace, the Owner can leave it running, and the
 * question mark on the row is where that is said.
 *
 * The key's settings are a record table, the same shape as the DNS record on
 * the step before. As a subtitle beside a heading they were a line you could
 * read past, and a key scoped to one domain is a setup that fails later, in
 * email nobody sees.
 */

const DOMAIN_INFO =
  "This may take a few minutes. Carry on with the next steps, the validation finishes on its own.";

export function Email({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, setup } = ctx;
  const connected = setup.emailConnected;
  const next = nextStep("email", ctx.emailRequired)!;
  const product = { id: merchant.id, slug: merchant.slug };

  const keyState = checkState(checks.email.key, emailKeyPending);
  const domainState = checkState(checks.email.domain, emailDomainPending);

  return (
    <StepShell
      step={displayStep("email", ctx.emailRequired)}
      title="Send email to your affiliates"
      lede="Affiliates log in with a link sent to their inbox."
      action={
        keyState === "ok" ? (
          <Button size="lg" render={<Link href={stepPath(merchant.slug, next)} />}>
            Continue
          </Button>
        ) : (
          // Shown and disabled rather than absent: the way forward is a fact
          // about this screen, and a button that appears out of nowhere when
          // a check flips is a screen that rearranges itself under the reader.
          <Button size="lg" disabled>
            Continue
          </Button>
        )
      }
    >
      <AutoRefresh active={connected && !(keyState === "ok" && domainState === "ok")} />

      <TaskCard>
        <TaskCardHeader
          title="1. Add this domain in Resend"
          action={
            <Button
              variant="secondary"
              size="sm"
              render={<a href={resendDomainsUrl()} target="_blank" rel="noreferrer" />}
            >
              <Image src="/logos/resend.svg" alt="" width={16} height={16} className="size-4" />
              Open Resend
            </Button>
          }
        />
        <TaskCardSection>
          <RecordTable records={[{ label: "Domain", value: merchant.domain }]} />
        </TaskCardSection>

        <TaskCardHeader title="2. Then create a key with these settings" />
        <TaskCardSection>
          <RecordTable
            records={[
              { label: "Access", value: "Full access", copyable: false },
              { label: "Domains", value: "All domains", copyable: false },
            ]}
          />
        </TaskCardSection>

        {connected ? (
          <TaskCardSection sunken className="supaffi-reveal">
            <CheckList
              rows={[
                {
                  id: "key",
                  state: keyState,
                  pending: "Checking your key",
                  passed: "Your key works",
                  failed: "Resend rejected that key",
                  hint: checks.email.key.detail || "Make a new one and paste it again.",
                },
                {
                  id: "domain",
                  state: domainState,
                  pending: `Checking ${merchant.domain} in Resend`,
                  passed: `${merchant.domain} is ready to send email`,
                  failed: checks.email.domain.detail,
                  hint: "Open Resend and add the records it asks for.",
                  info: DOMAIN_INFO,
                },
              ]}
              onRecheck={recheckAction.bind(null, product, "email")}
            />
          </TaskCardSection>
        ) : (
          <TaskCardSection className="p-4">
            <PasteField
              label="Paste it here"
              placeholder="re_..."
              action={saveEmailKeyAction.bind(null, product)}
              submitLabel="Add"
            />
          </TaskCardSection>
        )}
      </TaskCard>
    </StepShell>
  );
}
