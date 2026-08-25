import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyOwnerCredentials } from "@/lib/owner";
import { authConfig } from "@/lib/auth.config";

// Credentials + JWT sessions, no database adapter. The adapter is only
// needed for the Affiliate magic-link provider (persisted verification
// tokens) — a separate, later piece of work. Nothing here needs it: the
// JWT itself carries everything, and Owner credentials are checked
// directly against the Owner table in the authorize() callback below.
//
// The Credentials provider (and its argon2-dependent authorize() callback)
// lives only here, not in auth.config.ts, so Edge Middleware can use the
// shared config without bundling a native/wasm dependency. See
// src/lib/auth.config.ts and src/middleware.ts.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;
        const owner = await verifyOwnerCredentials(email, password);
        return owner; // { id, email } or null — Auth.js treats null as "authorization failed"
      },
    }),
  ],
});
