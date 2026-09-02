import Link from "next/link";
import { Check, Clock, Percent, Plug, Code, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { originFor } from "@/lib/url";
import type { ProductSetup as Setup } from "@/lib/productSetup";

function Term({ word, children }: { word: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="cursor-help underline decoration-dashed decoration-from-font underline-offset-4" />
        }
      >
        {word}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Setup for one product, on that product's own page.
 *
 * It sits above the product's numbers rather than replacing them: an Owner
 * three steps in still has affiliates and clicks worth looking at, and hiding
 * those behind a checklist would make the product feel dead while it is
 * actually working.
 *
 * Steps below the current one are dimmed but never disabled. The order is a
 * recommendation, not a lock, and an Owner who wants to add affiliates before
 * writing their commission terms is not doing anything wrong.
 */
export function ProductSetup({
  merchantId,
  merchantName,
  merchantDomain,
  setup,
  className = "",
}: {
  merchantId: string;
  merchantName: string;
  merchantDomain: string;
  setup: Setup;
  className?: string;
}) {
  const base = `/dashboard/products/${merchantId}`;

  const steps = [
    {
      icon: Plug,
      title: "Connect your tools",
      body: setup.emailRequired
        ? "Your payment provider, and the email that sends affiliates their login links."
        : "Your payment provider. Login links are printed to the terminal on this instance.",
      state: setup.integrationsConnected ? "done" : "todo",
      action: (
        <Link href={`${base}/integrations`}>
          <Button size="sm">Connect</Button>
        </Link>
      ),
    },
    {
      icon: Percent,
      title: "Set your commission terms",
      body: (
        <>
          How much affiliates earn per sale, for how long, and the{" "}
          <Term word="holding period">
            How long a commission stays pending before you can pay it out. Long enough for a
            refund or chargeback to land first.
          </Term>
          .
        </>
      ),
      state: setup.firstProgramId ? "done" : "todo",
      action: (
        <Link href={`${base}/programs/new`}>
          <Button size="sm">Set terms</Button>
        </Link>
      ),
    },
    {
      icon: Code,
      title: "Install tracking",
      body:
        setup.trackingStatus === "awaiting-sale"
          ? "Clicks are arriving. This finishes on its own with the first sale from an affiliate."
          : "Two snippets on your own site: one records the click, one tells Stripe which affiliate sent the sale.",
      // The middle state is the reason this component takes three and not two:
      // the Owner has done their part and is waiting on a customer, which is
      // neither finished nor outstanding.
      state:
        setup.trackingStatus === "verified"
          ? "done"
          : setup.trackingStatus === "awaiting-sale"
            ? "waiting"
            : "todo",
      action: (
        <Link href={`${base}/tracking`}>
          <Button size="sm" variant={setup.trackingStatus === "not-started" ? "default" : "outline"}>
            {setup.trackingStatus === "not-started" ? "Install tracking" : "View snippets"}
          </Button>
        </Link>
      ),
    },
    {
      icon: Share2,
      title: "Recruit your first affiliate",
      body: `Send this to anyone you want promoting ${merchantName}.`,
      state: setup.affiliateCount > 0 ? "done" : "todo",
      action: setup.firstProgramId ? (
        <CopyLinkButton
          size="sm"
          link={`${originFor(merchantDomain)}/affiliates/signup/${setup.firstProgramId}`}
        />
      ) : null,
    },
  ] as const;

  const firstUnfinished = steps.findIndex((s) => s.state !== "done");

  return (
    <section
      className={`flex flex-col gap-3 lg:min-h-0 rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] p-4 shadow-[var(--edge-light),var(--shadow-sm)] ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-semibold tracking-tight">Finish setting up</h2>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {setup.doneCount} of {setup.totalSteps}
        </span>
      </div>

      <div className="h-1 shrink-0 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-[var(--ease-out)]"
          style={{ width: `${(setup.doneCount / setup.totalSteps) * 100}%` }}
        />
      </div>

      <ul className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {steps.map((step, i) => {
          const isDone = step.state === "done";
          const isWaiting = step.state === "waiting";
          const isCurrent = i === firstUnfinished;

          return (
            <li
              key={step.title}
              className={`flex animate-in shrink-0 items-start gap-3 fill-mode-both fade-in slide-in-from-bottom-1 border-t border-border/50 py-2.5 duration-300 ease-[var(--ease-out)] first:border-t-0 ${
                isDone || isCurrent || isWaiting ? "" : "opacity-55"
              }`}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <span
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full shadow-[var(--edge-light)] ${
                  isDone
                    ? "bg-status-success text-white"
                    : isWaiting
                      ? "bg-accent-100 text-accent-800"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : isWaiting ? (
                  <Clock className="size-3.5" />
                ) : (
                  <step.icon className="size-3.5" />
                )}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={`text-sm font-medium ${isDone ? "text-muted-foreground" : ""}`}
                >
                  {step.title}
                </span>
                {!isDone && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{step.body}</p>
                )}
              </div>

              {!isDone && <div className="shrink-0">{step.action}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
