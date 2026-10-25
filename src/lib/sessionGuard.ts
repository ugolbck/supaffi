import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { ownerSessionIsCurrent } from "@/lib/ownerExists";
import { affiliateSessionIsCurrent } from "@/lib/affiliateSession";

// The session callback's password-change check, kept apart from auth.ts so a
// test can import it: auth.ts pulls in next-auth, which Vitest's ESM resolver
// cannot load (see middlewareLogic.ts).
//
// Owner and Affiliate sessions are checked against the password-change stamp
// on their row. Sessions are JWTs with no adapter, so there is no session
// record to delete when the password changes; without this a stolen cookie
// would keep working for its full 30 days. The lookups are Prisma, so they
// live outside auth.config.ts, which Edge Middleware imports.
export async function dropSessionIfStale(session: Session, token: JWT): Promise<Session> {
  if (!token?.sub) return session;
  const current =
    token.role === "owner"
      ? await ownerSessionIsCurrent(token.sub, token.authAt)
      : token.role === "affiliate"
        ? await affiliateSessionIsCurrent(token.sub, token.authAt)
        : true;
  if (current) return session;
  // Neither id nor role, so every `session.user.id` guard in the app
  // fails closed rather than seeing a half-populated session.
  const { id: _id, role: _role, ...user } = session.user;
  // Cast because the app's own module augmentation declares `id` and
  // `role` as present on every session user. Dropping them is the point.
  return { ...session, user } as unknown as Session;
}
