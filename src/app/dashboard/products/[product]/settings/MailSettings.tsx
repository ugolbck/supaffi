"use client";

import { useActionState, useState, useTransition } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Section } from "@/components/dashboard/Page";
import { Term } from "@/components/Term";
import type { MailStatus, MailSwitch } from "@/lib/mail";
import type { ProductRef } from "@/lib/merchant";
import {
  connectMailAction,
  disconnectMailAction,
  sendTestEmailAction,
  setMailSwitchAction,
  type MailFormState,
} from "./emailActions";

/**
 * The mail server a product's emails go out through, in its settings.
 *
 * Picking a provider fills in its server, so most owners type a key and an
 * address and nothing else. Connecting sends a test email first and saves only
 * when it goes through, so email is either working or off, never half set up.
 */

type Provider = {
  label: string;
  host: string;
  port: string;
  /** Fixed username, so the field is not shown. */
  user?: string;
  userLabel?: string;
  password: { label: string; tip?: string };
  /** Gmail sends from the account itself. */
  fromIsUser?: boolean;
};

const PROVIDERS: Record<string, Provider> = {
  resend: {
    label: "Resend",
    host: "smtp.resend.com",
    port: "465",
    user: "resend",
    password: { label: "API key", tip: "Create one in Resend under API Keys. The address you send from must be on a domain verified there." },
  },
  brevo: {
    label: "Brevo",
    host: "smtp-relay.brevo.com",
    port: "587",
    userLabel: "Login",
    password: { label: "SMTP key", tip: "Your login and key are in Brevo under SMTP & API." },
  },
  gmail: {
    label: "Gmail",
    host: "smtp.gmail.com",
    port: "465",
    userLabel: "Gmail address",
    password: { label: "App password", tip: "Create one at myaccount.google.com/apppasswords. Needs 2-Step Verification on." },
    fromIsUser: true,
  },
  other: { label: "Other", host: "", port: "587", userLabel: "Username", password: { label: "Password" } },
};

const PROVIDER_ITEMS = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, p.label]));

function providerFor(host: string): string {
  return Object.entries(PROVIDERS).find(([, p]) => p.host && p.host === host)?.[0] ?? "other";
}

const EMPTY: MailFormState = { error: "", sentTo: "" };

export function MailSettings({ product, status }: { product: ProductRef; status: MailStatus }) {
  // Held here rather than in the form: a connect that works brings the saved
  // settings back with it, which swaps the form out for the connected view in
  // the same render, and the form's own state would go with it.
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<MailFormState>(EMPTY);
  // The result on screen when the form last opened: an error from before a
  // Cancel is not shown again when it reopens.
  const [seen, setSeen] = useState<MailFormState | null>(null);
  const [connectState, connect, connecting] = useActionState(async (prev: MailFormState, formData: FormData) => {
    const result = await connectMailAction(product, prev, formData);
    if (result.sentTo) {
      setNotice(result);
      setEditing(false);
    }
    return result;
  }, EMPTY);

  return (
    <Section title="Email">
      {status && !editing ? (
        <Connected
          product={product}
          onTurnedOff={() => setSeen(connectState)}
          status={status}
          notice={notice}
          setNotice={setNotice}
          onChange={() => {
            setNotice(EMPTY);
            setSeen(connectState);
            setEditing(true);
          }}
        />
      ) : (
        <ConnectForm
          initial={status}
          action={connect}
          pending={connecting}
          error={connectState === seen ? "" : connectState.error}
          onCancel={
            status
              ? () => {
                  setSeen(connectState);
                  setEditing(false);
                }
              : undefined
          }
        />
      )}
    </Section>
  );
}

function Row({ label, htmlFor, children }: { label: React.ReactNode; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[7rem_1fr] sm:items-center sm:gap-4">
      <Label htmlFor={htmlFor} className="text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function ConnectForm({
  initial,
  action,
  pending,
  error,
  onCancel,
}: {
  initial: MailStatus;
  action: (formData: FormData) => void;
  pending: boolean;
  error: string;
  onCancel?: () => void;
}) {
  const [providerId, setProviderId] = useState(initial ? providerFor(initial.host) : "resend");
  const provider = PROVIDERS[providerId];
  const custom = providerId === "other";
  // Controlled so a refused connect keeps everything typed, and so switching
  // provider does not throw it away.
  const [fields, setFields] = useState({
    host: initial?.host ?? "",
    port: initial ? String(initial.port) : "587",
    user: initial?.user ?? "",
    from: initial?.from ?? "",
  });
  const set = (name: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [name]: e.target.value }));

  const host = custom ? fields.host : provider.host;
  const port = custom ? fields.port : provider.port;
  const user = provider.user ?? fields.user;
  const from = provider.fromIsUser ? fields.user : fields.from;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="host" value={host} />
      <input type="hidden" name="port" value={port} />
      <input type="hidden" name="user" value={user} />
      <input type="hidden" name="from" value={from} />

      <Row label="Provider" htmlFor="mail-provider">
        <Select items={PROVIDER_ITEMS} value={providerId} onValueChange={(v) => setProviderId(String(v))}>
          <SelectTrigger id="mail-provider" className="h-9 w-full cursor-pointer sm:max-w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PROVIDER_ITEMS).map(([id, label]) => (
              <SelectItem key={id} value={id} className="cursor-pointer">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      {custom && (
        <Row label={<Term tip="Your email provider's SMTP server, from its settings.">Server</Term>} htmlFor="mail-host">
          <div className="flex gap-2 sm:max-w-80">
            <Input id="mail-host" value={fields.host} onChange={set("host")} placeholder="smtp.example.com" className="min-w-0 flex-1" spellCheck={false} required />
            <Input aria-label="Port" value={fields.port} onChange={set("port")} inputMode="numeric" className="w-20 tabular-nums" required />
          </div>
        </Row>
      )}

      {!provider.user && (
        <Row label={provider.userLabel} htmlFor="mail-user">
          <Input
            id="mail-user"
            value={fields.user}
            onChange={set("user")}
            type={provider.fromIsUser ? "email" : "text"}
            autoComplete="off"
            spellCheck={false}
            className="sm:max-w-80"
            required={!custom}
          />
        </Row>
      )}

      <Row label={provider.password.tip ? <Term tip={provider.password.tip}>{provider.password.label}</Term> : provider.password.label} htmlFor="mail-password">
        <Input
          id="mail-password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={initial ? "Unchanged" : undefined}
          className="sm:max-w-80"
          required={!initial && !custom}
        />
      </Row>

      {!provider.fromIsUser && (
        <Row label="Send from" htmlFor="mail-from">
          <Input
            id="mail-from"
            type="email"
            value={fields.from}
            onChange={set("from")}
            placeholder="affiliates@yourdomain.com"
            spellCheck={false}
            className="sm:max-w-80"
            required
          />
        </Row>
      )}

      {error && (
        <p role="alert" className="text-sm text-status-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="cursor-pointer" disabled={pending}>
          {pending ? "Sending a test" : "Connect"}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" className="cursor-pointer" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

const SWITCHES: { name: MailSwitch; label: string }[] = [
  { name: "notifyNewAffiliates", label: "Email me when someone joins" },
  { name: "notifyNewSales", label: "Email me when a sale comes in" },
  { name: "emailAffiliates", label: "Email affiliates when they join, earn and get paid" },
];

function Connected({
  product,
  onTurnedOff,
  status,
  notice,
  setNotice,
  onChange,
}: {
  product: ProductRef;
  /** The form comes back empty, so nothing from an earlier connect shows on it. */
  onTurnedOff: () => void;
  status: NonNullable<MailStatus>;
  notice: MailFormState;
  setNotice: (state: MailFormState) => void;
  onChange: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOff, setConfirmOff] = useState(false);
  const provider = PROVIDERS[providerFor(status.host)];

  return (
    <div className="flex flex-col gap-4">
      <Row label="Sending from">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="min-w-0 truncate text-sm">
            {status.from}
            <span className="text-muted-foreground"> · {provider.host ? provider.label : status.host}</span>
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="cursor-pointer"
              disabled={pending}
              onClick={() => startTransition(async () => setNotice(await sendTestEmailAction(product)))}
            >
              {pending ? "Sending" : "Send test"}
            </Button>
            <Button type="button" size="sm" variant="secondary" className="cursor-pointer" onClick={onChange}>
              Change
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="cursor-pointer text-muted-foreground hover:text-status-danger"
              onClick={() => setConfirmOff(true)}
            >
              Turn off
            </Button>
          </div>
        </div>
      </Row>

      {status.failure && !notice.sentTo && (
        <p role="alert" className="text-sm text-status-danger">
          Emails stopped going out: {status.failure.message}
        </p>
      )}
      {notice.error && (
        <p role="alert" className="text-sm text-status-danger">
          {notice.error}
        </p>
      )}
      {notice.sentTo && (
        <p className="flex animate-in items-center gap-1.5 text-sm duration-300 fade-in-0">
          <MailCheck aria-hidden className="size-4 text-status-success" />
          Test email sent to {notice.sentTo}.
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        {SWITCHES.map((s) => (
          <MailToggle key={s.name} product={product} name={s.name} label={s.label} on={status[s.name]} />
        ))}
      </div>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off email?</AlertDialogTitle>
            <AlertDialogDescription>Nothing is sent until you connect again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="cursor-pointer"
              disabled={pending}
              onClick={() => {
                setNotice(EMPTY);
                startTransition(async () => {
                  await disconnectMailAction(product);
                  onTurnedOff();
                  setConfirmOff(false);
                });
              }}
            >
              {pending ? "Turning off" : "Turn off"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Saves the moment it is ticked. The box shows the new state straight away and
 * goes back if the save fails.
 */
function MailToggle({ product, name, label, on }: { product: ProductRef; name: MailSwitch; label: string; on: boolean }) {
  const [checked, setChecked] = useState(on);
  const [, startTransition] = useTransition();
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => {
          setChecked(next);
          startTransition(async () => {
            try {
              await setMailSwitchAction(product, name, next);
            } catch {
              setChecked(!next);
            }
          });
        }}
        className="cursor-pointer"
      />
      {label}
    </label>
  );
}
