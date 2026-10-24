import { describe, it, expect } from "vitest";
import {
  checkState,
  dnsCheckRows,
  dnsPending,
  stripeKeyPending,
  trackingPending,
} from "@/components/onboarding/checkRows";

/**
 * This file is the contract between `src/components/onboarding/checkRows.ts`
 * and the check modules it reads.
 *
 * `checkState` tells "has not happened yet" from "happened and is wrong" by
 * matching the front of a detail string that `src/lib/checks/dns.ts`,
 * `src/lib/checks/stripe.ts`, `src/lib/checks/script.ts` and
 * `src/lib/checks/product.ts` write. Nothing in the type system ties the two
 * together, so renaming a detail there would silently turn every waiting row
 * into a red cross and every red cross into a waiting row.
 *
 * Every string below is copied from those modules as they stand. A failure
 * here means one of them was reworded: update the predicate in `checkRows.ts`
 * and this file together, in that order.
 */

/** Verbatim from the check modules named above. */
const DETAIL = {
  // src/lib/checks/dns.ts
  noRecord: "No record found yet",
  wrongAddress: "Points at 1.2.3.4, not this server",
  certNotIssued: "Being set up",
  nothingAnswered: "Nothing answered",
  // src/lib/checks/stripe.ts
  stripeUnreachable: "Could not reach Stripe",
  // src/lib/checks/script.ts
  scriptMissing: "Not found on example.com",
  siteUnreachable: "Could not load the site",
  // src/lib/checks/product.ts
  notConnected: "Not connected yet",
} as const;

const ok = (detail: string) => ({ ok: true, detail });
const no = (detail: string) => ({ ok: false, detail });

describe("checkState", () => {
  it("passes when the check passed, whatever the detail says", () => {
    expect(checkState(ok("Points at 1.2.3.4"), dnsPending)).toBe("ok");
  });

  it("waits for a record that has not appeared in DNS yet", () => {
    expect(checkState(no(DETAIL.noRecord), dnsPending)).toBe("pending");
  });

  it("waits for a script the owner has not pasted yet", () => {
    // The state every owner is in when the tracking step opens. Red before
    // they have done anything is the thing this whole track exists to stop.
    expect(checkState(no(DETAIL.scriptMissing), trackingPending)).toBe("pending");
  });

  it("fails when an answer arrived and it is wrong, and carries its own words", () => {
    const wrong = no(DETAIL.wrongAddress);
    expect(checkState(wrong, dnsPending)).toBe("failed");
    expect(dnsCheckRows({ resolves: wrong, https: no(DETAIL.nothingAnswered), certificate: no("Waiting") })[0].failed).toBe(
      DETAIL.wrongAddress
    );

    expect(checkState(no(DETAIL.siteUnreachable), trackingPending)).toBe("failed");
  });

  it("waits, rather than failing, when no Stripe key is stored yet", () => {
    expect(checkState(no(DETAIL.notConnected), stripeKeyPending)).toBe("pending");
  });

  it("waits when Stripe never answered, because no answer is not a wrong answer", () => {
    expect(checkState(no(DETAIL.stripeUnreachable), stripeKeyPending)).toBe("pending");
  });
});

describe("dnsCheckRows", () => {
  it("is one pair of rows, so the step and the settings page cannot drift apart", () => {
    const rows = dnsCheckRows({
      resolves: ok("Points at 1.2.3.4"),
      https: ok("Answers"),
      certificate: ok("Valid"),
    });
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ["dns", "ok"],
      ["cert", "ok"],
    ]);
  });

  it("waits on the certificate while the record resolves and https is up", () => {
    const rows = dnsCheckRows({
      resolves: ok("Points at 1.2.3.4"),
      https: ok("Answers"),
      certificate: no(DETAIL.certNotIssued),
    });
    expect(rows[1].state).toBe("pending");
  });

  it("waits on both rows before the record exists", () => {
    const rows = dnsCheckRows({
      resolves: no(DETAIL.noRecord),
      https: no(DETAIL.noRecord),
      certificate: no("Waiting for the record"),
    });
    expect(rows.map((r) => r.state)).toEqual(["pending", "pending"]);
  });

  it("keeps waiting on the certificate even when nothing answered", () => {
    // The certificate is not a task anyone can do, so this row never turns
    // red on its own. Inside the app container the product's public address
    // often cannot be reached at all, on a host that does not route the
    // hairpin, while the site is perfectly fine from the internet. The row
    // that has something to say in that case is the record above.
    const rows = dnsCheckRows({
      resolves: ok("Points at 1.2.3.4"),
      https: no(DETAIL.nothingAnswered),
      certificate: no("Being set up"),
    });
    expect(rows[1].state).toBe("pending");
    expect(rows[1].pending).toBe("Setting up the secure connection");
  });
});
