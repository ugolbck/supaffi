import { describe, it, expect } from "vitest";
import {
  checkState,
  dnsCheckRows,
  dnsPending,
  emailDomainPending,
  emailKeyPending,
  trackingPending,
} from "@/components/onboarding/checkRows";

/**
 * This file is the contract between `src/components/onboarding/checkRows.ts`
 * and the check modules it reads.
 *
 * `checkState` tells "has not happened yet" from "happened and is wrong" by
 * matching the front of a detail string that `src/lib/checks/dns.ts`,
 * `src/lib/checks/email.ts`, `src/lib/checks/script.ts` and
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
  certNotIssued: "Not issued yet. Usually a minute after DNS resolves.",
  nothingAnswered: "Nothing answered",
  // src/lib/checks/email.ts
  domainMissing: "Add affiliates.example.com in Resend",
  domainUnverified: "Added, pending. Check the records in Resend.",
  keyRejected: "Resend says this key is not valid",
  keyNotAKey: "That is not a Resend API key",
  resendUnreachable: "Could not reach Resend",
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
    expect(checkState(ok("Verified as affiliates.example.com"), emailDomainPending)).toBe("ok");
  });

  it("waits for a record that has not appeared in DNS yet", () => {
    expect(checkState(no(DETAIL.noRecord), dnsPending)).toBe("pending");
  });

  it("waits for a domain that is not in Resend yet, or not verified yet", () => {
    expect(checkState(no(DETAIL.domainMissing), emailDomainPending)).toBe("pending");
    expect(checkState(no(DETAIL.domainUnverified), emailDomainPending)).toBe("pending");
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

    expect(checkState(no(DETAIL.keyRejected), emailKeyPending)).toBe("failed");
    expect(checkState(no(DETAIL.keyNotAKey), emailKeyPending)).toBe("failed");
    expect(checkState(no(DETAIL.siteUnreachable), trackingPending)).toBe("failed");
  });

  it("waits, rather than failing, when nothing is connected to ask", () => {
    // The email domain check needs the Resend key, and the domain step now
    // comes first, so this is what the first email screen renders. It is not
    // a failure: the owner has not been asked for the key yet.
    expect(checkState(no(DETAIL.notConnected), emailKeyPending)).toBe("pending");
    // The domain row cannot read its own way out of this one: "Not connected
    // yet" is not one of its pending prefixes, which is why the step and the
    // settings page both gate on the stored key before asking at all.
    expect(checkState(no(DETAIL.notConnected), emailDomainPending)).toBe("failed");
  });

  it("waits when Resend never answered, because no answer is not a wrong answer", () => {
    expect(checkState(no(DETAIL.resendUnreachable), emailKeyPending)).toBe("pending");
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

  it("fails the https row when the site answered with something wrong", () => {
    const rows = dnsCheckRows({
      resolves: ok("Points at 1.2.3.4"),
      https: no(DETAIL.nothingAnswered),
      certificate: no("Waiting"),
    });
    expect(rows[1].state).toBe("failed");
    expect(rows[1].failed).toBe(DETAIL.nothingAnswered);
  });
});
