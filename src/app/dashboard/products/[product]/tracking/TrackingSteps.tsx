"use client";

import { Info } from "lucide-react";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REFERRAL_COOKIE, REFERRAL_METADATA_KEY } from "@/lib/referral";

function More({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label="More information"
            className="inline-flex cursor-help text-muted-foreground/70 transition-colors duration-150 ease-[var(--ease-out)] hover:text-foreground"
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

// Same rail and numbered markers as the Stripe connect screen, which is the
// closest sibling: a short ordered list of things to copy into somewhere else.
function Step({
  n,
  title,
  children,
  index,
}: {
  n: number;
  title: React.ReactNode;
  children: React.ReactNode;
  index: number;
}) {
  return (
    <li
      className="relative flex animate-in items-start gap-4 fill-mode-both fade-in slide-in-from-bottom-2 pb-6 duration-300 ease-[var(--ease-out)] last:pb-0"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <span
        aria-hidden
        className="absolute top-7 bottom-0 left-[13px] w-px -translate-x-1/2 bg-border last:hidden"
      />
      <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-800 tabular-nums shadow-[var(--edge-light)]">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <div className="flex items-center gap-1.5">{title}</div>
        {children}
      </div>
    </li>
  );
}

function Snippet({ code, label }: { code: string; label: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-(--radius-md) border border-border/70 bg-muted/50 p-3">
      <pre className="min-w-0 overflow-x-auto rounded-md bg-elevated px-2.5 py-2 font-mono text-xs leading-relaxed shadow-[inset_0_1px_2px_hsl(var(--shadow-color)/0.06)]">
        <code>{code}</code>
      </pre>
      <div className="flex justify-end">
        <CopyLinkButton link={code} size="sm" label={label} />
      </div>
    </div>
  );
}

export function TrackingSteps({ scriptTag }: { scriptTag: string }) {
  const checkoutSnippet = `// Wherever you create the Checkout Session, server side.
const referralToken = cookies.get("${REFERRAL_COOKIE}");

await stripe.checkout.sessions.create({
  // ...your existing options
  metadata: {
    // ...your existing metadata
    ...(referralToken && { ${REFERRAL_METADATA_KEY}: referralToken }),
  },
});`;

  return (
    <ol className="flex flex-col">
      <Step
        n={1}
        index={0}
        title={
          <>
            <span className="text-sm font-medium">Add this to your site</span>
            <More>
              Goes in the head of every page an affiliate link can land on. It reads the ref
              parameter and stores it as a cookie on your own domain.
            </More>
          </>
        }
      >
        <Snippet code={scriptTag} label="Copy" />
      </Step>

      <Step
        n={2}
        index={1}
        title={
          <>
            <span className="text-sm font-medium">Pass the token at checkout</span>
            <More>
              The cookie is first party on your domain, so it reaches your server on a normal
              request. No cookie means the buyer came from nowhere in particular: leave the field
              out and the sale earns nothing.
            </More>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          Without this, sales arrive with no way to tell which affiliate sent them.
        </p>
        <Snippet code={checkoutSnippet} label="Copy" />
      </Step>
    </ol>
  );
}
