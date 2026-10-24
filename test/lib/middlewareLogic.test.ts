import { describe, it, expect } from "vitest";
import { resolveLoginRedirect, resolveProductDomainRoute } from "@/lib/middlewareLogic";

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

  it("sends a visitor with no session away from onboarding", () => {
    expect(resolveLoginRedirect("/onboarding", null)).toBe("/login");
    expect(resolveLoginRedirect("/onboarding/instantgradient/terms", "affiliate")).toBe("/login");
    expect(resolveLoginRedirect("/onboarding", "owner")).toBeNull();
  });
});

describe("resolveProductDomainRoute", () => {
  it("answers not found for the Owner's pages", () => {
    for (const path of ["/login", "/dashboard", "/dashboard/products/acme", "/onboarding/acme/stripe", "/setup"]) {
      expect(resolveProductDomainRoute(path), path).toEqual({ notFound: true });
    }
  });

  it("sends the root to the affiliate login", () => {
    expect(resolveProductDomainRoute("/")).toEqual({ redirect: "/affiliates/login" });
  });

  it("leaves affiliate pages and look-alike paths alone", () => {
    for (const path of ["/affiliates/login", "/affiliates/dashboard", "/affiliates/signup/standard", "/loginx", "/dashboards"]) {
      expect(resolveProductDomainRoute(path), path).toBeNull();
    }
  });
});
