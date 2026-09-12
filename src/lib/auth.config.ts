import type { DefaultSession, NextAuthConfig } from "next-auth";
import type {} from "next-auth/jwt";

export type SessionRole = "owner" | "affiliate";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: SessionRole;
    } & DefaultSession["user"];
  }
  interface User {
    role: SessionRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: SessionRole;
    /**
     * Seconds since the epoch at which this session was signed in. Not `iat`:
     * Auth.js re-signs the cookie on every session read and stamps a fresh
     * `iat` each time, so `iat` says when the cookie was last refreshed, not
     * when the session began. A custom claim survives those refreshes, which
     * is what lets a password change end sessions older than itself
     * (ownerSessionIsCurrent in src/lib/ownerExists.ts).
     */
    authAt?: number;
  }
}

// The subset of the NextAuth config that is safe to run in the Edge
// Middleware runtime: no providers (both Credentials providers' authorize()
// callbacks pull in either @node-rs/argon2 or Prisma-heavy lookups, neither
// of which belongs in an Edge bundle) and no Prisma. Middleware only needs
// to decode/verify the JWT session cookie, which these shared options
// (secret, jwt strategy, callbacks) cover.
// src/lib/auth.ts spreads this into the full config used everywhere else.
export const authConfig: NextAuthConfig = {
  // 30 days, matching the Affiliate session lifetime decision in CONTEXT.md
  // ("Session persists long (30-60 days)") — stated explicitly rather than
  // left to Auth.js's inherited default. Owner reuses the same value; there
  // is one shared session cookie, not two (see auth.ts).
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user && "role" in user) {
        token.role = user.role as SessionRole;
      }
      // Only on sign-in, when `user` is present. Plain arithmetic, so it stays
      // safe for the Edge proxy that shares this config.
      if (user) {
        token.authAt = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      if (token.role) {
        session.user.role = token.role;
      }
      return session;
    },
  },
};
