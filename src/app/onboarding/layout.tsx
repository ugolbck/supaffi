import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/dashboard/signOutAction";

// Full screen. No sidebar, no breadcrumbs, no dashboard nav: during
// onboarding there is nowhere else to be, and every exit is a way to lose
// the thread. The logo is a mark, not a link, so the only way out is sign
// out or the rail's link back to a product that is already running.
//
// The header and the content share one column, sized to exactly what the
// content is: the rail, the gap, and a 640px step. The mark carries the
// rail's own row padding so it sits over the step markers rather than over
// the column edge, and "Log out" ends where the step's surface ends. The header is bare, no rule under it: the mark carries
// its own weight and the rest is set in the rail's muted register.
const COLUMN = "mx-auto w-full max-w-[calc(256px+48px+640px+2*24px)] px-6";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  return (
    <div className="min-h-svh bg-background">
      <header className={`${COLUMN} flex h-14 items-center justify-between`}>
        <span className="flex items-center gap-2.5 pl-3">
          <Image
            src="/logo.svg"
            alt=""
            width={22}
            height={22}
            priority
            className="size-[22px] rounded-[6px] shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.10)]"
          />
          <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">Supaffi</span>
        </span>
        <div className="flex items-center gap-2.5 text-xs">
          <span className="hidden max-w-[28ch] truncate text-muted-foreground sm:block">{session.user.email ?? ""}</span>
          <span className="hidden h-3.5 w-px bg-neutral-300 sm:block" aria-hidden />
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="xs" className="-mr-2 px-2 font-medium text-neutral-600 hover:text-foreground">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <div className={`${COLUMN} flex gap-12 pt-8 pb-24`}>{children}</div>
    </div>
  );
}
