import { describe, it, expect } from "vitest";
import { alreadyPaidNote, alreadyPaidParams } from "@/lib/payoutNotices";

const ON = String(Date.UTC(2020, 2, 4));

describe("alreadyPaidNote", () => {
  it("says nothing without a count", () => {
    expect(alreadyPaidNote(undefined, ON, undefined)).toBeNull();
    expect(alreadyPaidNote("0", ON, undefined)).toBeNull();
    expect(alreadyPaidNote("abc", ON, undefined)).toBeNull();
  });

  it("says nothing was recorded when the press recorded nothing", () => {
    expect(alreadyPaidNote("2", ON, undefined)).toBe("Already marked paid on 4 Mar 2020. Nothing recorded.");
  });

  it("drops the date when it is missing or unreadable", () => {
    expect(alreadyPaidNote("1", undefined, undefined)).toBe("Already marked paid. Nothing recorded.");
    expect(alreadyPaidNote("1", "soon", undefined)).toBe("Already marked paid. Nothing recorded.");
  });

  it("says what was left out when the press still recorded other rows", () => {
    expect(alreadyPaidNote("1", ON, "1")).toBe("1 already marked paid on 4 Mar 2020, not recorded again.");
    expect(alreadyPaidNote("3", ON, "1")).toBe("3 already marked paid on 4 Mar 2020, not recorded again.");
  });
});

describe("alreadyPaidParams", () => {
  it("adds nothing when no row was already paid", () => {
    expect(alreadyPaidParams({ count: 2 })).toEqual({});
  });

  it("carries the count and date, and whether other rows were recorded", () => {
    const paidAt = new Date(1_700_000_000_000);
    expect(alreadyPaidParams({ count: 0, alreadyPaid: { count: 2, paidAt } })).toEqual({
      already: "2",
      paidOn: "1700000000000",
    });
    expect(alreadyPaidParams({ count: 1, alreadyPaid: { count: 1, paidAt: null } })).toEqual({
      already: "1",
      recorded: "1",
    });
  });
});
