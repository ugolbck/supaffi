import Link from "next/link";
import { Button } from "@/components/ui/button";
import { detectDnsProvider } from "@/lib/checks/dns";
import { cloudflareDnsRecordsUrl } from "@/lib/dnsProviderLinks";
import { nextStep, stepPath } from "@/lib/onboarding";
import { StepFrame } from "../../StepFrame";
import { Light } from "../../Light";
import { AutoRefresh } from "../../AutoRefresh";
import { Copyable } from "../../Copyable";
import { SubdomainField } from "./SubdomainField";
import type { Ctx } from "../checks";

export async function Subdomain({ ctx }: { ctx: Ctx }) {
  const { merchant, checks } = ctx;
  const provider = await detectDnsProvider(merchant.domain);
  const hostIp = process.env.SUPAFFI_HOST_IP?.trim() ?? "";
  const name = merchant.domain.split(".")[0];
  const allGreen = checks.dns.resolves.ok && checks.dns.https.ok && checks.dns.certificate.ok;
  const next = nextStep("subdomain", ctx.emailRequired)!;

  return (
    <StepFrame
      index={2}
      total={ctx.total}
      title="Point a subdomain here"
      lede="Your affiliate program lives on its own address, on your domain."
    >
      <AutoRefresh active={!allGreen} />
      <SubdomainField product={{ id: merchant.id, slug: merchant.slug }} value={merchant.domain} />

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium">
            Add this record at {provider === "cloudflare" ? "Cloudflare" : "your DNS provider"}
          </p>
          {provider === "cloudflare" && <span className="text-xs text-muted-foreground">detected from your DNS</span>}
        </div>
        <div className="grid grid-cols-[64px_1fr] gap-y-2 rounded-xl border border-border/70 p-4 text-sm">
          <span className="text-muted-foreground">Type</span>
          <span className="font-mono">A</span>
          <span className="text-muted-foreground">Name</span>
          <Copyable value={name} />
          <span className="text-muted-foreground">Value</span>
          <Copyable value={hostIp} />
          <span className="text-muted-foreground">Proxy</span>
          <span>off. Grey cloud, this matters.</span>
        </div>
        {provider === "cloudflare" && (
          <Button
            variant="secondary"
            className="w-fit cursor-pointer"
            render={<a href={cloudflareDnsRecordsUrl()} target="_blank" rel="noreferrer" />}
          >
            Open Cloudflare
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border/70 p-4">
        <Light result={checks.dns.resolves} label="Resolves to this server" />
        <Light result={checks.dns.https} label="Answers over HTTPS" />
        <Light result={checks.dns.certificate} label="Certificate issued" />
      </div>

      <div className="flex items-center gap-4">
        <Button size="lg" className="cursor-pointer" render={<Link href={stepPath(merchant.slug, next)} />}>
          Continue
        </Button>
        {!allGreen && <span className="text-xs text-muted-foreground">Checks again every 15 seconds</span>}
      </div>
    </StepFrame>
  );
}
