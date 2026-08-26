"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestAffiliateLogin } from "./requestAffiliateLogin";

const initialState = { status: "form" as const };

export function LoginForm() {
  const [state, formAction] = useActionState(requestAffiliateLogin, initialState);

  if (state.status === "sent") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If an affiliate account exists for that address, we sent a login link.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>We&apos;ll email you a link — no password needed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" name="email" required />
          </div>
          <Button type="submit">Send login link</Button>
        </form>
      </CardContent>
    </Card>
  );
}
