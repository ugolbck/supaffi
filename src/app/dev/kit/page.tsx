"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckList, type CheckRow } from "@/components/onboarding/CheckList";
import { CodeBlock, CopyField } from "@/components/onboarding/CodeBlock";
import {
  EditableField,
  type EditableResult,
} from "@/components/onboarding/EditableField";
import { PasteField } from "@/components/PasteField";
import { RecordTable } from "@/components/onboarding/RecordTable";
import { StepShell, StepLabel } from "@/components/onboarding/StepShell";
import {
  TaskCard,
  TaskCardHeader,
  TaskCardSection,
} from "@/components/onboarding/TaskCard";
import { FinishedModal } from "@/components/onboarding/FinishedModal";
import {
  CommissionTable,
  type LedgerRow,
} from "@/app/dashboard/products/[product]/commissions/CommissionTable";
import { CommissionFilters } from "@/app/dashboard/products/[product]/commissions/CommissionFilters";
import {
  CommissionSheet,
  type SheetCommission,
} from "@/app/dashboard/products/[product]/commissions/CommissionSheet";
import {
  AffiliateTable,
  type AffiliateRowView,
} from "@/app/dashboard/products/[product]/affiliates/AffiliateTable";
import { Suspense } from "react";
import { SignupScreen } from "@/app/affiliates/signup/[program]/SignupScreen";
import type { SignupFormAction } from "@/app/affiliates/signup/[program]/SignupForm";
import { emailShell } from "@/components/email/shell";
import { ProgramCard } from "@/components/dashboard/ProgramCard";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { OverviewScreen } from "@/app/affiliates/dashboard/OverviewCards";
import { LinksScreen } from "@/app/affiliates/dashboard/links/LinksScreen";
import { LinkDialog } from "@/app/affiliates/dashboard/links/LinkDialog";
import { PayoutsScreen } from "@/app/affiliates/dashboard/payouts/PayoutsScreen";
import {
  CommissionLedger,
  type LedgerRow as AffiliateLedgerRow,
} from "@/app/affiliates/dashboard/commissions/CommissionLedger";
import { AffiliateSidebar } from "@/app/affiliates/dashboard/AffiliateSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SCRIPT = `<script src="https://affiliates.instantgradient.com/track.js" async></script>`;
const CHECKOUT = `const referralToken = cookies.get("supaffi_ref");

await stripe.checkout.sessions.create({
  metadata: {
    ...(referralToken && { supaffi_ref: referralToken }),
  },
});`;

// The site is on a subdomain of its own (dev.mokkit.co), so the zone is
// mokkit.co and the record Cloudflare wants is affiliates.dev, not affiliates.
// dnsRecordName("affiliates.dev.mokkit.co") is "affiliates.dev"; not imported
// here because it pulls in the dns module, which cannot be bundled for a
// client component like this one.
const RECORDS = [
  { label: "Type", value: "A", badge: true, copyable: false },
  { label: "Name", value: "affiliates.dev" },
  { label: "Value", value: "146.59.195.140" },
  { label: "Proxy", value: "Off", copyable: false },
];

const DNS_PENDING: CheckRow[] = [
  {
    id: "dns",
    state: "pending",
    pending: "Waiting for your DNS to update",
    passed: "Your subdomain points here",
  },
  {
    id: "cert",
    state: "pending",
    pending: "Securing it with HTTPS",
    passed: "Secured with HTTPS",
  },
];

const ROOT_DOMAIN = ".instantgradient.com";

// Stands in for `recheckAction`, which needs a real product and a real
// request. There is nothing to revalidate in the kit, so this just proves
// the row is wired to something.
async function mockRecheck() {
  await new Promise((r) => setTimeout(r, 400));
}

async function mockPasteAction(
  _prev: { error: string },
  _formData: FormData,
): Promise<{ error: string }> {
  await new Promise((r) => setTimeout(r, 400));
  return { error: "" };
}

function useMockSave(initial: string) {
  const [value, setValue] = useState(initial);
  async function save(
    _prev: EditableResult,
    formData: FormData,
  ): Promise<EditableResult> {
    await new Promise((r) => setTimeout(r, 600));
    const next = String(formData.get("value") ?? "").trim();
    if (!/^[a-z0-9-]+$/i.test(next))
      return { error: "Letters, numbers and dashes only." };
    setValue(next);
    return { error: "", savedAt: Date.now() };
  }
  return [value, save] as const;
}

export default function Kit() {
  // ?only=<frame> renders a single frame. Read after mount: reading it during
  // render would not match the server's render.
  const [only, setOnly] = useState<string | null>(null);
  useEffect(
    () => setOnly(new URLSearchParams(window.location.search).get("only")),
    [],
  );
  const show = (key: string) => only === null || only === key;

  return (
    <main className="min-h-dvh bg-background px-10 py-12">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-16">
        <Frame label="Subdomain, provider detected" show={show("subdomain")}>
          <SubdomainScreen provider="cloudflare" />
        </Frame>
        <Frame
          label="Subdomain, provider not detected"
          show={show("subdomain-generic")}
        >
          <SubdomainScreen provider={null} />
        </Frame>
        <Frame label="Tracking" show={show("tracking")}>
          <TrackingScreen />
        </Frame>
        <Frame label="Email key" show={show("b-email-key")}>
          <EmailKeyScreen />
        </Frame>
        <Frame label="Check list, the three states" show={show("checks")}>
          <div className="max-w-[640px]">
            <TaskCard>
              <TaskCardSection sunken>
                <CheckList
                  rows={[
                    {
                      id: "a",
                      state: "ok",
                      pending: "",
                      passed: "Your subdomain points here",
                    },
                    {
                      id: "b",
                      state: "pending",
                      pending: "Securing it with HTTPS",
                      passed: "Secured with HTTPS",
                    },
                    {
                      id: "c",
                      state: "failed",
                      pending: "Looking for the script",
                      passed: "Script is live",
                      failed: "Your subdomain points somewhere else",
                      hint: "It points to 12.34.56.78, not to this server.",
                    },
                  ]}
                />
              </TaskCardSection>
            </TaskCard>
          </div>
        </Frame>
        <Frame label="Check list, live transition" show={show("live")}>
          <LiveCheckDemo />
        </Frame>
        <Frame
          label="Check list, checking, with check now"
          show={show("b-check-now")}
        >
          <div className="max-w-[640px]">
            <TaskCard>
              <TaskCardSection sunken>
                <CheckList
                  rows={[
                    {
                      id: "a",
                      state: "ok",
                      pending: "",
                      passed: "Your subdomain points here",
                    },
                    {
                      id: "b",
                      state: "pending",
                      pending: "Securing it with HTTPS",
                      passed: "Secured with HTTPS",
                    },
                  ]}
                  onRecheck={mockRecheck}
                />
              </TaskCardSection>
            </TaskCard>
          </div>
        </Frame>
        <Frame label="Code block" show={show("code")}>
          <div className="flex max-w-[640px] flex-col gap-4">
            <CodeBlock
              title="Tracking script"
              code={SCRIPT}
              prompt={aiPrompt(SCRIPT)}
            />
            <CodeBlock
              title="Checkout session"
              code={CHECKOUT}
              prompt={aiPrompt(CHECKOUT)}
            />
          </div>
        </Frame>
        <Frame label="Copy field and editable field" show={show("fields")}>
          <div className="flex max-w-[640px] flex-col gap-4">
            <CopyField value="https://affiliates.instantgradient.com/api/webhooks/stripe" />
            <FieldsDemo />
          </div>
        </Frame>
        <Frame label="Onboarding finished" show={show("finished")}>
          <FinishedModal
            link="https://ref.instantgradient.com/affiliates/signup/standard"
            dashboardHref="#"
          />
        </Frame>

        <Frame label="Commission table" show={show("d-commission-table")}>
          <DCommissionTable />
        </Frame>
        <Frame label="Commission sheet" show={only === "d-commission-sheet"}>
          <DCommissionSheetDemo which="flagged" />
        </Frame>
        <Frame
          label="Commission sheet, flagged, card match"
          show={only === "d-commission-sheet-flagged-card"}
        >
          <DCommissionSheetDemo which="flagged-card" />
        </Frame>
        <Frame
          label="Commission sheet, voided"
          show={only === "d-commission-sheet-voided"}
        >
          <DCommissionSheetDemo which="voided" />
        </Frame>
        <Frame
          label="Commission sheet, reduced"
          show={only === "d-commission-sheet-reduced"}
        >
          <DCommissionSheetDemo which="reduced" />
        </Frame>
        <Frame label="Affiliate table" show={show("d-affiliate-table")}>
          <DAffiliateTable />
        </Frame>

        <Frame label="Buttons" show={show("buttons")}>
          <div className="flex items-center gap-3">
            <Button size="lg">Continue</Button>
            <Button variant="secondary">Open Cloudflare</Button>
            <Button variant="ghost">Cancel</Button>
            <Button size="sm">Save</Button>
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </div>
        </Frame>

        <Frame label="Affiliate signup" show={show("c-signup")}>
          <CSignupScreen />
        </Frame>
        <Frame label="Affiliate magic link email" show={show("c-email")}>
          <CEmailPreview />
        </Frame>

        <Frame label="Affiliate overview" show={show("e-overview")}>
          <EViewport>
            <EOverview />
          </EViewport>
        </Frame>
        <Frame label="Affiliate overview, one-time program" show={show("e-overview-one-time")}>
          <EViewport>
            <EOverview recurring={false} />
          </EViewport>
        </Frame>
        <Frame label="Affiliate ledger" show={show("e-ledger")}>
          <EViewport>
            <ELedger />
          </EViewport>
        </Frame>
        <Frame label="Affiliate links" show={show("e-links")}>
          <EViewport>
            <ELinks />
          </EViewport>
        </Frame>
        <Frame label="Affiliate payouts" show={show("e-payouts")}>
          <EViewport>
            <EPayouts />
          </EViewport>
        </Frame>
        <Frame
          label="Affiliate payouts, nothing on file"
          show={show("e-payouts-empty")}
        >
          <EViewport>
            <EPayouts empty />
          </EViewport>
        </Frame>
        <Frame label="Affiliate new link dialog" show={only === "e-link-dialog"}>
          <ELinkDialog />
        </Frame>
        <Frame label="Affiliate shell" show={show("e-shell")}>
          <EShell />
        </Frame>
        <Frame
          label="Programs, signup link warning"
          show={show("b-program-warning")}
        >
          <BProgramWarning />
        </Frame>
        <Frame
          label="Check list, three states, with check now"
          show={show("b-check-states")}
        >
          <BCheckStates />
        </Frame>
        <Frame
          label="Sending domain, before the key exists"
          show={show("b-email-domain-first")}
        >
          <BEmailDomainFirst />
        </Frame>
      </div>
    </main>
  );
}

// The three states on one list, with the affordance that says the page is
// already looking. Strings are the ones the check modules really produce.
function BCheckStates() {
  return (
    <div className="max-w-[640px]">
      <TaskCard>
        <TaskCardSection sunken>
          <CheckList
            rows={[
              {
                id: "dns",
                state: "ok",
                pending: "Waiting for your DNS to update",
                passed: "Your subdomain points here",
              },
              {
                id: "cert",
                state: "pending",
                pending: "Securing it with HTTPS",
                passed: "Secured with HTTPS",
              },
              {
                id: "script",
                state: "failed",
                pending: "Looking for the script on instantgradient.com",
                passed: "Script is live on instantgradient.com",
                failed: "Could not load the site",
                hint: "Paste the script above into the page, then check again.",
              },
            ]}
            onRecheck={mockRecheck}
          />
        </TaskCardSection>
      </TaskCard>
    </div>
  );
}

// The first email screen, before a Resend key exists. The check cannot run at
// all without one, so the row waits instead of opening on a red cross.
function BEmailDomainFirst() {
  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <TaskCard>
        <TaskCardHeader title="Add the domain in Resend" />
        <TaskCardSection sunken>
          <CheckList
            rows={[
              {
                id: "domain",
                state: "pending",
                pending: "Confirmed once you add your key",
                passed: "Resend can send from affiliates.instantgradient.com",
              },
            ]}
          />
        </TaskCardSection>
      </TaskCard>
      <TaskCard>
        <TaskCardHeader title="Add the domain in Resend" />
        <TaskCardSection sunken>
          <CheckList
            rows={[
              {
                id: "domain",
                state: "pending",
                pending:
                  "Waiting for Resend to verify affiliates.instantgradient.com",
                passed: "Resend can send from affiliates.instantgradient.com",
              },
            ]}
            onRecheck={mockRecheck}
          />
        </TaskCardSection>
      </TaskCard>
    </div>
  );
}

function aiPrompt(code: string): string {
  return `Add this to my site:\n\n${code}`;
}

function FieldsDemo() {
  const [subdomain, saveSubdomain] = useMockSave("affiliates");
  return (
    <EditableField
      value={subdomain}
      suffix={ROOT_DOMAIN}
      action={saveSubdomain}
      label="Subdomain"
    />
  );
}

function Variant({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      <p className="text-[13px] font-semibold text-neutral-700">{name}</p>
      {children}
    </div>
  );
}

function Frame({
  label,
  show = true,
  children,
}: {
  label: string;
  show?: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section className="flex flex-col gap-4">
      <p className="text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </p>
      <div className="rounded-(--radius-lg) border border-dashed border-neutral-300 bg-card p-10">
        {children}
      </div>
    </section>
  );
}

function SubdomainScreen({ provider }: { provider: "cloudflare" | null }) {
  const [subdomain, saveSubdomain] = useMockSave("affiliates");
  return (
    <StepShell
      step={{ index: 4, total: 11 }}
      title="Point a subdomain here"
      lede="Your affiliate program lives on its own address, on your domain."
      action={<Button size="lg">Continue</Button>}
    >
      <TaskCard>
        <TaskCardSection>
          <EditableField
            value={subdomain}
            suffix={ROOT_DOMAIN}
            action={saveSubdomain}
            label="Subdomain"
            bare
          />
        </TaskCardSection>
        <TaskCardHeader
          title={
            provider === "cloudflare"
              ? "Add this record at Cloudflare"
              : "Add this record at your DNS provider"
          }
          action={
            provider === "cloudflare" ? (
              <Button variant="secondary" size="sm">
                <Image
                  src="/logos/cloudflare-icon.svg"
                  alt=""
                  width={16}
                  height={16}
                  className="size-4 mr-1"
                />
                Open Cloudflare
              </Button>
            ) : undefined
          }
        />
        <TaskCardSection>
          <RecordTable records={RECORDS} />
        </TaskCardSection>
        <TaskCardSection sunken>
          <CheckList rows={DNS_PENDING} />
        </TaskCardSection>
      </TaskCard>
    </StepShell>
  );
}

function EmailKeyScreen() {
  return (
    <StepShell
      step={{ index: 6, total: 11 }}
      title="Let Supaffi email your affiliates"
      lede="Affiliates log in with a link sent to their inbox."
    >
      <TaskCard>
        <TaskCardHeader
          title="Create a key in Resend"
          hint="Full access, on all domains"
          action={
            <Button variant="secondary" size="sm">
              <Image
                src="/logos/resend.svg"
                alt=""
                width={16}
                height={16}
                className="size-4"
              />
              Open Resend
            </Button>
          }
        />
      </TaskCard>
      <PasteField
        label="Paste the key here"
        placeholder="re_..."
        action={mockPasteAction}
      />
    </StepShell>
  );
}

function TrackingScreen() {
  return (
    <StepShell
      step={{ index: 9, total: 11 }}
      title="Put the tracking script on your site"
      lede="Paste this in the head of every page an affiliate link can land on."
      action={<Button size="lg">Continue</Button>}
    >
      <CodeBlock
        title="Tracking script"
        code={SCRIPT}
        prompt={aiPrompt(SCRIPT)}
      />
      <StepLabel>
        Then, wherever you create the Stripe checkout session.
      </StepLabel>
      <CodeBlock
        title="Checkout session"
        code={CHECKOUT}
        prompt={aiPrompt(CHECKOUT)}
      />
      <TaskCard>
        <TaskCardSection sunken>
          <CheckList
            rows={[
              {
                id: "s",
                state: "pending",
                pending: "Looking for the script on instantgradient.com",
                passed: "Script is live on instantgradient.com",
              },
            ]}
          />
        </TaskCardSection>
      </TaskCard>
    </StepShell>
  );
}

function LiveCheckDemo() {
  const [rows, setRows] = useState<CheckRow[]>(DNS_PENDING);
  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <TaskCard>
        <TaskCardSection sunken>
          <CheckList rows={rows} />
        </TaskCardSection>
      </TaskCard>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => setRows((r) => r.map((x) => ({ ...x, state: "ok" })))}
        >
          Pass them
        </Button>
        <Button variant="ghost" onClick={() => setRows(DNS_PENDING)}>
          Reset
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ track D */

const D_LEDGER: LedgerRow[] = [
  {
    id: "c1",
    amount: "1,240.00 EUR",
    status: "PAYABLE",
    affiliateName: "Marguerite Vandenbroucke-Delacroix",
    affiliateEmail: "marguerite@vandenbroucke-delacroix.example",
    isAdjustment: false,
    createdLabel: "10 Sept 2026",
    stateLabel: "Ready to pay",
    reference: "pi_3QxLmN2eZvKYlo2C",
    href: "#",
  },
  {
    id: "c2",
    amount: "84.50 USD",
    status: "PENDING",
    affiliateName: "Ines Okonkwo",
    affiliateEmail: "ines@okonkwo.example",
    isAdjustment: false,
    createdLabel: "9 Sept 2026",
    stateLabel: "Payable 9 Oct 2026",
    reference: "in_1PqRsT4uVwXyZa",
    href: "#",
  },
  {
    id: "c3",
    amount: "96.00 EUR",
    status: "PENDING",
    affiliateName: "Tobias Lindqvist",
    affiliateEmail: "tobias@lindqvist.example",
    isAdjustment: false,
    createdLabel: "8 Sept 2026",
    stateLabel: "Reduced, part of the sale was refunded",
    reference: "pi_3QwKlM1dYuJXkn1B",
    href: "#",
  },
  {
    id: "c4",
    amount: "310.00 GBP",
    status: "FLAGGED",
    affiliateName: null,
    affiliateEmail: "sarah@northwind.example",
    isAdjustment: false,
    createdLabel: "7 Sept 2026",
    stateLabel: "The buyer used the affiliate's own email address",
    reference: "pi_3QvJkL0cXtIWjm0A",
    href: "#",
  },
  {
    id: "c5",
    amount: "62.00 USD",
    status: "PAID",
    affiliateName: "Ines Okonkwo",
    affiliateEmail: "ines@okonkwo.example",
    isAdjustment: false,
    createdLabel: "2 Sept 2026",
    stateLabel: "Paid 5 Sept 2026",
    reference: "in_1PoNmL3sTuVwXy",
    href: "#",
  },
  {
    id: "c6",
    amount: "148.00 EUR",
    status: "VOIDED",
    affiliateName: "Marguerite Vandenbroucke-Delacroix",
    affiliateEmail: "marguerite@vandenbroucke-delacroix.example",
    isAdjustment: false,
    createdLabel: "28 Aug 2026",
    stateLabel: "Refunded in Stripe · 1 Sept 2026",
    reference: "pi_3QtHiJ9bWsHVil9Z",
    href: "#",
  },
  {
    id: "c7",
    amount: "-62.00 USD",
    status: "PAYABLE",
    affiliateName: "Ines Okonkwo",
    affiliateEmail: "ines@okonkwo.example",
    isAdjustment: true,
    createdLabel: "26 Aug 2026",
    stateLabel: "Refund adjustment, carries forward",
    reference: null,
    href: "#",
  },
];

function DCommissionTable() {
  return (
    <div className="flex flex-col rounded-(--radius-md) border border-black/[0.08] bg-elevated">
      <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-3">
        <Suspense>
          <CommissionFilters
            affiliates={[
              { id: "a1", name: "Ines Okonkwo", email: "ines@okonkwo.example" },
              { id: "a2", name: null, email: "sarah@northwind.example" },
            ]}
            currencies={["eur", "usd", "gbp"]}
            affiliateId={null}
            currency={null}
            query=""
            anyFilterActive={false}
          />
        </Suspense>
      </div>
      <CommissionTable rows={D_LEDGER} selectedId="c4" filtered={false} />
    </div>
  );
}

const D_SHEETS: Record<string, SheetCommission> = {
  flagged: {
    id: "c4",
    status: "FLAGGED",
    amount: "310.00 GBP",
    grossAmount: null,
    affiliate: "sarah@nw.example",
    affiliateEmail: "sarah@nw.example",
    createdLabel: "7 Sept 2026",
    payableLabel: "7 Oct 2026",
    voidedLabel: null,
    voidReason: null,
    // One long value and one short one: the pair must read in full either way.
    flagReason:
      "email:sarah.mackenzie+northwind-partners@northwind-consulting.example sarah@nw.example",
    stateLabel: "The buyer used the affiliate's own email address",
    clickLabel: "7 Sept 2026",
    linkLabel: "sarah · /pricing",
    reference: {
      text: "pi_3QvJkL0cXtIWjm0A",
      href: "https://dashboard.stripe.com",
    },
  },
  "flagged-card": {
    id: "c8",
    status: "FLAGGED",
    amount: "58.00 USD",
    grossAmount: null,
    affiliate: "Ines Okonkwo",
    affiliateEmail: "ines@okonkwo.example",
    createdLabel: "6 Sept 2026",
    payableLabel: "6 Oct 2026",
    voidedLabel: null,
    voidReason: null,
    flagReason: "card",
    stateLabel: "The buyer paid with a card the affiliate has used",
    clickLabel: "6 Sept 2026",
    linkLabel: "ines · /pricing",
    reference: {
      text: "pi_3QyMnO5fAzMYpr3D",
      href: "https://dashboard.stripe.com",
    },
  },
  voided: {
    id: "c6",
    status: "VOIDED",
    amount: "148.00 EUR",
    grossAmount: null,
    affiliate: "Marguerite Vandenbroucke-Delacroix",
    affiliateEmail: "marguerite@vandenbroucke-delacroix.example",
    createdLabel: "28 Aug 2026",
    payableLabel: "27 Sept 2026",
    voidedLabel: "1 Sept 2026",
    voidReason: "refund",
    flagReason: null,
    stateLabel: "Refunded in Stripe · 1 Sept 2026",
    clickLabel: "26 Aug 2026",
    linkLabel: "margue · /",
    reference: {
      text: "pi_3QtHiJ9bWsHVil9Z",
      href: "https://dashboard.stripe.com",
    },
  },
  reduced: {
    id: "c3",
    status: "PENDING",
    amount: "96.00 EUR",
    grossAmount: "120.00 EUR",
    affiliate: "Tobias Lindqvist",
    affiliateEmail: "tobias@lindqvist.example",
    createdLabel: "8 Sept 2026",
    payableLabel: "8 Oct 2026",
    voidedLabel: null,
    voidReason: "partial refund",
    flagReason: null,
    stateLabel: "Reduced, part of the sale was refunded",
    clickLabel: "6 Sept 2026",
    linkLabel: "tobias · /pricing",
    reference: { text: "pi_3QwKlM1dYuJXkn1B", href: null },
  },
};

function DCommissionSheetDemo({ which }: { which: keyof typeof D_SHEETS }) {
  return (
    <>
      <DCommissionTable />
      <CommissionSheet
        commission={D_SHEETS[which]}
        product={{ id: "m1", slug: "instantgradient" }}
        listHref="#"
      />
    </>
  );
}

// retention is precomputed text (Task D3: referralCounts, batched, plus
// whether the row's program even pays out more than once), passed in as a
// prop like every other column rather than read by the table itself, an
// async, database-reading AffiliateTable cannot be previewed here, since
// this whole page is a client component and Prisma cannot run in a browser.
const D_AFFILIATES: AffiliateRowView[] = [
  {
    id: "a1",
    name: "Marguerite Vandenbroucke-Delacroix",
    email: "marguerite@vandenbroucke-delacroix.example",
    referralCode: "marguerite",
    programName: "Standard",
    clicks: 1284,
    conversions: 41,
    earned: "3,120.00 EUR",
    earnedHint: "410.00 USD",
    rate: "25%",
    rateIsOverride: true,
    retention: "31 of 41 still paying",
    joined: "3 Mar 2026",
    href: "#",
  },
  {
    id: "a2",
    name: "Ines Okonkwo",
    email: "ines@okonkwo.example",
    referralCode: "ines",
    programName: "Standard",
    clicks: 312,
    conversions: 11,
    earned: "840.00 USD",
    earnedHint: null,
    rate: "20%",
    rateIsOverride: false,
    retention: "11 of 11 still paying",
    joined: "18 Apr 2026",
    href: "#",
  },
  {
    id: "a3",
    name: null,
    email: "sarah@northwind.example",
    referralCode: "northwind",
    programName: "VIP",
    clicks: 96,
    conversions: 3,
    earned: "310.00 GBP",
    earnedHint: null,
    rate: "30%",
    rateIsOverride: false,
    // A recurring program too, but nobody has converted yet: nothing to
    // report on, not a false "0 of 0 still paying".
    retention: null,
    joined: "1 Aug 2026",
    href: "#",
  },
  {
    id: "a4",
    name: "Kaito Nakamura-Thibodeaux",
    email: "kaito@nakamura-thibodeaux.example",
    referralCode: "kaito",
    programName: "One time",
    clicks: 58,
    conversions: 6,
    earned: "870.00 EUR",
    earnedHint: null,
    rate: "50%",
    rateIsOverride: false,
    // A one-time program has no recurring commission to churn out of.
    retention: null,
    joined: "22 Jun 2026",
    href: "#",
  },
];

function DAffiliateTable() {
  return (
    <div className="flex flex-col rounded-(--radius-md) border border-black/[0.08] bg-elevated">
      <AffiliateTable
        rows={D_AFFILIATES}
        selectedId={null}
        filtered={false}
        emptyAction={null}
      />
    </div>
  );
}

// The dev kit has no server to submit to, so this just satisfies the type
// the form action carries; it is never invoked from a screenshot.
const cSignupAction: SignupFormAction = async () => ({
  status: "form",
  error: "",
});

function CSignupScreen() {
  return (
    <div className="mx-auto w-full max-w-[900px] rounded-(--radius-lg) bg-background p-8">
      <SignupScreen
        merchantName="Mokkit"
        terms={{
          rate: 20,
          attributionWindowDays: 60,
          durationType: "FOREVER",
          durationMonths: null,
        }}
        linkHost="dev.mokkit.co"
        action={cSignupAction}
      />
    </div>
  );
}

function CEmailPreview() {
  const html = emailShell({
    merchantName: "Mokkit",
    heading: "Log in to your affiliate account",
    body: "This link expires in 15 minutes and can only be used once.",
    action: {
      label: "Log in",
      href: "https://affiliates.mokkit.co/affiliates/verify?token=preview",
    },
  });
  return (
    <iframe
      srcDoc={html}
      title="Affiliate magic link email preview"
      className="h-[420px] w-full max-w-[600px] rounded-(--radius-md) border border-neutral-300 bg-white"
    />
  );
}

// ---------------------------------------------------------------------------
// Track E: the affiliate dashboard. Every screen is a presentational component
// that takes the whole screen as props, so it can be read here without a
// database behind it.

/** The content area of the affiliate shell: same padding, same height rule. */
function EViewport({ children }: { children: React.ReactNode }) {
  return (
    // -m-10 escapes the Frame's own padding, so a phone-width screenshot is
    // close to the width the affiliate actually gets.
    <div className="-m-10 w-[calc(100%+5rem)] overflow-hidden rounded-(--radius-md) bg-background p-8 md:h-[760px]">
      {children}
    </div>
  );
}

const E_SERIES = Array.from({ length: 30 }, (_, i) => {
  const clicks = [
    4, 9, 2, 0, 7, 14, 22, 11, 6, 3, 8, 19, 27, 31, 12, 5, 9, 16, 24, 38, 21,
    13, 7, 4, 11, 18, 29, 42, 26, 17,
  ][i];
  const conversions = [
    0, 1, 0, 0, 1, 2, 3, 1, 0, 0, 1, 2, 4, 3, 1, 0, 1, 2, 3, 5, 2, 1, 0, 0, 1,
    2, 4, 6, 3, 2,
  ][i];
  const at = new Date(Date.UTC(2026, 7, 12 + i));
  return {
    date: at.toISOString().slice(0, 10),
    clicks,
    conversions,
    revenue: conversions * 120,
    signups: 0,
  };
});

const E_LINKS = [
  {
    id: "l1",
    code: "sarah",
    destinationPath: null,
    isPrimary: true,
    clicks: 312,
    conversions: 8,
    earned: [
      { currency: "usd", total: "180.00" },
      { currency: "eur", total: "60.00" },
    ],
  },
  {
    id: "l2",
    code: "sarah-pricing-comparison-2026",
    destinationPath: "/pricing",
    isPrimary: false,
    clicks: 119,
    conversions: 4,
    earned: [{ currency: "usd", total: "60.00" }],
  },
  {
    id: "l3",
    code: "newsletter",
    destinationPath: "/blog/how-we-build",
    isPrimary: false,
    clicks: 27,
    conversions: 0,
    earned: [],
  },
];

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

const E_RECENT = [
  {
    id: "e1",
    amount: "8.70",
    currency: "usd",
    status: "PAYABLE" as const,
    createdAt: day("2026-09-02"),
    payableAt: day("2026-09-02"),
    paidAt: null,
    linkCode: "sarah",
    isAdjustment: false,
    grossAmount: null,
    voidReason: null,
    voidedAt: null,
  },
  {
    id: "e2",
    amount: "12.00",
    currency: "usd",
    status: "PENDING" as const,
    createdAt: day("2026-09-01"),
    payableAt: day("2026-10-01"),
    paidAt: null,
    linkCode: "sarah-pricing-comparison-2026",
    isAdjustment: false,
    grossAmount: "20.00",
    voidReason: "partial refund",
    voidedAt: null,
  },
  {
    id: "e3",
    amount: "24.00",
    currency: "eur",
    status: "PAID" as const,
    createdAt: day("2026-08-14"),
    payableAt: day("2026-08-14"),
    paidAt: day("2026-08-28"),
    linkCode: "sarah",
    isAdjustment: false,
    grossAmount: null,
    voidReason: null,
    voidedAt: null,
  },
  {
    id: "e4",
    amount: "31.50",
    currency: "usd",
    status: "VOIDED" as const,
    createdAt: day("2026-08-11"),
    payableAt: day("2026-09-10"),
    paidAt: null,
    linkCode: "newsletter",
    isAdjustment: false,
    grossAmount: null,
    voidReason: "refund",
    voidedAt: day("2026-08-19"),
  },
];

function EOverview({ recurring = true }: { recurring?: boolean }) {
  return (
    <OverviewScreen
      referralUrl="https://instantgradient.com/?via=sarah"
      recent={E_RECENT}
      series={E_SERIES}
      earned={[
        { currency: "usd", total: "1220.00" },
        { currency: "eur", total: "60.00" },
      ]}
      pending={[{ currency: "usd", total: "72.00" }]}
      payable={[{ currency: "usd", total: "180.00" }]}
      paid={[{ currency: "usd", total: "980.00" }]}
      referrals={{ total: 41, active: 31 }}
      recurring={recurring}
    />
  );
}

function ELinks() {
  return (
    <LinksScreen links={E_LINKS} websiteUrl="https://instantgradient.com" />
  );
}

function EPayouts({ empty = false }: { empty?: boolean }) {
  return (
    <PayoutsScreen
      merchantName="InstantGradient"
      payoutDetails={
        empty
          ? null
          : "PayPal: sarah@northwind.example\nIBAN: GB29 NWBK 6016 1331 9268 19"
      }
      payments={
        empty
          ? []
          : [
              {
                paidAt: day("2026-08-28"),
                count: 6,
                totals: [
                  { currency: "usd", total: "420.00" },
                  { currency: "eur", total: "60.00" },
                ],
              },
              {
                paidAt: day("2026-07-30"),
                count: 3,
                totals: [{ currency: "usd", total: "180.00" }],
              },
            ]
      }
      pending={[{ currency: "usd", total: "72.00" }]}
      payable={[{ currency: "usd", total: "180.00" }]}
      paid={[{ currency: "usd", total: "980.00" }]}
    />
  );
}

const E_LEDGER: AffiliateLedgerRow[] = [
  {
    id: "e1",
    dateLabel: "2 Sept 2026",
    amount: "8.70 USD",
    grossAmount: null,
    status: "PAYABLE",
    linkCode: "sarah",
    isAdjustment: false,
    stateLabel: "Ready to pay",
    voidReason: null,
    voidedLabel: null,
  },
  {
    id: "e2",
    dateLabel: "1 Sept 2026",
    amount: "12.00 USD",
    grossAmount: "20.00 USD",
    status: "PENDING",
    linkCode: "sarah-pricing-comparison-2026",
    isAdjustment: false,
    stateLabel: "Clears 1 Oct 2026",
    voidReason: "partial refund",
    voidedLabel: null,
  },
  {
    id: "e3",
    dateLabel: "28 Aug 2026",
    amount: "96.00 EUR",
    grossAmount: null,
    status: "PENDING",
    linkCode: "sarah",
    isAdjustment: false,
    stateLabel: "Clears 27 Sept 2026",
    voidReason: null,
    voidedLabel: null,
  },
  {
    id: "e4",
    dateLabel: "14 Aug 2026",
    amount: "24.00 EUR",
    grossAmount: null,
    status: "PAID",
    linkCode: "sarah",
    isAdjustment: false,
    stateLabel: "Paid 28 Aug 2026",
    voidReason: null,
    voidedLabel: null,
  },
  {
    id: "e5",
    dateLabel: "11 Aug 2026",
    amount: "31.50 USD",
    grossAmount: null,
    status: "VOIDED",
    linkCode: "newsletter",
    isAdjustment: false,
    stateLabel: "Voided",
    voidReason: "refund",
    voidedLabel: "19 Aug 2026",
  },
  {
    id: "e6",
    dateLabel: "9 Aug 2026",
    amount: "-18.00 USD",
    grossAmount: null,
    status: "PAYABLE",
    linkCode: null,
    isAdjustment: true,
    stateLabel: "Comes off your next payout",
    voidReason: null,
    voidedLabel: null,
  },
  {
    id: "e7",
    dateLabel: "4 Aug 2026",
    amount: "140.00 USD",
    grossAmount: null,
    status: "VOIDED",
    linkCode: "sarah",
    isAdjustment: false,
    stateLabel: "Voided",
    voidReason: "confirmed self-referral",
    voidedLabel: "6 Aug 2026",
  },
  {
    id: "e8",
    dateLabel: "1 Aug 2026",
    amount: "42.00 USD",
    grossAmount: null,
    status: "VOIDED",
    linkCode: "sarah",
    isAdjustment: false,
    stateLabel: "Voided",
    voidReason: "voided by owner",
    voidedLabel: "3 Aug 2026",
  },
];

/** The commissions screen, as its page composes it. */
function ELedger() {
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <h1 className="text-[22px] font-semibold tracking-tight">
          Commissions
        </h1>
        <Tabs value="all" className="hidden md:block">
          <TabsList variant="line">
            {[
              ["all", "All", 24],
              ["PENDING", "Pending", 6],
              ["PAYABLE", "Payable", 4],
              ["PAID", "Paid", 11],
              ["VOIDED", "Voided", 3],
            ].map(([value, label, count]) => (
              <TabsTrigger
                key={String(value)}
                value={String(value)}
                className="cursor-pointer"
              >
                {label}
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {count}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-(--radius-md) border border-black/[0.08] bg-elevated">
        <div className="min-h-0 flex-1 overflow-auto">
          <CommissionLedger rows={E_LEDGER} filtered={false} />
        </div>
      </div>
    </div>
  );
}

function ELedgerEmpty() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-(--radius-md) border border-black/[0.08] bg-elevated">
      <CommissionLedger rows={[]} filtered={false} />
    </div>
  );
}

function ELinkDialog() {
  return (
    // Controlled open, so a screenshot does not have to click a trigger.
    <div className="min-h-[460px]">
      <LinkDialog websiteUrl="https://instantgradient.com" open onOpenChange={() => {}} />
    </div>
  );
}

function EShell() {
  return (
    <div className="-m-10 w-[calc(100%+5rem)] overflow-hidden rounded-(--radius-md) bg-background md:h-[760px]">
      <SidebarProvider style={{ "--sidebar-width": "240px" } as React.CSSProperties}>
        <AffiliateSidebar
          merchantName="InstantGradient"
          merchantSite="instantgradient.com"
          email="sarah@northwind.example"
          payoutDetailsMissing
          pathname="/affiliates/dashboard"
        />
        <SidebarInset>
          <div className="flex flex-col overflow-y-auto p-8 md:h-[760px]">
            <SidebarTrigger className="-mt-2 mb-2 self-start md:hidden" />
            <EOverview />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

function BProgramWarning() {
  return (
    <div className="flex flex-col gap-4 rounded-(--radius-lg) bg-background p-6">
      <p className="flex shrink-0 items-start gap-2.5 rounded-(--radius-md) border border-status-warning/30 bg-status-warning-bg px-4 py-2.5 text-[13px] text-neutral-700">
        <TriangleAlert className="mt-px size-4 shrink-0 text-status-warning" />
        <span>
          Affiliates can sign up but cannot log in until your sending domain is verified.{" "}
          <Link
            href="#"
            className="cursor-pointer font-medium text-status-warning underline decoration-status-warning/40 underline-offset-2 hover:decoration-status-warning"
          >
            Check your email setup
          </Link>
        </span>
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProgramCard
          name="Standard"
          rate="20"
          duration="forever"
          attributionDays={60}
          holdingDays={30}
          affiliateCount={12}
          signupLink="https://affiliates.mokkit.co/affiliates/signup/standard"
          editHref="#"
        />
        <ProgramCard
          name="Launch partners, first ninety days"
          rate="35"
          duration="for 12 months"
          attributionDays={30}
          holdingDays={14}
          affiliateCount={1}
          signupLink="https://affiliates.mokkit.co/affiliates/signup/launch"
          editHref="#"
        />
      </div>
    </div>
  );
}
