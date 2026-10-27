"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { originFor } from "@/lib/url";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import type { CommissionStatus } from "@/lib/commission";
import { XIcon } from "lucide-react";
import {
  addPromoCodeAction,
  changeProgramAction,
  createPasswordLinkAction,
  removePromoCodeAction,
  setCustomRateAction,
} from "./affiliateActions";

/**
 * Everything about one affiliate, in one place, without leaving the list.
 *
 * The list selects with `?affiliate=<id>` and the panel is rendered on the
 * server from that, so there is no client copy of an affiliate to keep in step
 * with a write. Closing is a navigation back to the list, which is why the URL
 * it returns to arrives as a prop: the filters and the page were already in it.
 */

export type SheetAffiliate = {
  id: string;
  name: string | null;
  email: string;
  joinedAt: string;
  programId: string;
  programName: string;
  /** Without the percent sign. */
  rate: string;
  rateIsOverride: boolean;
  payoutDetails: string | null;
  hasPassword: boolean;
  links: { url: string; clicks: number }[];
  /** `earned` already formatted, like the commission amounts below. */
  promoCodes: { id: string; code: string; sales: number; earned: string }[];
  commissions: { id: string; date: string; amount: string; status: CommissionStatus }[];
};

export function AffiliateSheet({
  affiliate,
  productDomain,
  programs,
  product,
  listHref,
}: {
  affiliate: SheetAffiliate;
  /** The product's affiliate domain, where a password link has to be opened. */
  productDomain: string;
  programs: { id: string; name: string }[];
  product: { id: string; slug: string };
  listHref: string;
}) {
  const router = useRouter();
  // The trigger shows a program name rather than the cuid the form submits.
  const programNames = Object.fromEntries(programs.map((p) => [p.id, p.name]));

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(listHref);
      }}
    >
      <SheetContent className="w-[420px] overflow-y-auto data-[side=right]:sm:max-w-[420px]">
        <SheetHeader className="pr-12">
          <SheetTitle className="truncate">{affiliate.name ?? affiliate.email}</SheetTitle>
          <SheetDescription className="truncate">
            {affiliate.email} · joined {affiliate.joinedAt}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-4">
          <Field title="Program">
            <form action={changeProgramAction.bind(null, product, affiliate.id)} className="flex gap-2">
              <Select name="programId" items={programNames} defaultValue={affiliate.programId}>
                <SelectTrigger className="min-w-0 flex-1 cursor-pointer data-[size=default]:h-9" aria-label="Program">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {programs.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="cursor-pointer">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" size="lg" variant="secondary" className="cursor-pointer">
                Change
              </Button>
            </form>
          </Field>

          <Field
            title="Rate"
            value={
              <span className="tabular-nums">
                {affiliate.rate}%{" "}
                <span className="text-muted-foreground">{affiliate.rateIsOverride ? "custom" : "program default"}</span>
              </span>
            }
          >
            <form action={setCustomRateAction.bind(null, product, affiliate.id)} className="flex gap-2">
              <Input
                name="rate"
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                placeholder="Custom rate"
                aria-label="Custom rate"
                className="min-w-0 flex-1"
              />
              <Button type="submit" size="lg" variant="secondary" className="cursor-pointer">
                Set
              </Button>
              {affiliate.rateIsOverride && (
                // Its own field, not an empty `rate`: a submit button sharing
                // the input's name loses to whatever was typed in it, so
                // clearing the override says so instead.
                <Button
                  type="submit"
                  size="lg"
                  variant="ghost"
                  className="cursor-pointer"
                  name="intent"
                  value="default"
                >
                  Use default
                </Button>
              )}
            </form>
          </Field>

          <Field
            title="Payout"
            value={
              <span className="max-w-60 text-right break-words">
                {affiliate.payoutDetails ?? <span className="text-muted-foreground">Not given yet</span>}
              </span>
            }
          />

          <PasswordLink affiliateId={affiliate.id} hasPassword={affiliate.hasPassword} product={product} domain={productDomain} />

          <Field title="Links">
            <ul className="flex flex-col gap-1.5 text-sm">
              {affiliate.links.map((l) => (
                <li key={l.url} className="flex items-baseline justify-between gap-3">
                  <code className="truncate font-mono text-xs">{l.url}</code>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{l.clicks} clicks</span>
                </li>
              ))}
            </ul>
          </Field>

          <PromoCodes affiliateId={affiliate.id} codes={affiliate.promoCodes} product={product} />

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Commissions</p>
            <ul className="flex flex-col gap-1 text-sm">
              {affiliate.commissions.length === 0 && (
                <li className="text-muted-foreground">None yet</li>
              )}
              {affiliate.commissions.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <span className="w-16 text-muted-foreground tabular-nums">{c.date}</span>
                  <span className="flex-1 text-right tabular-nums">{c.amount}</span>
                  <span className="flex w-20 justify-end">
                    <StatusBadge status={c.status} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One part of the panel: a heading, what it holds now, and its controls. */
function Field({ title, value, children }: { title: string; value?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{title}</p>
        {value}
      </div>
      {children}
    </div>
  );
}

/**
 * Supaffi sends no email, so a forgotten password, or an affiliate who signed
 * up before passwords existed, is handled by the Owner: make a one-time link
 * here and send it to them. Making a new one voids the last.
 */
function PasswordLink({
  affiliateId,
  hasPassword,
  product,
  domain,
}: {
  affiliateId: string;
  hasPassword: boolean;
  product: { id: string };
  domain: string;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Field
      title="Password"
      value={hasPassword ? <span>Set</span> : <span className="text-status-warning">Not set yet</span>}
    >
      {link ? (
        <div className="flex gap-2">
          <Input readOnly value={link} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
          <CopyLinkButton link={link} size="lg" label="Copy" />
        </div>
      ) : (
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="cursor-pointer self-start"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await createPasswordLinkAction(product, affiliateId);
              if ("error" in result) setError(result.error);
              else setLink(`${originFor(domain)}/affiliates/password?token=${result.token}`);
            })
          }
        >
          Create password link
        </Button>
      )}
      {link && <p className="text-xs text-muted-foreground">Works once, for 3 days. Send it to them yourself.</p>}
      {error && <p className="text-xs text-status-danger">{error}</p>}
    </Field>
  );
}

/**
 * Stripe promotion codes that credit this affiliate when a customer uses one,
 * clicked link or not. Typed as the customer types it; Supaffi finds the code
 * in Stripe once, here.
 */
function PromoCodes({
  affiliateId,
  codes,
  product,
}: {
  affiliateId: string;
  codes: SheetAffiliate["promoCodes"];
  product: { id: string; slug: string };
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<{ error: string; keyLacksPermission?: true } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Field title="Promo codes">
      {codes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {codes.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{c.code}</code>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {c.sales} {c.sales === 1 ? "sale" : "sales"} · {c.earned}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="shrink-0 cursor-pointer"
                aria-label={`Remove ${c.code}`}
                disabled={pending}
                onClick={() => startTransition(() => removePromoCodeAction(product, affiliateId, c.id))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await addPromoCodeAction(product, affiliateId, code);
            setError(result);
            if (!result) setCode("");
          });
        }}
      >
        <Input
          name="code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="Stripe promo code"
          aria-label="Stripe promo code"
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 font-mono"
        />
        <Button type="submit" size="lg" variant="secondary" className="cursor-pointer" disabled={pending || code.trim() === ""}>
          Add
        </Button>
      </form>
      {error && (
        <p className="text-xs text-status-danger">
          {error.error}
          {error.keyLacksPermission && (
            <>
              {" "}
              <Link
                href={`/dashboard/products/${product.slug}/settings?replace=stripe-key`}
                className="cursor-pointer underline"
              >
                Replace it
              </Link>
            </>
          )}
        </p>
      )}
    </Field>
  );
}
