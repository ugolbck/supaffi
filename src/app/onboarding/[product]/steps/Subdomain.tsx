import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckList, checkState, type CheckRow } from "@/components/onboarding/CheckList";
import { EditableField } from "@/components/onboarding/EditableField";
import { RecordTable } from "@/components/onboarding/RecordTable";
import { StepShell } from "@/components/onboarding/StepShell";
import { TaskCard, TaskCardHeader, TaskCardSection } from "@/components/onboarding/TaskCard";
import { detectDnsProvider } from "@/lib/checks/dns";
import { cloudflareDnsRecordsUrl } from "@/lib/dnsProviderLinks";
import { displayStep, dnsRecordName, nextStep, splitSubdomain, stepPath } from "@/lib/onboarding";
import { isLocalDomain } from "@/lib/url";
import { isDevInstance } from "@/lib/instanceMode";
import { AutoRefresh } from "../../AutoRefresh";
import { updateSubdomainAction } from "../actions";
import type { Ctx } from "../checks";

export async function Subdomain({ ctx }: { ctx: Ctx }) {
  const { merchant, checks } = ctx;
  const product = { id: merchant.id, slug: merchant.slug };
  const next = nextStep("subdomain", ctx.emailRequired)!;
  const split = splitSubdomain(merchant.domain, merchant.websiteUrl);
  // Nothing outside can reach a machine on someone's desk, so neither the
  // record nor the checks can ever come good there. That is true whether the
  // product carries a real domain or a local one: what decides is the
  // instance, not the address typed into the product.
  const local = isDevInstance() || isLocalDomain(merchant.domain);

  const field = (
    <EditableField
      value={split ? split.prefix : merchant.domain}
      suffix={split?.suffix}
      action={updateSubdomainAction.bind(null, product)}
      label="Subdomain"
      bare
    />
  );

  if (local) {
    return (
      <StepShell
        step={displayStep("subdomain", ctx.emailRequired)}
        title="Point a subdomain here"
        lede="Your affiliate program lives on its own address, on your domain."
        action={
          <Button size="lg" render={<Link href={stepPath(merchant.slug, next)} />}>
            Continue
          </Button>
        }
      >
        <TaskCard>
          <TaskCardSection>{field}</TaskCardSection>
        </TaskCard>
      </StepShell>
    );
  }

  const provider = await detectDnsProvider(merchant.domain);
  const hostIp = process.env.SUPAFFI_HOST_IP?.trim() || null;
  const rows: CheckRow[] = [
    {
      id: "dns",
      state: checkState(checks.dns.resolves, (detail) => detail.startsWith("No record")),
      pending: "Waiting for your DNS to update",
      passed: "Your subdomain points here",
      failed: checks.dns.resolves.detail,
      hint: "Check the name and the address on the record above.",
    },
    {
      id: "cert",
      state:
        checks.dns.https.ok && checks.dns.certificate.ok
          ? "ok"
          : checks.dns.https.ok
            ? "pending"
            : checkState(checks.dns.https, (detail) => detail.startsWith("No record")),
      pending: "Securing it with HTTPS",
      passed: "Secured with HTTPS",
      failed: checks.dns.https.detail,
      hint: "Make sure your site answers over https, then check again.",
    },
  ];
  const settled = rows.every((r) => r.state === "ok");

  return (
    <StepShell
      step={displayStep("subdomain", ctx.emailRequired)}
      title="Point a subdomain here"
      lede="Your affiliate program lives on its own address, on your domain."
      action={
        <Button size="lg" render={<Link href={stepPath(merchant.slug, next)} />}>
          Continue
        </Button>
      }
    >
      <AutoRefresh active={!settled} />
      <TaskCard>
        <TaskCardSection>{field}</TaskCardSection>
        <TaskCardHeader
          title={provider === "cloudflare" ? "Add this record at Cloudflare" : "Add this record at your DNS provider"}
          action={
            provider === "cloudflare" ? (
              <Button
                variant="secondary"
                size="sm"
                render={<a href={cloudflareDnsRecordsUrl()} target="_blank" rel="noreferrer" />}
              >
                <Image src="/logos/cloudflare-icon.svg" alt="" width={16} height={16} className="mr-1 size-4" />
                Open Cloudflare
              </Button>
            ) : undefined
          }
        />
        <TaskCardSection>
          <RecordTable
            records={[
              { label: "Type", value: "A", badge: true, copyable: false },
              { label: "Name", value: split ? split.prefix : merchant.domain },
              { label: "Value", value: hostIp, missing: "This server's address is not set yet" },
              { label: "Proxy", value: "Off", copyable: false },
            ]}
          />
        </TaskCardSection>
        <TaskCardSection sunken>
          <CheckList rows={rows} />
        </TaskCardSection>
      </TaskCard>
    </StepShell>
  );
}
