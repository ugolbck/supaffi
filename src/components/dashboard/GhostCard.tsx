import Link from "next/link";
import { Plus } from "lucide-react";

/**
 * The dashed cell that ends a card grid.
 *
 * A three-column grid with one real card leaves two holes. This fills the next
 * one with the action that would fill it for real, so the row lands flush and
 * the empty state and the full state are the same layout.
 */
export function GhostCard({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group/ghost flex h-full min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-xl) border border-dashed border-border text-muted-foreground transition-[border-color,color,background-color] duration-200 ease-[var(--ease-out)] hover:border-primary/50 hover:bg-card/60 hover:text-foreground"
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-muted transition-colors duration-200 ease-[var(--ease-out)] group-hover/ghost:bg-primary/10">
        <Plus className="size-4" />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}
