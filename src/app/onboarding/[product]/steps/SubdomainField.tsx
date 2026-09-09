"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateSubdomainAction } from "../actions";

export function SubdomainField({ product, value }: { product: { id: string; slug: string }; value: string }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateSubdomainAction.bind(null, product), { error: "" });

  if (!editing) {
    return (
      <div className="flex items-center justify-between rounded-(--radius-md) border border-border/70 px-4 py-3">
        <span className="font-mono text-sm">{value}</span>
        <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input name="domain" defaultValue={value} autoFocus className="font-mono" />
        <Button type="submit" className="cursor-pointer" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {state.error && <p role="alert" className="text-sm text-status-danger">{state.error}</p>}
    </form>
  );
}
