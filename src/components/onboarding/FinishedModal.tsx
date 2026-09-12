import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confetti } from "./Confetti";
import { CopyField } from "./CodeBlock";

/**
 * The end of onboarding, over the last step rather than on a page of its own.
 *
 * A separate route meant a navigation, which put the reward behind a page load
 * and dropped the whole thing into the onboarding chrome — logo, account menu,
 * log out — around a screen that is meant to be one moment. Here the step the
 * user just finished stays behind the glass, so the win lands on the click.
 *
 * There is no way to dismiss it on purpose: the two things worth doing are
 * both on it, and closing it would leave someone staring at a step they have
 * already completed.
 */
export function FinishedModal({ link, dashboardHref }: { link: string; dashboardHref: string }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="finished-title" className="fixed inset-0 z-40">
      <div className="supaffi-fade-in absolute inset-0 bg-white/70 backdrop-blur-md" />
      <Confetti />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="supaffi-modal-in relative z-50 flex w-full max-w-[520px] flex-col items-center gap-6 rounded-(--radius-lg) border border-neutral-300 bg-white p-8 text-center shadow-xl">
          <span className="supaffi-pop flex size-12 items-center justify-center rounded-full bg-status-success">
            <Check className="size-6 text-white" strokeWidth={3} />
          </span>
          <div className="flex flex-col gap-2">
            <h2 id="finished-title" className="text-[24px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance">
              Your affiliate program is live
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              Share this link with your audience. They sign up, get their own link, and you earn from every sale they
              bring.
            </p>
          </div>
          <CopyField value={link} className="w-full" />
          <Button size="lg" variant="success" render={<Link href={dashboardHref} />}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
