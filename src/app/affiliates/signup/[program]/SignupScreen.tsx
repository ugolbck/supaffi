import { Link2, UserRound, Wallet } from "lucide-react";
import { TaskCard } from "@/components/onboarding/TaskCard";
import { SignupForm, type SignupFormAction } from "./SignupForm";

/**
 * The whole public signup screen, minus the data.
 *
 * Split out of `page.tsx` so it can be rendered with fixture values in the dev
 * kit: the page itself resolves the Merchant from the request Host and reads
 * the database, neither of which a preview can do.
 */

export type SignupTerms = {
  /** Percentage, e.g. 20 for 20%. */
  rate: number;
  attributionWindowDays: number;
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

const STEPS = [
  {
    icon: UserRound,
    title: "Sign up",
    line: "Your name and email. You confirm from your inbox.",
  },
  {
    icon: Link2,
    title: "Share your link",
    line: "Yours the moment you confirm, and it works anywhere you post it.",
  },
  {
    icon: Wallet,
    title: "Earn on what you bring",
    line: "Every sale that arrives through your link is credited to you.",
  },
];

function Step({
  icon: Icon,
  title,
  line,
}: {
  icon: typeof Link2;
  title: string;
  line: string;
}) {
  return (
    <TaskCard className="flex items-start gap-3 p-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700">
        <Icon className="size-4" strokeWidth={2} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[13px] leading-5 font-semibold text-neutral-900">{title}</p>
        <p className="text-[13px] leading-5 text-muted-foreground text-pretty">{line}</p>
      </div>
    </TaskCard>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3.5">
      <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{label}</p>
      <p className="text-[19px] leading-7 font-semibold tracking-[-0.02em] text-neutral-900 tabular-nums">
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
    <div className="mx-auto flex w-full max-w-[540px] flex-col">
      <h1 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance sm:text-[34px]">
        Earn from every sale you send to {merchantName}
      </h1>

      <div className="mt-7 flex flex-col gap-2.5">
        {STEPS.map((step) => (
          <Step key={step.title} {...step} />
        ))}
      </div>

      <TaskCard className="mt-4 grid grid-cols-1 divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Tile label="You earn" value={formatRate(terms.rate)} hint="of every sale" />
        <Tile
          label="Click window"
          value={plural(terms.attributionWindowDays, "day")}
          hint="from the click to the sale"
        />
        <Tile label="On subscriptions" value={recurring.value} hint={recurring.hint} />
      </TaskCard>

      <div className="mt-8">
        <SignupForm action={action} linkHost={linkHost} />
      </div>
    </div>
  );
}
