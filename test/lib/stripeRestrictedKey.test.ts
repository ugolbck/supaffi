import { describe, it, expect } from "vitest";

import { KEY_PERMISSIONS, keyName, restrictedKeyUrl } from "@/lib/stripeRestrictedKey";

/**
 * Stripe's key-creation form ignores an identifier it does not recognise: it
 * selects nothing, is not rejected, and is echoed back in the URL unchanged. A
 * typo produces a link that looks right, a form that looks right, and a key
 * that fails on the first refund lookup.
 *
 * No test suite can re-check the tokens against Stripe. What it can do is make
 * a change to them deliberate: anyone editing the list has to edit this file
 * too and say why.
 */
describe("restricted key link", () => {
  it("carries exactly the permissions Supaffi's Stripe calls need", () => {
    expect(KEY_PERMISSIONS.map((permission) => permission.token)).toEqual([
      "rak_customer_read",
      "rak_invoice_read",
      "rak_payment_intent_read",
      "rak_payment_method_read",
      "rak_subscription_read",
    ]);
  });

  it("asks for read on every one, since Supaffi never writes to Stripe", () => {
    for (const permission of KEY_PERMISSIONS) {
      expect(permission.token.endsWith("_read")).toBe(true);
    }
  });

  it("states each permission on its own unencoded permissions[] pair", () => {
    const url = restrictedKeyUrl("Mokkit");
    // A comma-joined single value is accepted by the URL and selects nothing,
    // which is the same invisible failure as a wrong identifier.
    expect(url).not.toMatch(/permissions(\[\])?=[^&]*(,|%2C)/);
    // Literal `permissions[]`, not the `permissions%5B%5D` that
    // `URLSearchParams.append` would produce. Only the unencoded form has been
    // put in front of the real dashboard.
    expect(url.match(/permissions\[\]=/g)).toHaveLength(KEY_PERMISSIONS.length);
    expect(url).not.toContain("permissions%5B%5D");
    expect(new URL(url).searchParams.getAll("permissions[]")).toEqual(
      KEY_PERMISSIONS.map((permission) => permission.token)
    );
  });

  it("escapes a product name that would otherwise break the query string", () => {
    const url = restrictedKeyUrl("Mokkit & Co #1");
    expect(new URL(url).searchParams.get("name")).toBe("Supaffi: Mokkit & Co #1");
    // The `&` and `#` must not have split the query or started a fragment,
    // which would silently drop every permission after the name.
    expect(new URL(url).searchParams.getAll("permissions[]")).toHaveLength(
      KEY_PERMISSIONS.length
    );
  });

  it("names the key after the product so several are tellable apart in Stripe", () => {
    expect(keyName("Mokkit")).toBe("Supaffi: Mokkit");
    expect(keyName("  Mokkit  ")).toBe("Supaffi: Mokkit");
    expect(keyName(undefined)).toBe("Supaffi");
    expect(keyName("   ")).toBe("Supaffi");
  });

  it("pins no account id, so Stripe's own picker chooses which account", () => {
    expect(restrictedKeyUrl("Mokkit")).not.toMatch(/acct_/);
    expect(restrictedKeyUrl("Mokkit")).toMatch(
      /^https:\/\/dashboard\.stripe\.com\/apikeys\/create\?/
    );
  });
});
