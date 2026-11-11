"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormCard } from "@/components/Field";
import { createProductAction } from "./productAction";

const PROVIDERS: Record<string, string> = { STRIPE: "Stripe", POLAR: "Polar" };

export function ProductForm() {
  const [state, action, pending] = useActionState(createProductAction, { error: "" });
  return (
    <form action={action} className="flex flex-col gap-6">
      <FormCard>
        <Field label="Name" htmlFor="product-name">
          <Input id="product-name" name="name" required autoFocus placeholder="Your product" />
        </Field>
        <Field label="Website" htmlFor="product-website">
          <Input
            id="product-website"
            name="websiteUrl"
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            required
            placeholder="yoursite.com"
          />
        </Field>
        <Field label="Payments" htmlFor="product-provider">
          <Select name="paymentProvider" items={PROVIDERS} defaultValue="STRIPE">
            <SelectTrigger id="product-provider" className="h-9 w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDERS).map(([id, text]) => (
                <SelectItem key={id} value={id} className="cursor-pointer">
                  {text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FormCard>
      {state.error && (
        <p role="alert" className="text-[13px] text-status-danger">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" className="cursor-pointer" disabled={pending}>
          {pending ? "Creating" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
