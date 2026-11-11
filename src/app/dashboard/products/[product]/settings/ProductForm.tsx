"use client";

import { useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductRef } from "@/lib/merchant";
import { normalizeDomain } from "@/lib/productValidation";
import { updateProductAction } from "./settingsActions";

/**
 * Name, website and subdomain, edited in place.
 *
 * A save that works redirects to `?fresh=dns`, so the page comes back with the
 * two lights beside the subdomain re-run rather than served from the cache: a
 * subdomain changed here resolves somewhere else, and the old result would be
 * about the old name. Only a failure returns, which is why there is no "saved"
 * line to draw.
 *
 * A new subdomain is confirmed first. Every link already shared names the
 * old one, so does the script tag on the owner's site, and Stripe has to be
 * told too.
 */

function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  // Aligned to the top, with the label nudged onto the input's centre line, so
  // a field with something under it keeps its label beside the field.
  return (
    <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[7rem_1fr] sm:items-start sm:gap-4">
      <Label htmlFor={htmlFor} className="text-muted-foreground sm:h-9">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * What a new subdomain does to the payment provider's webhook: Supaffi moves
 * the endpoint it made, the owner moves one they made, and with no webhook
 * there is nothing to say.
 */
export type SubdomainWebhook = { move: "moves" | "manual"; provider: string } | null;

function webhookLine({ move, provider }: NonNullable<SubdomainWebhook>): string {
  return move === "moves"
    ? `Supaffi will point ${provider} at the new address.`
    : `You will also need to change the webhook address in ${provider}.`;
}

export function ProductForm({
  product,
  initial,
  lights,
  webhook,
}: {
  product: ProductRef;
  initial: { name: string; domain: string; websiteUrl: string };
  /** The two DNS lights, rendered on the server and sat beside the subdomain. */
  lights: ReactNode | null;
  webhook: SubdomainWebhook;
}) {
  const [state, action, pending] = useActionState(updateProductAction.bind(null, product), {
    error: "",
  });
  const values = state.values ?? initial;
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [confirming, setConfirming] = useState(false);

  // Set only for the confirm button's own submit, so a refused save, or a
  // later change, asks again.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmed.current) return;
    const domain = normalizeDomain(String(new FormData(event.currentTarget).get("domain") ?? ""));
    if (domain === initial.domain) return;
    event.preventDefault();
    setConfirming(true);
  }

  return (
    <form ref={form} action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
      <Row label="Name" htmlFor="name">
        <Input id="name" name="name" defaultValue={values.name} required />
      </Row>
      <Row label="Website" htmlFor="websiteUrl">
        <Input
          id="websiteUrl"
          name="websiteUrl"
          defaultValue={values.websiteUrl}
          placeholder="example.com"
          required
        />
      </Row>
      <Row label="Subdomain" htmlFor="domain">
        <div className="flex flex-col gap-3">
          <Input
            id="domain"
            name="domain"
            defaultValue={values.domain}
            className="font-mono lg:max-w-80"
            required
          />
          {lights && <div className="rounded-(--radius) border border-neutral-200 bg-neutral-50 lg:max-w-md">{lights}</div>}
        </div>
      </Row>

      {state.error && (
        <p role="alert" className="text-sm text-status-danger">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" className="cursor-pointer" disabled={pending}>
          {pending ? "Saving" : "Save"}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the subdomain?</AlertDialogTitle>
            <AlertDialogDescription>
              Links already shared with {initial.domain} will stop working, and the script on your site
              needs the new address.
              {webhook && ` ${webhookLine(webhook)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <Button
              type="button"
              className="cursor-pointer"
              onClick={() => {
                setConfirming(false);
                // The submit event runs inside requestSubmit, or not at all
                // when the browser's own validation stops it.
                confirmed.current = true;
                form.current?.requestSubmit();
                confirmed.current = false;
              }}
            >
              Change subdomain
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
