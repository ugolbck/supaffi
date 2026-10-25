// markPaidAction (the commission sheet's Mark paid) hands the ledger's outcome
// back to the list in the URL. The ledger and the session are stubbed.
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

import { markPaidAction } from "@/app/dashboard/products/[product]/commissions/commissionActions";

const PRODUCT = { id: "m1", slug: "acme" };
const LIST = "/dashboard/products/acme/commissions?status=PAYABLE";

async function target(): Promise<string> {
  try {
    await markPaidAction(LIST, PRODUCT, [{ id: "c1", amount: "10.00" }], new Date().toISOString());
  } catch (error) {
    return (error as Error).message.replace("redirect:", "");
  }
  throw new Error("no redirect");
}

describe("markPaidAction", () => {
  beforeEach(() => markMock.mockReset());

  it("goes back to the list with no notice when the row was recorded", async () => {
    markMock.mockResolvedValue({ count: 1, skipped: 0 });
    expect(await target()).toBe(LIST);
  });

  it("reports a row that was already paid, with when", async () => {
    markMock.mockResolvedValue({ count: 0, skipped: 0, alreadyPaid: { count: 1, paidAt: new Date(1_700_000_000_000) } });
    expect(await target()).toBe(`${LIST}&already=1&paidOn=1700000000000`);
  });
});
