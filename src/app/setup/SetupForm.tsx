"use client";

import { useActionState, useState } from "react";
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
  const [state, formAction, pending] = useActionState(completeSetup, initialState);
  // Held here so a refused attempt keeps what was typed: React resets an
  // uncontrolled form after every action.
  const [setupToken, setSetupToken] = useState("");
  const [email, setEmail] = useState("");

  return (
    <Card className="animate-in fade-in zoom-in-95 duration-300 ease-out">
      <CardHeader>
        <CardTitle className="text-xl">Set up Supaffi</CardTitle>
        <CardDescription>
          Create the owner account. This can only be done once.
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
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Printed in this instance&apos;s logs at startup.
            </p>
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
          <Button type="submit" className="mt-1 cursor-pointer" disabled={pending}>
            Create account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
