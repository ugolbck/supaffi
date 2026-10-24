"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

type Action = (prevState: { error: string }, formData: FormData) => Promise<{ error: string }>;

export function SetPasswordForm({ action }: { action: Action }) {
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
