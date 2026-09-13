import { describe, expect, it } from "vitest";
import { pageList } from "@/lib/pagination";

describe("pageList", () => {
  it("shows every page when there are seven or fewer", () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the first pages together near the start", () => {
    expect(pageList(1, 120)).toEqual([1, 2, 3, 4, 5, "gap", 120]);
    expect(pageList(3, 120)).toEqual([1, 2, 3, 4, 5, "gap", 120]);
  });

  it("puts gaps on both sides in the middle", () => {
    expect(pageList(50, 120)).toEqual([1, "gap", 49, 50, 51, "gap", 120]);
  });

  it("keeps the last pages together near the end", () => {
    expect(pageList(120, 120)).toEqual([1, "gap", 116, 117, 118, 119, 120]);
    expect(pageList(118, 120)).toEqual([1, "gap", 116, 117, 118, 119, 120]);
  });

  it("never shows more than seven slots", () => {
    for (let page = 1; page <= 40; page += 1) {
      expect(pageList(page, 40).length).toBeLessThanOrEqual(7);
    }
  });
});
