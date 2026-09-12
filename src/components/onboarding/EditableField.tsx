"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EditableResult = { error: string; savedAt?: number };

/**
 * A stored value with an editor that opens in place.
 *
 * `suffix` makes the trailing part fixed and uneditable. The subdomain step
 * needs that: the root domain belongs to the product's website and is set on
 * the product step, so letting someone retype it here would let the program's
 * address drift away from the site it sends people to. Only the label in
 * front of it is theirs to choose.
 */
export function EditableField({
  value,
  suffix,
  action,
  label,
  mono = true,
  bare = false,
}: {
  value: string;
  /** Fixed, uneditable tail. Rendered muted so it reads as not-yours. */
  suffix?: string;
  action: (prev: EditableResult, formData: FormData) => Promise<EditableResult>;
  /** Names the field for assistive tech. Never rendered. */
  label: string;
  mono?: boolean;
  /** Inside a TaskCard the surrounding card supplies the border. */
  bare?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState(value);
  const lastSaved = useRef<number | undefined>(undefined);
  const router = useRouter();
  // The refresh the action no longer does. It runs after the row has already
  // confirmed, so the checks below re-run in the background instead of
  // holding the Save button down while they do.
  const [rechecking, startRecheck] = useTransition();

  // A save that came back clean closes the editor. savedAt changes on every
  // successful write, so saving the same value twice still confirms.
  useEffect(() => {
    if (state.savedAt && state.savedAt !== lastSaved.current) {
      lastSaved.current = state.savedAt;
      setEditing(false);
      setConfirmed(true);
      startRecheck(() => router.refresh());
      const timer = setTimeout(() => setConfirmed(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [state.savedAt, router]);

  const row = cn(
    "flex h-14 items-center justify-between gap-3 pr-2.5 pl-4",
    !bare && "rounded-(--radius-md) border border-neutral-300 bg-white shadow-xs"
  );
  const text = cn("text-[15px]", mono && "font-mono");

  if (!editing) {
    return (
      <div className={row}>
        <span className={cn(text, "truncate")}>
          {value}
          {suffix && <span className="text-muted-foreground">{suffix}</span>}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {rechecking ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Checking
            </span>
          ) : (
            confirmed && (
              <span className="flex items-center gap-1 text-xs font-medium text-status-success">
                <Check className="size-3.5" />
                Saved
              </span>
            )
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <form action={formAction} className={cn(row, "focus-within:border-accent-400")}>
        {/* Borderless: the row is already the field. A bordered input inside a
            bordered row is two boxes for one value. */}
        <span className="flex min-w-0 flex-1 items-baseline">
          {/* The input is sized to its own text, not stretched to fill the
              row. Stretched, it pushed the fixed suffix to the far right and
              the domain looked like it had jumped away from the label it
              belongs to. `size` is in characters, which is exact here because
              the field is monospaced. */}
          <input
            name="value"
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            size={suffix ? Math.max(draft.length, 1) : undefined}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            className={cn(text, "min-w-0 bg-transparent outline-none", suffix ? "w-auto" : "flex-1")}
          />
          {suffix && <span className={cn(text, "shrink-0 text-muted-foreground")}>{suffix}</span>}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="submit" size="sm" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {pending ? "Saving" : "Save"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
      {state.error && (
        <p role="alert" className="px-4 pt-1.5 text-[13px] text-status-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
