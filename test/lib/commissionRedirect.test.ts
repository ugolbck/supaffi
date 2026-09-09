import { describe, it, expect } from "vitest";
import { safeListHref } from "@/lib/commissionRedirect";

const BASE = "/dashboard/products/acme/commissions";

describe("safeListHref", () => {
  it("keeps the list the owner was on, query and all", () => {
    expect(safeListHref(`${BASE}?status=PAYABLE&affiliate=abc&page=2`, BASE)).toBe(
      `${BASE}?status=PAYABLE&affiliate=abc&page=2`
    );
  });

  it("keeps a bare list href", () => {
    expect(safeListHref(BASE, BASE)).toBe(BASE);
  });

  it("falls back when dot segments walk out of the ledger", () => {
    // Starts with the ledger path and resolves to the settings page.
    expect(safeListHref(`${BASE}/../../other/settings`, BASE)).toBe(BASE);
  });

  it("falls back on an absolute URL", () => {
    expect(safeListHref(`https://elsewhere.example${BASE}`, BASE)).toBe(BASE);
  });

  it("falls back on a protocol-relative host", () => {
    expect(safeListHref(`//elsewhere.example${BASE}`, BASE)).toBe(BASE);
  });

  it("falls back on another product's ledger", () => {
    expect(safeListHref("/dashboard/products/other/commissions", BASE)).toBe(BASE);
  });

  it("falls back on a path that only starts with the ledger", () => {
    expect(safeListHref(`${BASE}/export`, BASE)).toBe(BASE);
  });

  it("falls back on an empty href", () => {
    expect(safeListHref("", BASE)).toBe(BASE);
  });
});
