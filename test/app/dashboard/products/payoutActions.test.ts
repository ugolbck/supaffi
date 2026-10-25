// markPayoutPaidAction hands the ledger's outcome to the Payouts page in the
// URL. The ledger and the session are stubbed: this is about what reaches the
// URL, not about what the ledger decides.
import { describe, it, expect, vi, beforeEach } from "vitest";

const markMock = vi.fn();
vi.mock("@/lib/commission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commission")>()),
  markCommissionsPaid: (...args: unknown[]) => markMock(...args),
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

import { markPayoutPaidAction } from "@/app/dashboard/products/[product]/payouts/payoutActions";

const PRODUCT = { id: "m1", slug: "acme" };
const BASE = "/dashboard/products/acme/payouts";

async function target(): Promise<string> {
  try {
    await markPayoutPaidAction(PRODUCT, [{ id: "c1", amount: "10.00" }], new Date().toISOString());
  } catch (error) {
    return (error as Error).message.replace("redirect:", "");
  }
  throw new Error("no redirect");
}

describe("markPayoutPaidAction", () => {
  beforeEach(() => markMock.mockReset());

  it("goes back with no notice when everything was recorded", async () => {
    markMock.mockResolvedValue({ count: 2, skipped: 0 });
    expect(await target()).toBe(BASE);
  });

  it("reports rows that were already paid, with when, when nothing was recorded", async () => {
    markMock.mockResolvedValue({ count: 0, skipped: 0, alreadyPaid: { count: 2, paidAt: new Date(1_700_000_000_000) } });
    expect(await target()).toBe(`${BASE}?already=2&paidOn=1700000000000`);
  });

  it("flags a press that recorded some rows and found others already paid", async () => {
    markMock.mockResolvedValue({ count: 1, skipped: 0, alreadyPaid: { count: 1, paidAt: null } });
    expect(await target()).toBe(`${BASE}?already=1&recorded=1`);
  });
});
