import { Prisma } from "@prisma/client";

export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// P2002 alone doesn't say WHICH unique constraint was violated — a model can
// have several. Prisma puts the violated field name(s) in `err.meta.target`
// as a string array (for a compound unique, all fields in the compound
// appear). Use this when the caller needs to react differently depending on
// which constraint tripped.
export function isUniqueConstraintErrorOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}
