// A constant on its own, importing nothing.
//
// The setup screen validates the password before anything is written, and its
// validator is reached from a client component. Importing the minimum from
// `@/lib/owner` would pull Prisma and the native Argon2 binding along with it,
// so the number lives here and `@/lib/owner` re-exports it for every caller
// that already has both.
export const MIN_PASSWORD_LENGTH = 12;
