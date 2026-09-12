"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TaskCard, TaskCardHeader, TaskCardSection } from "@/components/onboarding/TaskCard";
import { createProductAction } from "./productAction";

const FIELD =
  "h-14 w-full min-w-0 bg-transparent px-4 text-[15px] outline-none placeholder:text-neutral-400";

export function ProductForm() {
  const [state, action, pending] = useActionState(createProductAction, { error: "" });
  return (
    <form action={action} className="flex flex-col gap-6">
      <TaskCard>
        <TaskCardHeader title="Name" />
        <TaskCardSection>
          <input name="name" required autoFocus placeholder="Your product" className={FIELD} aria-label="Product name" />
        </TaskCardSection>
        <TaskCardHeader title="Website" />
        <TaskCardSection>
          <input
            name="websiteUrl"
            type="url"
            required
            placeholder="https://yoursite.com"
            className={`${FIELD} font-mono`}
            aria-label="Website"
          />
        </TaskCardSection>
      </TaskCard>
      {state.error && (
        <p role="alert" className="text-[13px] text-status-danger">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Creating" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
