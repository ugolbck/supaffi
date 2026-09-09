"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductRef } from "@/lib/merchant";
import { updateProductAction } from "./settingsActions";

/**
 * Name, website and subdomain, edited in place.
 *
 * A save that works redirects to `?fresh=dns`, so the page comes back with the
 * two lights beside the subdomain re-run rather than served from the cache: a
 * subdomain changed here resolves somewhere else, and the old result would be
 * about the old name. Only a failure returns, which is why there is no "saved"
 * line to draw.
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
      </div>
    </form>
  );
}
