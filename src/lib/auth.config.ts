import type { NextAuthConfig } from "next-auth";

// The subset of the NextAuth config that is safe to run in the Edge
// Middleware runtime: no providers (the Credentials provider's authorize()
// pulls in @node-rs/argon2, a native/wasm binding Turbopack can't put in an
// Edge bundle) and no Prisma. Middleware only needs to decode/verify the JWT
// session cookie, which these shared options (secret, jwt strategy) cover.
// src/lib/auth.ts spreads this into the full config used everywhere else.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
};
