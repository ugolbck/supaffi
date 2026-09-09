import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/dashboard/signOutAction";

// Full screen. No sidebar, no breadcrumbs, no dashboard nav: during
// onboarding there is nowhere else to be, and every exit is a way to lose
// the thread. The only controls are the logo and sign out.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  return (
    <div className="min-h-svh bg-background">
      <header className="flex h-14 items-center justify-between px-6">
        <Link href="/onboarding" className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-md bg-accent-700 text-xs text-accent-100">S</span>
          Supaffi
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{session.user.email ?? ""}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm" className="cursor-pointer">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl gap-12 px-6 pb-24 pt-8">{children}</div>
    </div>
  );
}
