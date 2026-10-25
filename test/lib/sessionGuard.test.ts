import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

const ownerSessionIsCurrent = vi.fn();
const affiliateSessionIsCurrent = vi.fn();
vi.mock("@/lib/ownerExists", () => ({ ownerSessionIsCurrent }));
vi.mock("@/lib/affiliateSession", () => ({ affiliateSessionIsCurrent }));

const { dropSessionIfStale } = await import("@/lib/sessionGuard");

const sessionFor = (role: "owner" | "affiliate") =>
  ({
    user: { id: "u1", role, email: "a@example.com", name: null, image: null },
    expires: "2099-01-01T00:00:00.000Z",
  }) as unknown as Session;

const tokenFor = (role: "owner" | "affiliate" | undefined) =>
  ({ sub: "u1", role, authAt: 1000 }) as JWT;

describe("dropSessionIfStale", () => {
  beforeEach(() => {
    ownerSessionIsCurrent.mockReset();
    affiliateSessionIsCurrent.mockReset();
  });

  it("strips id and role from an affiliate session issued before the password change", async () => {
    affiliateSessionIsCurrent.mockResolvedValue(false);
    const result = await dropSessionIfStale(sessionFor("affiliate"), tokenFor("affiliate"));
    expect(affiliateSessionIsCurrent).toHaveBeenCalledWith("u1", 1000);
    expect(ownerSessionIsCurrent).not.toHaveBeenCalled();
    expect(result.user).not.toHaveProperty("id");
    expect(result.user).not.toHaveProperty("role");
    expect(result.user.email).toBe("a@example.com");
  });

  it("keeps a current affiliate session", async () => {
    affiliateSessionIsCurrent.mockResolvedValue(true);
    const session = sessionFor("affiliate");
    expect(await dropSessionIfStale(session, tokenFor("affiliate"))).toBe(session);
  });

  it("strips a stale owner session, checked against the owner lookup only", async () => {
    ownerSessionIsCurrent.mockResolvedValue(false);
    const result = await dropSessionIfStale(sessionFor("owner"), tokenFor("owner"));
    expect(ownerSessionIsCurrent).toHaveBeenCalledWith("u1", 1000);
    expect(affiliateSessionIsCurrent).not.toHaveBeenCalled();
    expect(result.user).not.toHaveProperty("id");
    expect(result.user).not.toHaveProperty("role");
  });

  it("leaves a token with no role or no subject alone", async () => {
    const session = sessionFor("owner");
    expect(await dropSessionIfStale(session, tokenFor(undefined))).toBe(session);
    expect(await dropSessionIfStale(session, {} as JWT)).toBe(session);
    expect(ownerSessionIsCurrent).not.toHaveBeenCalled();
    expect(affiliateSessionIsCurrent).not.toHaveBeenCalled();
  });
});
