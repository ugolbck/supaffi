"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeSetup } from "./completeSetup";

const initialState = { error: "" };

export function SetupForm() {
  const [state, formAction] = useActionState(completeSetup, initialState);

  return (
    <Card className="w-full max-w-sm animate-in fade-in zoom-in-95 duration-300 ease-out">
      <CardHeader>
        <CardTitle className="text-xl">Set up Supaffi</CardTitle>
        <CardDescription>
          Create the Owner account for this Instance. This can only be done once.
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
            <Label htmlFor="setupToken">Setup token</Label>
            <Input
              id="setupToken"
              name="setupToken"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <p className="text-xs text-muted-foreground">
              Printed in this instance&apos;s logs at startup.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" name="email" autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={12}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={12}
            />
          </div>
          <Button type="submit" className="mt-1">
            Create account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
