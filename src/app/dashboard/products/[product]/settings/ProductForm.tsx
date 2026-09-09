"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductRef } from "@/lib/merchant";
import { updateProductAction } from "./settingsActions";

/**
 * Name, website and subdomain, edited in place.
 *
 * The action returns an error or nothing, so "Saved" is drawn from having
 * submitted at least once rather than from a flag in the state: the fields
 * keep whatever was typed either way, and a stale confirmation cannot outlive
 * a later failure.
 */

function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[7rem_1fr] sm:items-center sm:gap-4">
      <Label htmlFor={htmlFor} className="text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function ProductForm({
  product,
  initial,
  lights,
}: {
  product: ProductRef;
  initial: { name: string; domain: string; websiteUrl: string };
  /** The two DNS lights, rendered on the server and sat beside the subdomain. */
  lights: ReactNode;
}) {
  const [state, action, pending] = useActionState(updateProductAction.bind(null, product), {
    error: "",
  });
  // Watched off the transition rather than an onSubmit handler, so nothing
  // depends on a submit listener running beside a form action.
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (pending) setSubmitted(true);
  }, [pending]);
  const saved = submitted && !pending && !state.error;

  return (
    <form action={action} className="flex flex-col gap-4">
      <Row label="Name" htmlFor="name">
        <Input id="name" name="name" defaultValue={initial.name} required />
      </Row>
      <Row label="Website" htmlFor="websiteUrl">
        <Input
          id="websiteUrl"
          name="websiteUrl"
          defaultValue={initial.websiteUrl}
          placeholder="https://example.com"
          required
        />
      </Row>
      <Row label="Subdomain" htmlFor="domain">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
          <Input
            id="domain"
            name="domain"
            defaultValue={initial.domain}
            className="font-mono lg:max-w-80"
            required
          />
          <div className="flex flex-wrap items-center gap-4">{lights}</div>
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
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
      </div>
    </form>
  );
}
