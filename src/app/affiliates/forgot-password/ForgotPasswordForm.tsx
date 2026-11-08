"use client";

import Link from "next/link";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordLink } from "./requestPasswordLink";

export function ForgotPasswordForm({ merchantName }: { merchantName: string }) {
  const [state, formAction, pending] = useActionState(requestPasswordLink, { sentTo: "" });

  if (state.sentTo) {
    return (
      <Card className="animate-in duration-300 fade-in-0">
        <CardHeader>
          <MailCheck aria-hidden className="mb-1 size-5 text-primary" />
          <CardTitle>Check your email</CardTitle>
          <CardDescription className="text-pretty">
            If {state.sentTo} has an account, a link to set your password is on its way. It works for 1 hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/affiliates/login"
            className="cursor-pointer text-[13px] font-medium underline underline-offset-2"
          >
            Back to log in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>{merchantName} affiliate program</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" name="email" autoComplete="email" required autoFocus />
          </div>
          <Button type="submit" className="cursor-pointer" disabled={pending}>
            Email me a link
          </Button>
          <p className="text-center text-[13px] text-muted-foreground">
            <Link href="/affiliates/login" className="cursor-pointer font-medium text-foreground underline underline-offset-2">
              Back to log in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
