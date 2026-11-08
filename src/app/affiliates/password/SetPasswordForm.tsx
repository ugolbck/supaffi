"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

// The refusal setAffiliatePassword gives an expired or used link.
const INVALID_LINK = "This link has expired or was already used.";

type Action = (prevState: { error: string }, formData: FormData) => Promise<{ error: string }>;

export function SetPasswordForm({ action, canReset }: { action: Action; canReset: boolean }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set your password</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <p role="alert" className="text-[13px] text-status-danger">
              {state.error}
              {state.error === INVALID_LINK &&
                (canReset ? (
                  <>
                    {" "}
                    <Link href="/affiliates/forgot-password" className="cursor-pointer font-medium underline underline-offset-2">
                      Get a new link
                    </Link>
                  </>
                ) : (
                  " Ask for a new one."
                ))}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>
          <Button type="submit" className="cursor-pointer" disabled={pending}>
            Save and log in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
