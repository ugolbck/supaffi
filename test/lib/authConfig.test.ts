import { describe, it, expect } from "vitest";
import { authConfig } from "@/lib/auth.config";

describe("authConfig session callback", () => {
  it("copies token.sub onto session.user.id", async () => {
    const session = {
      user: { name: null, email: "owner@example.com", image: null },
      expires: "2099-01-01T00:00:00.000Z",
    };
    const token = { sub: "owner-id-123" };

    const result = await authConfig.callbacks!.session!({
      session,
      token,
    } as Parameters<NonNullable<NonNullable<typeof authConfig.callbacks>["session"]>>[0]);

    expect(result.user?.id).toBe("owner-id-123");
    expect(result.user?.email).toBe("owner@example.com");
  });

  it("copies token.role onto session.user.role", async () => {
    const session = {
      user: { name: null, email: "affiliate@example.com", image: null },
      expires: "2099-01-01T00:00:00.000Z",
    };
    const token = { sub: "affiliate-id-456", role: "affiliate" };

    const result = await authConfig.callbacks!.session!({
      session,
      token,
    } as Parameters<NonNullable<NonNullable<typeof authConfig.callbacks>["session"]>>[0]);

    expect(result.user?.role).toBe("affiliate");
  });
});

describe("authConfig jwt callback", () => {
  it("copies user.role onto token.role when a user is present (sign-in)", async () => {
    const token = { sub: "owner-id-123" };
    const user = { id: "owner-id-123", email: "owner@example.com", role: "owner" };

    const result = await authConfig.callbacks!.jwt!({
      token,
      user,
    } as Parameters<NonNullable<NonNullable<typeof authConfig.callbacks>["jwt"]>>[0]);

    expect(result!.role).toBe("owner");
  });

  it("leaves token.role untouched when no user is present (session refresh)", async () => {
    const token = { sub: "owner-id-123", role: "owner" };

    const result = await authConfig.callbacks!.jwt!({
      token,
    } as Parameters<NonNullable<NonNullable<typeof authConfig.callbacks>["jwt"]>>[0]);

    expect(result!.role).toBe("owner");
  });
});
