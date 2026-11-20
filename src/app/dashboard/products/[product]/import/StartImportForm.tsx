"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormCard } from "@/components/Field";
import { IMPORT_SOURCES, type ImportSourceKey } from "@/lib/import/types";

type Action = (prev: { error: string }, formData: FormData) => Promise<{ error: string }>;

const LABELS = Object.fromEntries(Object.entries(IMPORT_SOURCES).map(([key, s]) => [key, s.label]));

/** Which tool, and its API key. Nothing is written until the Owner has seen what was read. */
export function StartImportForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [source, setSource] = useState<ImportSourceKey>("REWARDFUL");
  const meta = IMPORT_SOURCES[source];

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-5">
      <FormCard>
        <Field label="Moving from" htmlFor="import-source">
          <Select name="source" items={LABELS} value={source} onValueChange={(value) => setSource(value as ImportSourceKey)}>
            <SelectTrigger id="import-source" className="h-9 w-56 cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key} className="cursor-pointer">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={`${meta.label} API key`} htmlFor="import-key">
          <Input
            id="import-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            required
          />
          <span className="text-xs text-muted-foreground">In {meta.label}: {meta.keyHelp}</span>
        </Field>
        {meta.needsAccountId && (
          <div className="grid grid-cols-[1fr_auto] gap-5">
            <Field label="Account ID" htmlFor="import-account">
              <Input id="import-account" name="accountId" autoComplete="off" required />
            </Field>
            <Field label="Account currency" htmlFor="import-currency">
              <Input id="import-currency" name="currency" defaultValue="USD" maxLength={3} required className="w-20 uppercase" />
            </Field>
          </div>
        )}
      </FormCard>
      {state.error && (
        <p role="alert" className="text-[13px] text-status-danger">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" className="cursor-pointer" disabled={pending}>
          Read my program
        </Button>
      </div>
    </form>
  );
}
