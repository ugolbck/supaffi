import { describe, it, expect } from "vitest";
import { commissionLine } from "@/lib/programCommission";

describe("commissionLine", () => {
  it("reads a FOREVER Program aloud", () => {
    expect(commissionLine(30, "FOREVER", null)).toBe("30% forever");
  });

  it("reads a FIXED_MONTHS Program aloud", () => {
    expect(commissionLine(40, "FIXED_MONTHS", 12)).toBe("40% for 12 months");
  });

  it("does not pluralize a single month", () => {
    expect(commissionLine(40, "FIXED_MONTHS", 1)).toBe("40% for 1 month");
  });

  // The schema allows FIXED_MONTHS with no month count even though the form
  // never produces that combination today. This is the guard that keeps a
  // stray row from rendering "30% for null months".
  it("falls back honestly when FIXED_MONTHS has no month count", () => {
    expect(commissionLine(30, "FIXED_MONTHS", null)).toBe("30% for a fixed term");
  });

  it("reads a ONE_TIME Program aloud", () => {
    expect(commissionLine(15, "ONE_TIME", null)).toBe("15% one time");
  });
});
