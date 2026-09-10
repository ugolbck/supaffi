"use client";

import { useActionState, useState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TaskCard, TaskCardBody, TaskCardHeader } from "@/components/onboarding/TaskCard";
import { slugify } from "@/lib/slugify";
import { validateCode } from "./validation";

type FormState = { status: "form" | "sent"; error: string };

export type SignupFormAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

type Props = {
  action: SignupFormAction;
  /** Host the affiliate's link points at, e.g. "mokkit.co". No scheme, no trailing slash. */
  linkHost: string;
};

export function SignupForm({ action, linkHost }: Props) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {
    status: "form",
    error: "",
  });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);

  // Follows the name until they edit it directly, same as any slug field:
  // the moment they touch it, it's theirs to shape, not the name's.
  const displayCode = codeTouched ? code : slugify(name);
  const codeError = codeTouched && code ? validateCode(code).error : null;

  if (state.status === "sent") {
    return (
      <TaskCard>
        <TaskCardBody className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700">
            <MailCheck className="size-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-[13px] leading-5 font-semibold text-neutral-900">Check your email</p>
            <p className="text-[13px] leading-5 text-muted-foreground text-pretty">
              Open the link we just sent to finish signing up. It expires in 15 minutes.
            </p>
          </div>
        </TaskCardBody>
      </TaskCard>
    );
  }

  return (
    <TaskCard>
      <TaskCardHeader title="Sign up" />
      <TaskCardBody>
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
            <Input id="email" type="email" name="email" autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Your link</Label>
            <div className="flex h-9 items-center gap-1 rounded-lg border border-input bg-elevated px-3 shadow-[inset_0_1px_2px_rgba(15,15,35,0.04)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <span className="max-w-[45%] shrink truncate font-mono text-sm text-muted-foreground">
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
            <p className={codeError ? "text-xs text-status-danger" : "text-xs text-muted-foreground"}>
              {codeError ?? "This is the link you will share."}
            </p>
          </div>
          <Button type="submit" size="lg" className="mt-1">
            Sign up
          </Button>
        </form>
      </TaskCardBody>
    </TaskCard>
  );
}
