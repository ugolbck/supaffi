import { execSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { paymentLinkSale, promoCodeSale, sale } from "./provider";

// One owner, one product, one affiliate, driven through the real screens:
// setup, onboarding, signup, the affiliate link landing on the merchant's
// site, a purchase, and then what refunds, disputes and self-referrals do to
// the commission. Steps share state, so they run in order.
test.describe.configure({ mode: "serial" });

const OWNER = { email: "owner@example.com", password: "owner-password-123" };
const AFFILIATE = { name: "Alice", email: "alice@example.com", password: "alice-password-123", code: "alice" };
const ADMIN = "https://admin.test";
const PRODUCT_DOMAIN = "https://go.shop.test";
const SHOP = "https://shop.test";

let owner: Page;
let affiliate: Page;

function setupToken(): string {
  const logs = execSync("docker compose logs app", { cwd: `${import.meta.dirname}/..` }).toString();
  const token = [...logs.matchAll(/setup token: ([A-Za-z0-9_-]{16,})/g)].at(-1)?.[1];
  if (!token) throw new Error("No setup token in the app logs");
  return token;
}

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

// The worker picks webhooks up asynchronously, so a result is waited for by
// reloading, the way an owner would.
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });
}

test.beforeAll(async ({ browser }) => {
  owner = await newPage(browser);
  affiliate = await newPage(browser);
});

test("owner sets up the instance", async () => {
  await owner.goto(`${ADMIN}/setup`);
  await owner.getByLabel("Setup token").fill(setupToken());
  await owner.getByLabel("Email").fill(OWNER.email);
  await owner.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await owner.getByLabel("Confirm password").fill(OWNER.password);
  await owner.getByRole("button", { name: "Create account" }).click();
  await owner.waitForURL(/\/onboarding/);
});

test("owner onboards a product", async () => {
  await owner.getByLabel("Name").fill("Shop");
  await owner.getByLabel("Website").fill("shop.test");
  await owner.getByRole("button", { name: "Continue" }).click();

  // Proves the product domain gets a certificate through Caddy's on-demand
  // TLS and the app's ask endpoint. The DNS record row cannot pass: it needs
  // a real authoritative nameserver.
  await owner.waitForURL(/\/subdomain$/);
  await expect(owner.getByText("go.shop.test").first()).toBeVisible();
  await expect(owner.getByText("Secured with HTTPS")).toBeVisible();
  await owner.getByRole("button", { name: "Continue" }).click();

  // The key is checked against Stripe and the webhook endpoint is created
  // there, at the product domain's production URL.
  await owner.waitForURL(/\/stripe-key$/);
  await owner.getByLabel("Paste the key here").fill("rk_test_e2e");
  await owner.getByLabel("Paste the key here").press("Enter");

  await owner.waitForURL(/\/terms$/);
  await owner.getByRole("spinbutton", { name: "Commission" }).fill("30");
  await owner.getByRole("button", { name: "Continue" }).click();

  // The app fetches the merchant's page and finds its own script tag.
  await owner.waitForURL(/\/tracking$/);
  await expect(owner.getByText("Script is live on shop.test")).toBeVisible({ timeout: 90_000 });
  await owner.getByRole("button", { name: "Finish" }).click();
  const live = owner.getByRole("dialog", { name: "Your affiliate program is live" });
  await expect(live.getByText(`${PRODUCT_DOMAIN}/affiliates/signup/shop`)).toBeVisible();
  await live.getByRole("button", { name: "Go to dashboard" }).click();
  await owner.waitForURL(/\/dashboard\/products\/shop/);
});

test("affiliate signs up on the product domain", async () => {
  await affiliate.goto(`${PRODUCT_DOMAIN}/affiliates/signup/shop`);
  await expect(affiliate.getByText("30%")).toBeVisible();
  await affiliate.getByLabel("Name").fill(AFFILIATE.name);
  await affiliate.getByLabel("Email").fill(AFFILIATE.email);
  await affiliate.getByLabel("Password").fill(AFFILIATE.password);
  await affiliate.getByLabel("Your referral link").fill(AFFILIATE.code);
  await affiliate.getByRole("button", { name: "Get my link" }).click();
  await affiliate.waitForURL(/\/affiliates\/dashboard/);
  await expect(affiliate.getByText(`https://shop.test?via=${AFFILIATE.code}`)).toBeVisible();
});

test("owner pages are not served on the product domain", async ({ browser }) => {
  const visitor = await newPage(browser);
  const res = await visitor.goto(`${PRODUCT_DOMAIN}/dashboard`);
  expect(res?.status()).toBe(404);
});

test("a referred sale earns a commission", async ({ browser }) => {
  const buyer = await newPage(browser);
  const result = await sale(buyer, { via: AFFILIATE.code, email: "buyer@example.com" });
  expect(result.referral).not.toBe("none");
  expect(result.delivered).toEqual([200]);

  await owner.goto(`${ADMIN}/dashboard/products/shop/commissions`);
  await eventually(owner, () => expect(owner.getByRole("cell", { name: "$30.00" })).toBeVisible());
  await affiliate.goto(`${PRODUCT_DOMAIN}/affiliates/dashboard`);
  await eventually(affiliate, () => expect(affiliate.getByText(/30\.00/).first()).toBeVisible());

  saleRefs.referred = result.paymentIntent;
});

test("a sale with no referral earns nothing", async ({ browser }) => {
  const buyer = await newPage(browser);
  const result = await sale(buyer, { email: "direct@example.com" });
  expect(result.referral).toBe("none");
  expect(result.delivered).toEqual([200]);
  // The worker takes webhooks as they arrive; a few seconds is plenty.
  await owner.waitForTimeout(3_000);
  await owner.reload();
  await expect(owner.getByRole("cell", { name: "$30.00" })).toHaveCount(1);
});

const saleRefs: { referred?: string } = {};

test("a full refund voids the commission", async ({ request }) => {
  const res = await request.post("http://127.0.0.1:12111/_test/refund", { data: { payment_intent: saleRefs.referred } });
  expect(res.ok()).toBe(true);
  expect((await res.json()).deliveries.map((d: { status: number }) => d.status)).toEqual([200]);
  await owner.goto(`${ADMIN}/dashboard/products/shop/commissions`);
  await eventually(owner, () => expect(owner.getByRole("cell", { name: "Voided" })).toBeVisible());
});

test("a dispute holds the commission", async ({ browser, request }) => {
  const buyer = await newPage(browser);
  const result = await sale(buyer, { via: AFFILIATE.code, email: "disputer@example.com" });
  const res = await request.post("http://127.0.0.1:12111/_test/dispute", { data: { payment_intent: result.paymentIntent } });
  expect(res.ok()).toBe(true);
  await owner.goto(`${ADMIN}/dashboard/products/shop/commissions`);
  // The hold shows in the commission's panel; the list row does not say it.
  await eventually(owner, async () => {
    await owner.getByRole("row").nth(1).getByRole("link").click();
    await expect(owner.getByText("Disputed", { exact: true })).toBeVisible({ timeout: 3_000 });
  });
});

test("an affiliate buying through their own link is flagged", async ({ browser }) => {
  const buyer = await newPage(browser);
  await sale(buyer, { via: AFFILIATE.code, email: AFFILIATE.email });
  await owner.goto(`${ADMIN}/dashboard/products/shop/commissions`);
  await eventually(owner, () => expect(owner.getByRole("cell", { name: "Flagged" })).toBeVisible());
});

test("a Payment Link on the merchant's page earns a commission", async ({ browser }) => {
  const buyer = await newPage(browser);
  const result = await paymentLinkSale(buyer, { via: AFFILIATE.code, email: "linkbuyer@example.com", amount: 5000, cardFingerprint: "fp_link_buyer_card" });
  // The script tagged the link with the visitor's referral, and nothing else
  // on the merchant's side did.
  expect(new URL(result.href).searchParams.get("client_reference_id")).toBe(`supaffi_${result.referral}`);
  expect(result.delivered).toEqual([200]);
  // A different amount from every other sale, so this commission is its own.
  await owner.goto(`${ADMIN}/dashboard/products/shop/commissions`);
  // A card of its own, so it is not mistaken for the affiliate buying through
  // their own link.
  await eventually(owner, async () => {
    const row = owner.getByRole("row").filter({ has: owner.getByRole("cell", { name: "$15.00" }) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "Flagged" })).toHaveCount(0);
  });
});

test("a promo code earns for its affiliate with no click", async ({ browser }) => {
  // The owner types the code as the customer would; Supaffi finds it in Stripe.
  await owner.goto(`${ADMIN}/dashboard/products/shop/affiliates`);
  await owner.getByRole("link", { name: AFFILIATE.name }).first().click();
  const sheet = owner.getByRole("dialog");
  await sheet.getByLabel("Stripe promo code").fill("partner20");
  await sheet.getByRole("button", { name: "Add" }).click();
  await expect(sheet.getByText("PARTNER20")).toBeVisible();

  await affiliate.goto(`${PRODUCT_DOMAIN}/affiliates/dashboard/links`);
  await expect(affiliate.getByRole("cell", { name: "PARTNER20" })).toBeVisible();

  const buyer = await newPage(browser);
  const result = await promoCodeSale(buyer, {
    code: "PARTNER20",
    email: "codebuyer@example.com",
    amount: 7000,
    cardFingerprint: "fp_code_buyer_card",
  });
  expect(result.delivered).toEqual([200]);

  // A different amount from every other sale, so this commission is its own.
  await owner.goto(`${ADMIN}/dashboard/products/shop/commissions`);
  await eventually(owner, async () => {
    const row = owner.getByRole("row").filter({ has: owner.getByRole("cell", { name: "$21.00" }) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "Flagged" })).toHaveCount(0);
  });
});
