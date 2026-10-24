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
import { login } from "./actions";

const initialState = { error: "" };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);
  // Held here so a refused login keeps the email: React resets an
  // uncontrolled form after every action.
  const [email, setEmail] = useState("");

  return (
    <Card className="animate-in fade-in zoom-in-95 duration-300 ease-out">
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Log in to Supaffi.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <p role="alert" className="text-sm text-status-danger">
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" className="mt-1 cursor-pointer" disabled={pending}>
            Log in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
