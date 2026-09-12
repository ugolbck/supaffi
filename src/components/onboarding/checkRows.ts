import type { CheckResult } from "@/lib/checks/dns";

export type CheckState = "pending" | "ok" | "failed";

/**
 * A check carries one line of copy per state, never one line written in the
 * passed tense and shown in all three.
 *
 * That was the bug worth naming: a grey, still-waiting row that read "Script
 * found on your site" told the user the opposite of the truth, and a red row
 * saying "nothing there yet" could not be told apart from one still working.
 * Waiting says it is waiting, passing says it worked, failing says what is
 * wrong.
 */
export type CheckRow = {
  id: string;
  state: CheckState;
  /** While we are still looking. */
  pending: string;
  /** Once it worked. Confirms, rather than merely naming the check. */
  passed: string;
  /** Only when it is definitely wrong, not merely not-yet. */
  failed?: string;
  /** What to do about a failure. Never rendered in any other state. */
  hint?: string;
  /**
   * A circled question mark beside the row, with this on hover. For the one
   * thing a row cannot say in four words: why it is allowed to stay amber
   * while the Owner moves on.
   */
  info?: string;
  /** Sits at the row's right edge: the one thing you can do about this row. */
  action?: React.ReactNode;
};

/**
 * One place for the ternary every call site was repeating: ok is ok, and
 * otherwise `pendingWhen` decides whether the check's own detail describes
 * something that has simply not appeared yet (pending) or an answer that
 * arrived and is wrong (failed). Without this, a wrongly pointed record and
 * one that was never created read as the same pulsing grey line.
 *
 * The predicates below read the detail strings written in `src/lib/checks/*`.
 * That coupling is by literal, so `test/components/onboarding/checkState.test.ts`
 * pins it: rename a detail there and the test says so.
 */
export function checkState(result: CheckResult, pendingWhen: (detail: string) => boolean): CheckState {
  if (result.ok) return "ok";
  // Nobody has looked yet: the screen rendered before its checks did. Always
  // a wait, whatever the check, and never a cross.
  if (result.detail === NOT_LOOKED_YET) return "pending";
  return pendingWhen(result.detail) ? "pending" : "failed";
}

/** The placeholder `runProductChecks` serves while a section runs behind the request. */
export const NOT_LOOKED_YET = "Checking";

/** `resolvesTo`: the name is simply not in DNS yet. Anything else is an answer, and a wrong one. */
export const dnsPending = (detail: string) => detail.startsWith("No record");

/**
 * The certificate is nobody's task. It arrives on its own once the record is
 * right, so every state short of issued is a wait rather than a failure: a
 * red cross here sends the Owner looking for a job that does not exist.
 */
export const certificatePending = (detail: string) =>
  detail.startsWith("Being set up") || detail.startsWith("Waiting") || detail === "Nothing answered";

/**
 * `sendingDomainVerified`: not added in Resend yet, added and still being
 * verified there, or Resend not answering. Every one of them is a wait: the
 * answer can only come from Resend, and it comes when it comes.
 */
export const emailDomainPending = (detail: string) =>
  detail.startsWith("Add ") ||
  detail.startsWith("Added, ") ||
  detail === "Could not reach Resend";

/**
 * `resendKeyWorks`: no key stored, or Resend never answered. Both mean we do
 * not know yet. A key Resend actively rejected is an answer, and a failure.
 */
export const emailKeyPending = (detail: string) =>
  detail === "Not connected yet" || detail === "Could not reach Resend";

/**
 * `stripeKeyWorks`: nothing stored, or Stripe never answered. A key Stripe
 * actively rejected is an answer, and a failure.
 */
export const stripeKeyPending = (detail: string) =>
  detail === "Not connected yet" || detail === "Could not reach Stripe";

/**
 * `scriptFound`: the page loaded and the script is not on it yet, which on
 * the tracking step is the state every owner arrives in, before they have
 * pasted anything. A site that could not be loaded at all is a failure.
 */
export const trackingPending = (detail: string) => detail.startsWith("Not found");

type DnsChecks = { resolves: CheckResult; https: CheckResult; certificate: CheckResult };

/**
 * The subdomain's two rows, in one place because the onboarding step and the
 * product settings page show the same pair and had drifted into two copies of
 * the same four strings.
 *
 * The certificate row folds two checks into one line: nothing is issued until
 * the record resolves, so a separate amber row for it would only ever repeat
 * what the row above already says.
 */
export function dnsCheckRows(dns: DnsChecks): CheckRow[] {
  return [
    {
      id: "dns",
      state: checkState(dns.resolves, dnsPending),
      // Says whose move it is. "Waiting for your DNS to update" reads as a
      // wait on someone else, so an Owner who has not added the record yet
      // sits watching a dot and pressing check now.
      pending: "Your DNS does not have this record yet",
      passed: "Your subdomain points here",
      failed: dns.resolves.detail,
      hint: "Check the name and the address on the record above.",
    },
    {
      id: "cert",
      state:
        dns.https.ok && dns.certificate.ok
          ? "ok"
          : checkState(dns.certificate, certificatePending),
      pending: "Setting up the secure connection",
      passed: "Secured with HTTPS",
      failed: dns.certificate.detail,
      hint: "Check the record above matches exactly.",
      info: "This happens on its own, usually within a minute of the record above going green. There is nothing for you to do.",
    },
  ];
}
