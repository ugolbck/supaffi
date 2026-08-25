import type { DefaultSession, NextAuthConfig } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

// The subset of the NextAuth config that is safe to run in the Edge
// Middleware runtime: no providers (the Credentials provider's authorize()
// pulls in @node-rs/argon2, a native/wasm binding Turbopack can't put in an
// Edge bundle) and no Prisma. Middleware only needs to decode/verify the JWT
// session cookie, which these shared options (secret, jwt strategy) cover.
// src/lib/auth.ts spreads this into the full config used everywhere else.
export const authConfig: NextAuthConfig = {
  // 30 days, matching the Affiliate session lifetime decision in CONTEXT.md
  // ("Session persists long (30-60 days)") — stated explicitly rather than
  // left to Auth.js's inherited default.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
