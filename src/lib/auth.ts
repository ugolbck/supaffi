import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyOwnerCredentials } from "@/lib/owner";

// Credentials + JWT sessions, no database adapter. The adapter is only
// needed for the Affiliate magic-link provider (persisted verification
// tokens) — a separate, later piece of work. Nothing here needs it: the
// JWT itself carries everything, and Owner credentials are checked
// directly against the Owner table in the authorize() callback below.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
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
