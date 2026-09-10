"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TaskCard, TaskCardBody, TaskCardHeader } from "@/components/onboarding/TaskCard";

type FormState = { status: "form" | "sent"; error: string };

export type SignupFormAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

type Props = {
  action: SignupFormAction;
};

export function SignupForm({ action }: Props) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {
    status: "form",
    error: "",
  });

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
            <Input id="name" type="text" name="name" autoComplete="name" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" name="email" autoComplete="email" required />
          </div>
          <Button type="submit" size="lg" className="mt-1">
            Sign up
          </Button>
        </form>
      </TaskCardBody>
    </TaskCard>
  );
}
