import { describe, it, expect } from "vitest";
import { clientAddress } from "@/lib/clientAddress";

describe("clientAddress", () => {
  it("takes the entry the nearest proxy appended, not one the client sent", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" });
    expect(clientAddress(headers)).toBe("203.0.113.9");
  });

  it("reads a single entry", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": " 203.0.113.9 " }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then to nothing", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers({ "x-forwarded-for": " , " }))).toBeNull();
    expect(clientAddress(new Headers())).toBeNull();
  });
});
