"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAffiliate } from "./loginAffiliate";

export function LoginForm({
  merchantName,
  canJoin,
  canReset,
}: {
  merchantName: string | null;
  canJoin: boolean;
  /** The product has email on, so a forgotten password can be reset here. */
  canReset: boolean;
}) {
  const [state, formAction, pending] = useActionState(loginAffiliate, { error: "" });
  // Held here so a refused login keeps the email: React resets an
  // uncontrolled form after every action.
  const [email, setEmail] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        {merchantName && <CardDescription>{merchantName} affiliate program</CardDescription>}
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <p role="alert" className="text-[13px] text-status-danger">
              {state.error}
            </p>
          )}
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
            <div className="flex items-baseline justify-between gap-4">
              <Label htmlFor="password">Password</Label>
              {canReset && (
                <Link
                  href="/affiliates/forgot-password"
                  className="cursor-pointer text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            <Input id="password" type="password" name="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" className="cursor-pointer" disabled={pending}>
            Log in
          </Button>
          {!canReset && (
            <p className="text-center text-[13px] text-muted-foreground text-pretty">
              Forgot your password, or never set one? Ask {merchantName ?? "the program owner"} for a password link.
            </p>
          )}
          {canJoin && (
            <p className="text-center text-[13px] text-muted-foreground">
              New here?{" "}
              <Link href="/affiliates" className="cursor-pointer font-medium text-foreground underline underline-offset-2">
                Join the program
              </Link>
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
