import NextAuth, { type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyOwnerCredentials } from "@/lib/owner";
import {
  checkLoginAllowed,
  recordFailedLogin,
  clearLoginFailures,
} from "@/lib/loginThrottle";
import { consumeAffiliateLoginToken } from "@/lib/affiliateAuth";
import { authConfig } from "@/lib/auth.config";
import { ownerSessionIsCurrent } from "@/lib/ownerExists";

// Two Credentials providers, JWT sessions, no database adapter. Auth.js's
// built-in Email provider needs an adapter whose contract assumes email is
// globally unique per user — Affiliate email is only unique per Merchant
// (@@unique([merchantId, email])), a real mismatch, not a config detail.
// Instead, the Affiliate magic-link flow is hand-rolled
// (AffiliateLoginToken, src/lib/affiliateAuth.ts) and redeemed through the
// second Credentials provider below — the same pattern Owner login already
// uses, just with a token instead of a password.
//
// Both Credentials providers (and their native/wasm or DB-heavy authorize()
// callbacks) live only here, not in auth.config.ts, so Edge Proxy can
// use the shared config without bundling them. See src/lib/auth.config.ts
// and src/proxy.ts.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Owner sessions are checked against the password-change stamp on the
    // Owner row. Sessions are JWTs with no adapter, so there is no session
    // record to delete when the password changes; without this a stolen
    // cookie would keep working for its full 30 days. The lookup is Prisma,
    // so it lives here rather than in auth.config.ts, which Edge Middleware
    // imports. The affiliate path is untouched.
    async session(params) {
      const session = await authConfig.callbacks!.session!(params);
      const { token } = params;
      if (token?.role !== "owner" || !token.sub) return session;
      if (await ownerSessionIsCurrent(token.sub, token.authAt)) return session;
      // Neither id nor role, so every `session.user.id` guard in the app
      // fails closed rather than seeing a half-populated session.
      const { id: _id, role: _role, ...user } = (session as Session).user;
      // Cast because the app's own module augmentation declares `id` and
      // `role` as present on every session user. Dropping them is the point.
      return { ...session, user } as unknown as Session;
    },
  },
  providers: [
    Credentials({
      id: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;
        // Checked before verifyOwnerCredentials, which is where the 64 MiB of
        // Argon2id gets spent. Throttling after the hash would still burn the
        // memory this is here to protect.
        //
        // Returns null rather than throwing, so the form keeps saying
        // "Incorrect email or password". A distinct "too many attempts" would
        // confirm to a stranger that they have the right email, and the Owner
        // who trips it is looking at their own server logs anyway.
        if (!checkLoginAllowed(email)) return null;
        const owner = await verifyOwnerCredentials(email, password);
        if (!owner) {
          recordFailedLogin(email);
          return null;
        }
        clearLoginFailures(email);
        return { ...owner, role: "owner" as const };
      },
    }),
    Credentials({
      id: "affiliate-token",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      authorize: async (credentials) => {
        const token = credentials?.token;
        if (typeof token !== "string") return null;
        const affiliate = await consumeAffiliateLoginToken(token);
        if (!affiliate) return null;
        return { ...affiliate, role: "affiliate" as const };
      },
    }),
  ],
});
