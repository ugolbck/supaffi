// markPayoutsPaidAction hands the ledger's outcome to the Payouts page in the
// URL. The ledger and the session are stubbed: this is about what reaches the
// URL, not about what the ledger decides.
import { describe, it, expect, vi, beforeEach } from "vitest";

const markMock = vi.fn();
vi.mock("@/lib/commission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commission")>()),
  markPayoutsPaid: (...args: unknown[]) => markMock(...args),
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: "owner-1", role: "owner" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import { markPayoutsPaidAction } from "@/app/dashboard/products/[product]/payouts/payoutActions";

const PRODUCT = { id: "m1", slug: "acme" };
const BASE = "/dashboard/products/acme/payouts";

const READY = { tab: "ready", currency: null, method: null };

async function target(fields: Record<string, string> = {}, view: { tab: string; currency: string | null; method: string | null } = READY): Promise<string> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  try {
    await markPayoutsPaidAction(PRODUCT, view, [[{ id: "c1", amount: "10.00" }]], new Date().toISOString(), form);
  } catch (error) {
    return (error as Error).message.replace("redirect:", "");
  }
  throw new Error("no redirect");
}

const NOTHING = { payouts: 0, skipped: 0, alreadyPaid: 0, alreadyPaidAt: null, error: null };

describe("markPayoutsPaidAction", () => {
  beforeEach(() => markMock.mockReset());

  it("passes the reference and note typed in the dialog to the ledger", async () => {
    markMock.mockResolvedValue({ ...NOTHING, payouts: 1 });
    await target({ reference: "TX-1", note: "late" });
    expect(markMock).toHaveBeenCalledWith("owner-1", "m1", [[{ id: "c1", amount: "10.00" }]], expect.any(String), {
      reference: "TX-1",
      note: "late",
    });
  });

  it("says how many payouts were recorded", async () => {
    markMock.mockResolvedValue({ ...NOTHING, payouts: 3 });
    expect(await target()).toBe(`${BASE}?paid=3`);
  });

  it("reports rows that were already paid, and whether anything else was recorded", async () => {
    markMock.mockResolvedValue({ ...NOTHING, alreadyPaid: 2, alreadyPaidAt: new Date(1_700_000_000_000) });
    expect(await target()).toBe(`${BASE}?already=2&paidOn=1700000000000`);
    markMock.mockResolvedValue({ ...NOTHING, payouts: 1, alreadyPaid: 1 });
    expect(await target()).toBe(`${BASE}?paid=1&already=1&recorded=1`);
  });

  it("turns the first refusal into a code next to what was still recorded", async () => {
    markMock.mockResolvedValue({ ...NOTHING, payouts: 1, error: "A payout covers one affiliate and one currency at a time" });
    expect(await target()).toBe(`${BASE}?error=mixed&paid=1`);
  });

  it("comes back to the tab and filters it was pressed on, and drops anything else", async () => {
    markMock.mockResolvedValue({ ...NOTHING, payouts: 1 });
    expect(await target({}, { tab: "below", currency: "eur", method: "paypal" })).toBe(
      `${BASE}?tab=below&currency=eur&method=paypal&paid=1`
    );
    expect(await target({}, { tab: "x", currency: "../../", method: "a b" })).toBe(`${BASE}?paid=1`);
  });
});
