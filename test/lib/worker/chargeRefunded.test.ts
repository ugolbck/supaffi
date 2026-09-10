import { describe, it, expect } from "vitest";
import { prorateCommission } from "@/lib/worker/handlers/chargeRefunded";

describe("prorateCommission", () => {
  it("voids when the whole sale came back", () => {
    expect(prorateCommission({ gross: 15.6, chargeTotal: 7800, refunded: 7800 })).toEqual({
      void: true,
    });
  });

  it("takes the same fraction off the commission as came off the sale", () => {
    // Half the sale refunded, half the commission survives.
    expect(prorateCommission({ gross: 15.6, chargeTotal: 7800, refunded: 3900 })).toEqual({
      void: false,
      amount: 7.8,
    });
  });

  it("prorates against the original, so a second partial refund does not compound", () => {
    const first = prorateCommission({ gross: 15.6, chargeTotal: 7800, refunded: 1950 });
    const second = prorateCommission({ gross: 15.6, chargeTotal: 7800, refunded: 3900 });
    expect(first).toEqual({ void: false, amount: 11.7 });
    expect(second).toEqual({ void: false, amount: 7.8 });
  });

  it("voids rather than leaving a zero row when rounding wipes it out", () => {
    expect(prorateCommission({ gross: 0.02, chargeTotal: 10000, refunded: 9999 })).toEqual({
      void: true,
    });
  });
});
