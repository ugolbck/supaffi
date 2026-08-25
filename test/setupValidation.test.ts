import { describe, it, expect } from "vitest";
import { validateSetupInput } from "@/app/setup/actions";

describe("validateSetupInput", () => {
  it("accepts valid input", () => {
    expect(validateSetupInput("ugo@example.com", "correct horse battery staple", "correct horse battery staple")).toBeNull();
  });

  it("rejects a missing email", () => {
    expect(validateSetupInput("", "somepassword123", "somepassword123")).toBe("Email is required");
  });

  it("rejects a whitespace-only email", () => {
    expect(validateSetupInput("   ", "somepassword123", "somepassword123")).toBe("Email is required");
  });

  it("rejects an email missing an @", () => {
    expect(validateSetupInput("notanemail", "somepassword123", "somepassword123")).toBe(
      "Enter a valid email address"
    );
  });

  it("rejects mismatched passwords", () => {
    expect(validateSetupInput("ugo@example.com", "password one", "password two")).toBe(
      "Passwords do not match"
    );
  });

  it("rejects a too-short password", () => {
    expect(validateSetupInput("ugo@example.com", "short", "short")).toBe(
      "Password must be at least 12 characters"
    );
  });
});
