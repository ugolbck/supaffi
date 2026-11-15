import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Stands in for an address built from the product's domain while the product
 * has none, which happens when another Owner's claim took it before it was
 * verified. Never a broken URL in its place.
 */
export function SetDomainFirst({ slug, className }: { slug: string; className?: string }) {
  return (
    <span className={cn("text-sm text-muted-foreground", className)}>
      <Link href={`/dashboard/products/${slug}/settings`} className="cursor-pointer underline underline-offset-[3px] hover:text-foreground">
        Set a domain first
      </Link>
    </span>
  );
}
