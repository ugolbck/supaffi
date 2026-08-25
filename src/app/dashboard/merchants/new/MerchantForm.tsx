"use client";

import { useActionState } from "react";

type FormState = { error: string };

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  initial?: { name: string; domain: string };
  credentialsRequired: boolean;
};

export function MerchantForm({ action, initial, credentialsRequired }: Props) {
  const [state, formAction] = useActionState(action, { error: "" });

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      <label>
        Name
        <input type="text" name="name" defaultValue={initial?.name} required />
      </label>
      <label>
        Domain
        <input
          type="text"
          name="domain"
          defaultValue={initial?.domain}
          placeholder="affiliates.example.com"
          required
        />
      </label>
      <label>
        Stripe secret key
        <input
          type="password"
          name="stripeSecretKey"
          placeholder={credentialsRequired ? "sk_..." : "Leave blank to keep the current key"}
          required={credentialsRequired}
        />
      </label>
      <label>
        Stripe webhook signing secret
        <input
          type="password"
          name="stripeWebhookSecret"
          placeholder={credentialsRequired ? "whsec_..." : "Leave blank to keep the current secret"}
          required={credentialsRequired}
        />
      </label>
      <label>
        Email provider configuration
        <input
          type="password"
          name="emailProviderConfig"
          placeholder={credentialsRequired ? "" : "Leave blank to keep the current configuration"}
          required={credentialsRequired}
        />
      </label>
      <button type="submit" className="cursor-pointer">
        {credentialsRequired ? "Create Merchant" : "Save changes"}
      </button>
    </form>
  );
}
