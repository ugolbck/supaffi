"use client";

import { useActionState, useState } from "react";
import { Check, Copy, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/stripeWebhookEvents";
import { restrictedKeyUrl } from "@/lib/stripeRestrictedKey";
import { connectStripeAction } from "./connectStripeAction";

type FormState = { error: string };

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

// Stripe's event picker is a search box, so the useful thing to hand over is
// the exact string. The icon stays rendered at rest rather than appearing on
// hover, which would shift every chip after it in the row.
function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={`Copy ${value}`}
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="group/chip inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-elevated px-2 py-1 font-mono text-[11px] text-foreground shadow-[var(--edge-light)] transition-[background-color,box-shadow] duration-150 ease-[var(--ease-out)] hover:bg-muted active:shadow-[var(--edge-pressed)]"
    >
      {value}
      {copied ? (
        <Check className="size-3 animate-in text-status-success zoom-in-50 duration-150 ease-[var(--ease-out)]" />
      ) : (
        <Copy className="size-3 text-muted-foreground/50 transition-colors duration-150 ease-[var(--ease-out)] group-hover/chip:text-muted-foreground" />
      )}
    </button>
  );
}

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
      {/* Rail into the next marker, overhanging by the gap so it stays
          continuous whatever height each step ends up being. */}
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

export function StripeConnectForm({
  merchantId,
  productName,
  webhookUrl,
  alreadyConnected,
}: {
  merchantId: string;
  productName: string;
  webhookUrl: string;
  alreadyConnected: boolean;
}) {
  const action = connectStripeAction.bind(null, merchantId, alreadyConnected);
  const [state, formAction] = useActionState<FormState, FormData>(action, { error: "" });

  const keepPlaceholder = "Leave blank to keep the current one";

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && (
        <p role="alert" className="text-sm text-status-danger">
          {state.error}
        </p>
      )}

      <ol className="flex flex-col">
        <Step
          n={1}
          index={0}
          title={
            <span className="flex flex-1 items-center gap-1.5">
              <Label htmlFor="secretKey">Create a restricted key and paste it</Label>
              <More>
                The link opens Stripe with the key already set up. It only lets Supaffi read the
                payments it needs to work out commissions, and never write anything: it cannot
                charge a card, refund anyone or move your money. Supaffi stores it encrypted.
              </More>
            </span>
          }
        >
          {/* Joined into one control rather than two boxes with a gap between
              them: separated, they read as two fields to fill in when only one
              of them is one. The seam is a single shared 1px edge. */}
          <div className="flex items-stretch">
            <Input
              id="secretKey"
              name="secretKey"
              type="password"
              className="rounded-r-none focus-visible:relative focus-visible:z-10"
              placeholder={alreadyConnected ? keepPlaceholder : "rk_live_... or rk_test_..."}
              required={!alreadyConnected}
            />
            <Button
              variant="outline"
              size="lg"
              className="-ml-px shrink-0 cursor-pointer rounded-l-none rounded-r-lg"
              // The trigger is a link, not a button: it leaves for Stripe. Base
              // UI warns unless it is told the render target is not a native
              // <button>.
              nativeButton={false}
              render={
                <a href={restrictedKeyUrl(productName)} target="_blank" rel="noreferrer noopener" />
              }
            >
              Create it in Stripe
              <ExternalLink data-icon="inline-end" />
            </Button>
          </div>
        </Step>

        <Step
          n={2}
          index={1}
          title={
            <>
              <Label>Add this endpoint in Stripe</Label>
              <More>
              Stripe tells Supaffi about a sale by calling this URL.
              </More>
            </>
          }
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Add it under Webhooks, and tick these four event types.
          </p>
          <div className="flex flex-col gap-2 rounded-(--radius-md) border border-border/70 bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-elevated px-2 py-1 font-mono text-xs shadow-[inset_0_1px_2px_hsl(var(--shadow-color)/0.06)]">
                {webhookUrl}
              </code>
              <CopyLinkButton link={webhookUrl} size="sm" label="Copy" />
            </div>
            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Event types to tick
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {REQUIRED_STRIPE_WEBHOOK_EVENTS.map((event) => (
                  <CopyChip key={event} value={event} />
                ))}
              </div>
            </div>
          </div>
        </Step>

        <Step
          n={3}
          index={2}
          title={<Label htmlFor="webhookSecret">Paste the signing secret Stripe gives you</Label>}
        >
          <Input
            id="webhookSecret"
            name="webhookSecret"
            type="password"
            placeholder={alreadyConnected ? keepPlaceholder : "whsec_..."}
            required={!alreadyConnected}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Shown once the endpoint exists. Proves a sale really came from Stripe.
          </p>
        </Step>
      </ol>

      <div className="flex items-center gap-4 border-t border-border/60 pt-5">
        <Button type="submit" size="lg">
          {alreadyConnected ? "Save changes" : "Connect Stripe"}
        </Button>
        {alreadyConnected && (
          <p className="text-xs text-muted-foreground">Blank keeps the stored key.</p>
        )}
      </div>
    </form>
  );
}
