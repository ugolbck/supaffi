import { describe, it, expect } from "vitest";
import { shouldRedirectToLogin } from "@/lib/middlewareLogic";

describe("shouldRedirectToLogin", () => {
  it("redirects an unauthenticated request to a protected path", () => {
    expect(shouldRedirectToLogin("/dashboard", false)).toBe(true);
  });

  it("does not redirect an authenticated request to a protected path", () => {
    expect(shouldRedirectToLogin("/dashboard", true)).toBe(false);
  });

  it("does not redirect an unauthenticated request to a public path", () => {
    expect(shouldRedirectToLogin("/login", false)).toBe(false);
    expect(shouldRedirectToLogin("/setup", false)).toBe(false);
    expect(shouldRedirectToLogin("/", false)).toBe(false);
  });
});
