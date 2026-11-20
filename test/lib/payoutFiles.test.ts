import { describe, it, expect } from "vitest";
import { countPayable, currenciesOf, paypalFile, wiseFile, type FilePayout } from "@/lib/payoutFiles";

function payout(overrides: Partial<FilePayout>): FilePayout {
  return {
    affiliateId: "aff1",
    affiliateName: "Sarah",
    affiliateEmail: "sarah@example.com",
    payoutDetails: "PayPal: sarah@paypal.test",
    currency: "usd",
    total: "42.50",
    ...overrides,
  };
}

describe("paypalFile", () => {
  it("writes PayPal's columns with no header, and leaves out who gave no PayPal email", () => {
    const file = paypalFile(
      [
        payout({}),
        payout({ affiliateId: "aff2", payoutDetails: "Wise: w@example.com" }),
        payout({ affiliateId: "aff3", payoutDetails: null }),
        payout({ affiliateId: "aff4", payoutDetails: "PayPal: not an email" }),
      ],
      "Acme, Inc. affiliate commissions"
    );
    expect(file.csv).toBe('sarah@paypal.test,42.50,USD,aff1,"Acme, Inc. affiliate commissions",PAYPAL\r\n');
    expect(file).toMatchObject({ included: 1, excluded: 3 });
  });
});

describe("wiseFile", () => {
  it("writes a header and one row per Wise email, in the payout's currency", () => {
    const file = wiseFile([
      payout({ payoutDetails: "Wise: sarah@wise.test", currency: "eur", total: "10.00" }),
      payout({ affiliateName: null }),
    ]);
    expect(file.csv).toBe(
      "name,recipientEmail,amount,sourceCurrency,targetCurrency,amountCurrency\r\n" +
        "Sarah,sarah@wise.test,10.00,EUR,EUR,EUR\r\n"
    );
    expect(file).toMatchObject({ included: 1, excluded: 1 });
  });

  it("keeps a name a spreadsheet would run as a formula from running", () => {
    const file = wiseFile([payout({ affiliateName: '=HYPERLINK("x")', payoutDetails: "Wise: a@b.co" })]);
    expect(file.csv.split("\r\n")[1]).toBe(`"'=HYPERLINK(""x"")",a@b.co,42.50,USD,USD,USD`);
  });
});

describe("selection helpers", () => {
  it("names the currencies and counts who can be paid by each method", () => {
    const rows = [payout({}), payout({ currency: "eur", payoutDetails: "Wise: w@example.com" })];
    expect(currenciesOf(rows)).toEqual(["usd", "eur"]);
    expect(countPayable(rows, "paypal")).toBe(1);
    expect(countPayable(rows, "wise")).toBe(1);
  });
});
