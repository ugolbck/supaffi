"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectEmailAction } from "./connectEmailAction";

type FormState = { error: string };

export function ResendConnectForm({
  merchantId,
  domain,
  alreadyConnected,
}: {
  merchantId: string;
  domain: string;
  alreadyConnected: boolean;
}) {
  const action = connectEmailAction.bind(null, merchantId, alreadyConnected);
  const [state, formAction] = useActionState<FormState, FormData>(action, { error: "" });

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && (
        <p role="alert" className="text-sm text-status-danger">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="apiKey">Resend API key</Label>
        <Input
          id="apiKey"
          name="apiKey"
          type="password"
          placeholder={alreadyConnected ? "Leave blank to keep the current one" : "re_..."}
          required={!alreadyConnected}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sent from your own Resend account, so emails come from your brand.
        </p>
      </div>

      <div className="rounded-(--radius-md) border border-border/70 bg-muted/50 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Verify{" "}
          <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {domain}
          </code>{" "}
          as a sending domain in Resend first, or delivery silently fails.
        </p>
      </div>

      <div className="flex items-center gap-4 border-t border-border/60 pt-5">
        <Button type="submit" size="lg">
          {alreadyConnected ? "Save changes" : "Connect Resend"}
        </Button>
      </div>
    </form>
  );
}
