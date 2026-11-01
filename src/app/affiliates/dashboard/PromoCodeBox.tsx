"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { promoCodeInput } from "@/lib/promoCodeInput";
import type { PromoCodeOffer } from "@/lib/promoCode";
import { claimPromoCodeAction } from "./claimPromoCode";

/**
 * The Affiliate's promo code, beside their link and in the same box.
 *
 * Before there is one, the box is the claim: the name is already filled in,
 * editable in place, and one button makes it. After, the same box holds the
 * code and a copy button, so claiming is the field settling into its result
 * rather than a form being swapped for a card. The change animates only when
 * it happens here, never on a page load.
 */
export function PromoCodeBox({ offer }: { offer: NonNullable<PromoCodeOffer> }) {
  // Set by a claim made here. The box stays mounted while the action
  // revalidates the page, so the code that page brings arrives animated.
  const [claimedHere, setClaimedHere] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[13px] font-medium text-neutral-700">Your code</span>
        {offer.discountLabel && (
          <span className="truncate text-[13px] text-muted-foreground tabular-nums">{offer.discountLabel}</span>
        )}
      </div>
      {offer.kind === "code" ? (
        <Claimed code={offer.code} animate={claimedHere} />
      ) : (
        <Claim suggested={offer.suggested} onClaimed={() => setClaimedHere(true)} />
      )}
    </div>
  );
}

const BOX = "flex h-12 items-center gap-2 rounded-(--radius) border bg-white pr-2 pl-4";
const CODE_TEXT = "min-w-0 flex-1 truncate font-mono text-sm font-medium tracking-[0.08em]";

function Claim({ suggested, onClaimed }: { suggested: string; onClaimed: () => void }) {
  const [code, setCode] = useState(suggested);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <form
        className={cn(
          BOX,
          "border-neutral-300 transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          error && "border-status-danger"
        )}
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await claimPromoCodeAction(code);
            if (result) setError(result.error);
            else onClaimed();
          });
        }}
      >
        <input
          value={code}
          onChange={(e) => {
            setCode(promoCodeInput(e.target.value));
            setError("");
          }}
          aria-label="Your promo code"
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          autoComplete="off"
          className={cn(CODE_TEXT, "bg-transparent outline-none")}
        />
        <Button type="submit" size="sm" className="shrink-0 cursor-pointer" disabled={pending || code.length < 3}>
          Create code
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-[13px] text-status-danger">
          {error}
        </p>
      )}
    </>
  );
}

function Claimed({ code, animate }: { code: string; animate: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className={cn(BOX, "border-neutral-300", animate && "animate-in duration-300 fade-in-0 zoom-in-[0.98]")}>
      <span className={CODE_TEXT}>{code}</span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0 cursor-pointer"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        }}
      >
        {/* Both icons stay mounted and cross-fade, so the swap has an exit as
            well as an enter. */}
        <span className="relative size-4">
          <Copy
            className={cn(
              "absolute inset-0 transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
              copied ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0"
            )}
          />
          <Check
            className={cn(
              "absolute inset-0 text-status-success transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
              copied ? "scale-100 opacity-100 blur-0" : "scale-25 opacity-0 blur-[4px]"
            )}
          />
        </span>
        Copy
      </Button>
    </div>
  );
}
