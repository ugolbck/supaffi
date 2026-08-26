import { describe, it, expect } from "vitest";
import { resolveLoginRedirect } from "@/lib/middlewareLogic";

describe("resolveLoginRedirect", () => {
  it("redirects an unauthenticated request to the Owner dashboard", () => {
    expect(resolveLoginRedirect("/dashboard", null)).toBe("/login");
  });

  it("does not redirect an Owner session on the Owner dashboard", () => {
    expect(resolveLoginRedirect("/dashboard", "owner")).toBe(null);
  });

  it("redirects an Affiliate session away from the Owner dashboard", () => {
    expect(resolveLoginRedirect("/dashboard", "affiliate")).toBe("/login");
  });

  it("redirects an unauthenticated request to the Affiliate dashboard", () => {
    expect(resolveLoginRedirect("/affiliates/dashboard", null)).toBe("/affiliates/login");
  });

  it("does not redirect an Affiliate session on the Affiliate dashboard", () => {
    expect(resolveLoginRedirect("/affiliates/dashboard", "affiliate")).toBe(null);
  });

  it("redirects an Owner session away from the Affiliate dashboard", () => {
    expect(resolveLoginRedirect("/affiliates/dashboard", "owner")).toBe("/affiliates/login");
  });

  it("does not redirect requests to public paths", () => {
    expect(resolveLoginRedirect("/login", null)).toBe(null);
    expect(resolveLoginRedirect("/affiliates/login", null)).toBe(null);
    expect(resolveLoginRedirect("/setup", null)).toBe(null);
    expect(resolveLoginRedirect("/", null)).toBe(null);
  });
});
