import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CommissionStatus } from "@/lib/commission";

// Locked 1:1 to Commission.status in the design system: a scan of the color
// alone has to say the state before the label is read. PAYABLE reads accent,
// PAID reads success green, and VOIDED stays muted with the badge struck
// through rather than alarming red, since it means "does not count" rather
// than "something went wrong."
const STATUS_STYLES: Record<CommissionStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PAYABLE: "bg-accent-50 text-accent-700",
  FLAGGED: "bg-status-warning-bg text-status-warning",
  PAID: "bg-status-success-bg text-status-success",
  VOIDED: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABELS: Record<CommissionStatus, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  FLAGGED: "Flagged",
  PAID: "Paid",
  VOIDED: "Voided",
};

/** A commission's state, the same badge on every owner screen that lists one. */
export function StatusBadge({ status, className }: { status: CommissionStatus; className?: string }) {
  return <Badge className={cn(STATUS_STYLES[status], className)}>{STATUS_LABELS[status]}</Badge>;
}
