import { SignupForm, type SignupFormAction } from "./SignupForm";

/**
 * The whole public signup screen, minus the data.
 *
 * Split out of `page.tsx` so it can be rendered with fixture values in the dev
 * kit: the page itself resolves the Merchant from the request Host and reads
 * the database, neither of which a preview can do.
 *
 * Two columns on a laptop, the offer beside the form, so the whole thing sits
 * in one viewport. The offer is the two numbers someone decides on: the rate,
 * and whether it keeps paying. How long a click stays credited is a rule of
 * ours, not a reason to sign up, and no affiliate program puts it in front of
 * someone who has not joined yet.
 */

export type SignupTerms = {
  /** Percentage, e.g. 20 for 20%. */
  rate: number;
  durationType: "ONE_TIME" | "FIXED_MONTHS" | "FOREVER";
  durationMonths: number | null;
};

/** 20.00 reads as "20%", 12.50 as "12.5%". Nobody writes a rate with trailing zeros. */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}%`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** How long commissions keep coming on a subscription, in plain words. */
export function recurringTerm(terms: SignupTerms): { value: string; hint: string } {
  if (terms.durationType === "FOREVER") {
    return { value: "Every payment", hint: "for as long as they stay" };
  }
  if (terms.durationType === "FIXED_MONTHS") {
    // `durationMonths` is only ever null when durationType isn't
    // FIXED_MONTHS (see prisma/schema.prisma), so this is defensive, not
    // expected. Either way, a FIXED_MONTHS program must never fall through
    // to the one-time wording below, which reads as a weaker plan than it is.
    if (terms.durationMonths) {
      return { value: plural(terms.durationMonths, "month"), hint: "of everything they pay" };
    }
    return { value: "For a set period", hint: "of everything they pay" };
  }
  return { value: "First payment", hint: "one commission per customer" };
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{label}</p>
      <p className="text-[22px] leading-7 font-semibold tracking-[-0.02em] whitespace-nowrap text-neutral-900 tabular-nums">
        {value}
      </p>
      <p className="text-xs leading-4 text-muted-foreground text-pretty">{hint}</p>
    </div>
  );
}

export function SignupScreen({
  merchantName,
  terms,
  linkHost,
  action,
}: {
  merchantName: string;
  terms: SignupTerms;
  /** Host the affiliate's link points at, e.g. "mokkit.co". No scheme, no trailing slash. */
  linkHost: string;
  action: SignupFormAction;
}) {
  const recurring = recurringTerm(terms);

  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center lg:gap-16">
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
            {merchantName} affiliate program
          </p>
          <h1 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[38px]">
            Earn from every sale you send to {merchantName}
          </h1>
        </div>

        <div className="grid grid-cols-1 divide-y divide-neutral-200 overflow-hidden rounded-(--radius-md) border border-neutral-300 bg-white shadow-sm sm:max-w-[440px] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <Tile label="You earn" value={formatRate(terms.rate)} hint="of every sale" />
          <Tile label="On subscriptions" value={recurring.value} hint={recurring.hint} />
        </div>
      </div>

      <SignupForm action={action} linkHost={linkHost} />
    </div>
  );
}
