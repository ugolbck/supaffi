import Link from "next/link";
import { CalendarDays, Clock, Link2, Pencil, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";

/**
 * One program, owner-facing.
 *
 * The big number on the right is the one thing an owner scans a list of
 * programs for, so it gets the space. The three small figures under the name
 * are the terms that make two programs with the same rate different. There is
 * no tagline and no monogram: this card is for the person who set the terms,
 * not for the person deciding whether to join.
 */
export function ProgramCard({
  name,
  rate,
  duration,
  attributionDays,
  holdingDays,
  affiliateCount,
  signupLink,
  editHref,
}: {
  name: string;
  rate: string;
  /** "forever", "for 12 months", "on the first payment". */
  duration: string;
  attributionDays: number;
  holdingDays: number;
  affiliateCount: number;
  signupLink: string;
  editHref: string;
}) {
  return (
    <div className="flex flex-col divide-y divide-neutral-200 rounded-(--radius-md) border border-neutral-300 bg-white shadow-sm">
      <div className="flex items-stretch gap-6 p-5">
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-5">
          <p className="truncate text-[17px] font-semibold tracking-tight">{name}</p>
          <dl className="flex divide-x divide-neutral-200">
            <Term icon={<CalendarDays />} value={`${attributionDays} days`} label="Attribution" first />
            <Term icon={<Clock />} value={`${holdingDays} days`} label="Hold" />
          </dl>
        </div>
        <div className="flex w-40 shrink-0 flex-col justify-center rounded-(--radius) bg-accent-50 px-4 py-3">
          <span className="text-[11px] font-medium tracking-[0.04em] text-accent-700 uppercase">Earn</span>
          <span className="font-heading text-[34px] leading-none font-semibold tracking-tight text-accent-800 tabular-nums">
            {rate}%
          </span>
          <span className="mt-1 text-[13px] font-medium text-accent-700">{duration}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" />
          <span className="tabular-nums">{affiliateCount === 1 ? "1 affiliate" : `${affiliateCount} affiliates`}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <CopyLinkButton link={signupLink} size="sm" label="Copy signup link" />
          <Button variant="ghost" size="sm" render={<Link href={editHref} />}>
            <Pencil />
            Edit
          </Button>
        </div>
      </div>
    </div>
  );
}

function Term({
  icon,
  value,
  label,
  first = false,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  first?: boolean;
}) {
  return (
    <div className={first ? "flex items-center gap-2.5 pr-5" : "flex items-center gap-2.5 px-5"}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 [&_svg]:size-4">
        {icon}
      </span>
      <div className="flex flex-col leading-tight">
        <dd className="text-sm font-medium tabular-nums">{value}</dd>
        <dt className="text-xs text-muted-foreground">{label}</dt>
      </div>
    </div>
  );
}
