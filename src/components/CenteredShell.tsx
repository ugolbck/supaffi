import type { ReactNode } from "react";

/**
 * The frame every standalone card page sits in: setup, both logins, the
 * password link, not found and invite only. One frame so the card lands in
 * the same place whichever of them you open.
 */
export function CenteredShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden px-4 py-16">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: "radial-gradient(60% 50% at 50% 0%, var(--accent-100) 0%, transparent 70%)",
        }}
      />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
