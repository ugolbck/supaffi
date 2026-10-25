import { describe, it, expect } from "vitest";
import { alreadyPaidNote } from "@/lib/payoutNotices";

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
    expect(alreadyPaidNote("1", ON, "1")).toBe("1 commission was already marked paid on 4 Mar 2020 and was not recorded again.");
    expect(alreadyPaidNote("3", ON, "1")).toBe("3 commissions were already marked paid on 4 Mar 2020 and were not recorded again.");
  });
});
