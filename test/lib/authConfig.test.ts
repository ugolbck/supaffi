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
});
