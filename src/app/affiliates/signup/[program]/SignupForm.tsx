"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormState = { status: "form" | "sent"; error: string };

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  programName: string;
  merchantName: string;
};

export function SignupForm({ action, programName, merchantName }: Props) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {
    status: "form",
    error: "",
  });

  if (state.status === "sent") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We sent a login link to your inbox. Click it to activate your affiliate account.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Join {merchantName}&apos;s {programName} program
        </CardTitle>
        <CardDescription>
          Start sharing your link right after you confirm your email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <p role="alert" className="text-sm text-status-danger">
              {state.error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" type="text" name="name" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" name="email" required />
          </div>
          <Button type="submit">Sign up</Button>
        </form>
      </CardContent>
    </Card>
  );
}
