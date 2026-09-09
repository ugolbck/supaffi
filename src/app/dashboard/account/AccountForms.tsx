"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/dashboard/Page";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";
import { changeEmailAction, changePasswordAction } from "./accountActions";

/**
 * The two forms that change the account, each asking for the current password
 * before it will do anything: a session left open on a shared machine should
 * not be enough to take the account over.
 *
 * The confirmation under each one says what happens next rather than "saved",
 * because in both cases something the owner can see is now out of date: the
 * email in the sidebar until the next login, and the session itself the moment
 * the password changes.
 */

const EMPTY = { error: "", done: false };

function Field({
  id,
  label,
  type,
  autoComplete,
  minLength,
  defaultValue,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  minLength?: number;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-4">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        defaultValue={defaultValue}
        className="sm:max-w-80"
        required
      />
    </div>
  );
}

function Result({ state, done }: { state: { error: string; done: boolean }; done: string }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-status-danger">
        {state.error}
      </p>
    );
  }
  if (state.done) return <p className="text-sm text-muted-foreground">{done}</p>;
  return null;
}

export function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changeEmailAction, EMPTY);

  return (
    <Section title="Email">
      <form action={action} className="flex flex-col gap-4">
        <Field id="email" label="New email" type="email" autoComplete="email" defaultValue={email} />
        <Field
          id="password"
          label="Current password"
          type="password"
          autoComplete="current-password"
        />
        <Result state={state} done="Takes effect next time you log in." />
        <div>
          <Button type="submit" size="sm" className="cursor-pointer" disabled={pending}>
            {pending ? "Saving" : "Change email"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, EMPTY);

  return (
    <Section title="Password">
      <form action={action} className="flex flex-col gap-4">
        <Field
          id="current"
          label="Current password"
          type="password"
          autoComplete="current-password"
        />
        <Field
          id="next"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
        />
        <Result state={state} done="Password changed. You will be asked to log in again." />
        <div>
          <Button type="submit" size="sm" className="cursor-pointer" disabled={pending}>
            {pending ? "Saving" : "Change password"}
          </Button>
        </div>
      </form>
    </Section>
  );
}
