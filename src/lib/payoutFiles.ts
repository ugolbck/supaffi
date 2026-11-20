import { parsePayoutDetails } from "@/lib/payoutMethod";

/**
 * The files PayPal and Wise take for paying many people at once, built from
 * the payouts the Owner ticked. Pure, so the Payouts page builds them in the
 * browser and nothing about a payout leaves the page.
 *
 * PayPal Payouts (web upload): no header row, columns recipient, amount,
 * currency, customer id, note, wallet. One currency per file, 5,000 rows at
 * most. https://developer.paypal.com/payouts/use-payouts/send-money/use-web-ui
 *
 * Wise batch payment, paying by email: a header row, one source currency per
 * file, 1,000 rows at most.
 */

export type FilePayout = {
  affiliateId: string;
  affiliateName: string | null;
  affiliateEmail: string;
  payoutDetails: string | null;
  currency: string;
  /** Two decimals, as the page shows it. */
  total: string;
};

export type PayoutFile = {
  csv: string;
  /** Payouts in the file. */
  included: number;
  /** Payouts left out because the affiliate gave no email for this method. */
  excluded: number;
};

export const PAYPAL_MAX_ROWS = 5000;
export const WISE_MAX_ROWS = 1000;

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/**
 * One field. Quoted when it has to be, and a leading character a spreadsheet
 * would run as a formula is neutralised, since names and notes are typed by
 * affiliates and the Owner may open the file before uploading it.
 */
function field(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function row(values: string[]): string {
  return values.map(field).join(",");
}

/** The email the affiliate gave for this method, or null. */
function emailFor(payout: FilePayout, method: "paypal" | "wise"): string | null {
  const parsed = parsePayoutDetails(payout.payoutDetails);
  if (parsed.method !== method) return null;
  return EMAIL.test(parsed.value) ? parsed.value : null;
}

/** The currencies in a selection: a file can only be built for exactly one. */
export function currenciesOf(payouts: FilePayout[]): string[] {
  return [...new Set(payouts.map((p) => p.currency))];
}

/** How many of these can go in a file for this method. */
export function countPayable(payouts: FilePayout[], method: "paypal" | "wise"): number {
  return payouts.filter((p) => emailFor(p, method) !== null).length;
}

export function paypalFile(payouts: FilePayout[], note: string): PayoutFile {
  const lines: string[] = [];
  for (const payout of payouts) {
    const email = emailFor(payout, "paypal");
    if (!email) continue;
    // PayPal takes at most 30 characters here; a longer id is left out rather than cut.
    const customerId = payout.affiliateId.length <= 30 ? payout.affiliateId : "";
    lines.push(row([email, payout.total, payout.currency.toUpperCase(), customerId, note.slice(0, 400), "PAYPAL"]));
  }
  return { csv: lines.join("\r\n") + (lines.length ? "\r\n" : ""), included: lines.length, excluded: payouts.length - lines.length };
}

export function wiseFile(payouts: FilePayout[]): PayoutFile {
  const lines = [row(["name", "recipientEmail", "amount", "sourceCurrency", "targetCurrency", "amountCurrency"])];
  for (const payout of payouts) {
    const email = emailFor(payout, "wise");
    if (!email) continue;
    const currency = payout.currency.toUpperCase();
    lines.push(row([payout.affiliateName ?? payout.affiliateEmail, email, payout.total, currency, currency, currency]));
  }
  return { csv: lines.join("\r\n") + "\r\n", included: lines.length - 1, excluded: payouts.length - (lines.length - 1) };
}
