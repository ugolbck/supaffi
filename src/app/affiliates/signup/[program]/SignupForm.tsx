"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";
import { slugify } from "@/lib/slugify";
import { validateCode } from "./validation";

type FormState = { error: string };

export type SignupFormAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

type Props = {
  action: SignupFormAction;
  /** Host the affiliate's link points at, e.g. "mokkit.co". No scheme, no trailing slash. */
  linkHost: string;
};

export function SignupForm({ action, linkHost }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: "" });
  const [name, setName] = useState("");
  // Controlled like the name, so a refused signup keeps it: React resets an
  // uncontrolled form after every action.
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);

  // Follows the name until they edit it directly, same as any slug field:
  // the moment they touch it, it's theirs to shape, not the name's.
  const displayCode = codeTouched ? code : slugify(name);
  const codeError = codeTouched && code ? validateCode(code).error : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign up</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <p role="alert" className="text-[13px] text-status-danger">
              {state.error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Your referral link</Label>
            <div className="flex h-9 items-center gap-1 rounded-(--radius) border border-input bg-white px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <span className="shrink-0 font-mono text-sm whitespace-nowrap text-muted-foreground">
                {linkHost}/?via=
              </span>
              <input
                id="code"
                name="code"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={displayCode}
                onChange={(e) => {
                  setCodeTouched(true);
                  setCode(e.target.value);
                }}
                aria-invalid={codeError ? true : undefined}
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none"
              />
            </div>
            <input type="hidden" name="codeTouched" value={codeTouched ? "1" : ""} />
            {/* The label says what the field is. A line under it saying so
                again was the kind of sentence nobody reads. Only an error
                earns the second line. */}
            {codeError && <p className="text-xs text-status-danger">{codeError}</p>}
          </div>
          <Button type="submit" size="lg" className="mt-1 cursor-pointer" disabled={pending}>
            Get my link
          </Button>
          <p className="text-center text-[13px] text-muted-foreground">
            Already signed up?{" "}
            <a href="/affiliates/login" className="cursor-pointer font-medium text-foreground underline underline-offset-2">
              Log in
            </a>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
