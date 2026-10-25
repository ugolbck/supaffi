import NextAuth, { type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { checkOwnerPassword, findOwnerForLogin } from "@/lib/owner";
import { reserveLoginRequest, reserveLoginAttempt, clearLoginAttempts } from "@/lib/loginThrottle";
import { clientAddress } from "@/lib/clientAddress";
import { checkAffiliatePassword, findAffiliateForLogin } from "@/lib/affiliatePassword";
import { getMerchantByDomain } from "@/lib/merchant";
import { authConfig } from "@/lib/auth.config";
import { ownerSessionIsCurrent } from "@/lib/ownerExists";
import { affiliateSessionIsCurrent } from "@/lib/affiliateSession";

// Two Credentials providers, JWT sessions, no database adapter: one for the
// Owner, one for Affiliates. Affiliate email is only unique per Merchant
// (@@unique([merchantId, email])), so the Affiliate provider finds the
// Merchant from the host the form was posted on before it looks the email up.
//
// Both Credentials providers (and their native/wasm or DB-heavy authorize()
// callbacks) live only here, not in auth.config.ts, so Edge Proxy can
// use the shared config without bundling them. See src/lib/auth.config.ts
// and src/proxy.ts.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Owner and Affiliate sessions are checked against the password-change
    // stamp on their row. Sessions are JWTs with no adapter, so there is no
    // session record to delete when the password changes; without this a
    // stolen cookie would keep working for its full 30 days. The lookups are
    // Prisma, so they live here rather than in auth.config.ts, which Edge
    // Middleware imports.
    async session(params) {
      const session = await authConfig.callbacks!.session!(params);
      const { token } = params;
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
      authorize: async (credentials, request) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;
        // signIn from the login server action rebuilds this request from the
        // incoming headers, so the forwarded address is here.
        const reported = clientAddress(request.headers);
        // Every request is counted per address first, whatever the email, and
        // one over the limit is refused before the lookup and without any
        // hash. It answers as fast for the Owner's email as for any other, so
        // it gives nothing away, and it keeps a script posting made-up emails
        // from holding the Argon2 slots (see loginThrottle.ts).
        if (!reserveLoginRequest(reported)) return null;
        const address = reported ?? "unknown";
        const owner = await findOwnerForLogin(email);
        // Only the real Owner's email is counted here, and the attempt is counted
        // before the hash rather than after a failure, so a burst of
        // concurrent guesses cannot all pass the check while their hashes run
        // (see loginThrottle.ts).
        //
        // An unknown email and a throttled attempt both still run a dummy
        // verify and return null rather than throwing, so the form keeps
        // saying "Incorrect email or password" in the same time either way.
        // A quick or distinct answer would confirm to a stranger that they
        // have the right email. The memory and queue those verifies cost are
        // capped in password.ts, not here.
        if (!owner || !reserveLoginAttempt(owner.email, address)) {
          await checkOwnerPassword(null, password);
          return null;
        }
        const verified = await checkOwnerPassword(owner, password);
        if (!verified) return null;
        clearLoginAttempts(owner.email, address);
        return { ...verified, role: "owner" as const };
      },
    }),
    Credentials({
      id: "affiliate-password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;
        const reported = clientAddress(request.headers);
        // Same order and same throttle as the Owner's provider above, with the
        // budget per product and email, so guesses on one affiliate never
        // lock out another or the Owner.
        if (!reserveLoginRequest(reported)) return null;
        const address = reported ?? "unknown";
        const host = request.headers.get("host");
        const merchant = host ? await getMerchantByDomain(host) : null;
        const affiliate = merchant ? await findAffiliateForLogin(merchant.id, email) : null;
        const budget = merchant && affiliate ? `${merchant.id}/${affiliate.email}` : null;
        if (!budget || !reserveLoginAttempt(budget, address)) {
          await checkAffiliatePassword(null, password);
          return null;
        }
        const verified = await checkAffiliatePassword(affiliate, password);
        if (!verified) return null;
        clearLoginAttempts(budget, address);
        return { ...verified, role: "affiliate" as const };
      },
    }),
  ],
});
