"use client";

import { useActionState } from "react";
import { completeSetup } from "./completeSetup";

const initialState = { error: "" };

export function SetupForm() {
  const [state, formAction] = useActionState(completeSetup, initialState);

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      <label>
        Email
        <input type="email" name="email" required />
      </label>
      <label>
        Password
        <input type="password" name="password" required minLength={12} />
      </label>
      <label>
        Confirm password
        <input type="password" name="confirmPassword" required minLength={12} />
      </label>
      <button type="submit" className="cursor-pointer">Create account</button>
    </form>
  );
}
