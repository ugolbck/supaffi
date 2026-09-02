import Link from "next/link";
import { Check, Terminal, Radio, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { PageShell, PageHeader, Band } from "@/components/dashboard/PageGrid";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { LedgerScroller, LEDGER_ROW_HEIGHT } from "@/components/dashboard/LedgerScroller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StripeKeyKind } from "@/lib/merchant";
import type { WebhookHealth } from "@/lib/analytics";
import type { TrackingStatus } from "@/lib/tracking";
import type { DeliveryMode } from "@/lib/email/transport";

/**
 * Integrations, once setup is done: no step rail, no forward button, just
 * what is actually true right now (docs/design/wireframes.md, section 6).
 */

const DATETIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const KEY_KIND_LABEL: Record<Exclude<StripeKeyKind, null>, string> = {
  restricted: "restricted key",
  secret: "full secret key",
};

const DELIVERY_STATUS: Record<string, { label: string; className: string }> = {
  PROCESSED: { label: "Ok", className: "bg-status-success-bg text-status-success" },
  PENDING: { label: "Pending", className: "bg-muted text-muted-foreground" },
  PROCESSING: { label: "Pending", className: "bg-muted text-muted-foreground" },
  FAILED: { label: "Failed", className: "bg-status-warning-bg text-status-warning" },
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs tabular-nums">{children}</span>
    </div>
  );
}

function ConnectedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-status-success-bg px-2 py-0.5 text-xs font-medium text-status-success">
      <Check className="size-3" strokeWidth={3} />
      {label}
    </span>
  );
}

function StripeCard({
  base,
  keyKind,
  webhookUrl,
  health,
}: {
  base: string;
  keyKind: StripeKeyKind;
  webhookUrl: string;
  health: WebhookHealth;
}) {
  return (
    <DashboardCard
      title="Stripe"
      footer={
        <Link href={`${base}/integrations/stripe`}>
          <Button variant="outline" size="sm" className="w-full cursor-pointer">
            Replace key
          </Button>
        </Link>
      }
    >
      <div className="flex flex-1 flex-col justify-between gap-3">
        <div className="flex flex-col gap-3">
          <ConnectedBadge label={keyKind ? `Connected · ${KEY_KIND_LABEL[keyKind]}` : "Connected"} />
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
              {webhookUrl}
            </code>
            <CopyLinkButton size="sm" link={webhookUrl} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <Fact label="Last event">
            {health.lastEventAt ? DATETIME.format(health.lastEventAt) : "None yet"}
          </Fact>
          <Fact label="Events, 24h">{String(health.last24h)}</Fact>
        </div>
      </div>
    </DashboardCard>
  );
}

function EmailCard({
  base,
  domain,
  mode,
  connected,
}: {
  base: string;
  domain: string;
  mode: DeliveryMode;
  connected: boolean;
}) {
  const consoleMode = mode === "console";
  return (
    <DashboardCard
      title="Email"
      footer={
        <Link href={`${base}/integrations/resend`}>
          <Button variant="outline" size="sm" className="w-full cursor-pointer">
            {connected ? "Replace key" : "Connect Resend"}
          </Button>
        </Link>
      }
    >
      <div className="flex flex-1 flex-col justify-between gap-3">
        {consoleMode ? (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-800">
            <Terminal className="size-3" />
            Printed to the terminal
          </span>
        ) : (
          <ConnectedBadge label="Connected" />
        )}
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <Fact label="Delivery">{consoleMode ? "Console" : "Live"}</Fact>
          <Fact label="Provider">{connected ? "Resend" : "None"}</Fact>
          <Fact label="Sender">{`affiliates@${domain}`}</Fact>
        </div>
      </div>
    </DashboardCard>
  );
}

function TrackingCard({
  base,
  status,
  lastClickAt,
  verifiedAt,
}: {
  base: string;
  status: TrackingStatus;
  lastClickAt: Date | null;
  verifiedAt: Date | null;
}) {
  const live = status === "verified";
  return (
    <DashboardCard
      title="Tracking"
      className="lg:col-span-5"
      footer={
        <Link href={`${base}/tracking`}>
          <Button variant="outline" size="sm" className="w-full cursor-pointer">
            View snippets
          </Button>
        </Link>
      }
    >
      <div className="flex flex-1 flex-col justify-between gap-3">
        {live ? (
          <ConnectedBadge label="Live" />
        ) : (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <Radio className="size-3" />
            Awaiting a sale
          </span>
        )}
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <Fact label="Last click">{lastClickAt ? DATE.format(lastClickAt) : "None yet"}</Fact>
          <Fact label="Last attributed sale">
            {verifiedAt ? DATE.format(verifiedAt) : "Not yet"}
          </Fact>
        </div>
      </div>
    </DashboardCard>
  );
}

function DeliveriesCard({ health }: { health: WebhookHealth }) {
  return (
    <DashboardCard title="Recent webhook deliveries" className="lg:col-span-7" bodyClassName="p-0">
      {health.recent.length === 0 ? (
        <CardEmpty icon={Webhook} title="No events delivered yet." />
      ) : (
        <LedgerScroller>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="pl-4">Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead className="pr-4 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.recent.map((event) => {
                const style = DELIVERY_STATUS[event.status] ?? {
                  label: event.status,
                  className: "bg-muted text-muted-foreground",
                };
                return (
                  <TableRow key={event.id} className={LEDGER_ROW_HEIGHT}>
                    <TableCell className="pl-4 text-xs text-muted-foreground tabular-nums">
                      {DATETIME.format(event.at)}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs">{event.type}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Badge className={style.className}>{style.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </LedgerScroller>
      )}
    </DashboardCard>
  );
}

export function IntegrationsStatus({
  merchant,
  webhookUrl,
  keyKind,
  health,
  emailMode,
  emailConnected,
  trackingStatus,
  lastClickAt,
  verifiedAt,
}: {
  merchant: { slug: string; name: string; domain: string };
  webhookUrl: string;
  keyKind: StripeKeyKind;
  health: WebhookHealth;
  emailMode: DeliveryMode;
  emailConnected: boolean;
  trackingStatus: TrackingStatus;
  lastClickAt: Date | null;
  verifiedAt: Date | null;
}) {
  const base = `/dashboard/products/${merchant.slug}`;

  return (
    <PageShell>
      <PageHeader title="Integrations" subtitle={`${merchant.name} · ${merchant.domain}`} />

      <Band columns={2}>
        <StripeCard base={base} keyKind={keyKind} webhookUrl={webhookUrl} health={health} />
        <EmailCard base={base} domain={merchant.domain} mode={emailMode} connected={emailConnected} />
      </Band>

      <Band columns={12}>
        <TrackingCard
          base={base}
          status={trackingStatus}
          lastClickAt={lastClickAt}
          verifiedAt={verifiedAt}
        />
        <DeliveriesCard health={health} />
      </Band>
    </PageShell>
  );
}
