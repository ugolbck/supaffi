import Link from "next/link";
import { Bell, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AttentionItem = {
  icon: LucideIcon;
  /** The fact, with its number in it: "878 commissions are payable". */
  title: string;
  /** What doing something about it means. */
  detail: string;
  href: string;
  /** Turns the row's icon and title red: something is wrong, not merely waiting. */
  urgent?: boolean;
};

/**
 * What is waiting on the owner, as things to open rather than lines to read.
 *
 * Each item is a whole tile with the fact in bold, what it means underneath,
 * and a chevron saying it goes somewhere. The icon is a shape in a quiet
 * square, not a coloured badge: the number is the thing that should pop, and
 * two coloured badges beside two numbers would split the eye three ways.
 * Only a genuine problem, a flagged commission, is allowed a colour.
 */
export function Attention({ items, className }: { items: AttentionItem[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <section
      className={cn(
        "shrink-0 rounded-(--radius-md) border border-(--card-hairline) bg-elevated shadow-(--shadow-raised)",
        className
      )}
    >
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <span className="flex size-7 items-center justify-center rounded-[6px] border border-(--card-hairline) bg-neutral-50 text-neutral-600">
          <Bell className="size-3.5" />
        </span>
        <h2 className="text-sm font-medium">Needs your attention</h2>
      </div>
      <ul className={cn("grid gap-px bg-neutral-200/70", items.length > 1 ? "xl:grid-cols-2" : "")}>
        {items.map((item) => (
          <li key={item.href} className="bg-elevated">
            <Link
              href={item.href}
              className="group flex h-full cursor-pointer items-center gap-4 px-5 py-4 transition-[background-color] duration-150 ease-(--ease-out) hover:bg-neutral-50"
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-[8px] border",
                  item.urgent
                    ? "border-status-danger/20 bg-status-danger-bg text-status-danger"
                    : "border-(--card-hairline) bg-neutral-50 text-neutral-700"
                )}
              >
                <item.icon className="size-[18px]" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("truncate text-sm font-semibold", item.urgent && "text-status-danger")}>
                  {item.title}
                </span>
                <span className="truncate text-[12.5px] text-muted-foreground">{item.detail}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-neutral-400 transition-transform duration-150 ease-(--ease-out) group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
