import { expect, type Page } from "@playwright/test";

// A sale, as the affiliate mechanics see it: a buyer lands on the merchant's
// site, optionally through an affiliate link, and pays. Nothing here names a
// payment provider; the merchant site and the provider fake do. Adding Polar
// or Paddle means another fake behind the same steps.

export type SaleResult = {
  paymentIntent: string;
  referral: string;
  delivered: number[];
};

export type PaymentLinkSaleResult = {
  href: string;
  /** The referral token in the browser's cookie, for comparing with the href. */
  referral: string;
  delivered: number[];
};

// A buyer arriving through an affiliate link onto a page with a Payment Link
// on it, the owner having done nothing for it. The link leaves the merchant's
// site for the provider's hosted page, which this suite does not load: the
// buyer's payment is made at the provider fake with what the link's address
// carried.
export async function paymentLinkSale(buyer: Page, input: { via: string; email: string; amount: number; cardFingerprint?: string }): Promise<PaymentLinkSaleResult> {
  await buyer.goto(`https://shop.test/?via=${input.via}`);
  const cookie = async () => (await buyer.context().cookies("https://shop.test")).find((c) => c.name === "__supaffi_referral");
  await expect.poll(async () => Boolean(await cookie())).toBe(true);
  const referral = decodeURIComponent((await cookie())!.value);
  const link = buyer.getByTestId("payment-link");
  await expect(link).toHaveAttribute("href", /client_reference_id=/);
  const href = (await link.getAttribute("href"))!;
  const clientReference = new URL(href).searchParams.get("client_reference_id");
  const res = await buyer.request.post("http://127.0.0.1:12111/_test/checkout", {
    data: { amount: input.amount, email: input.email, client_reference_id: clientReference, cardFingerprint: input.cardFingerprint },
  });
  return { href, referral, delivered: (await res.json()).deliveries.map((d: { status: number }) => d.status) };
}

// A buyer who never clicked a link and types an affiliate's promo code at the
// provider's checkout, which this suite does not load.
export async function promoCodeSale(
  buyer: Page,
  input: { code: string; email: string; amount: number; cardFingerprint?: string }
): Promise<{ delivered: number[] }> {
  const res = await buyer.request.post("http://127.0.0.1:12111/_test/checkout", {
    data: { amount: input.amount, email: input.email, promotion_code: input.code, cardFingerprint: input.cardFingerprint },
  });
  expect(res.ok()).toBe(true);
  return { delivered: (await res.json()).deliveries.map((d: { status: number }) => d.status) };
}

export async function sale(buyer: Page, input: { via?: string; email: string }): Promise<SaleResult> {
  const landing = input.via ? `https://shop.test/?via=${input.via}` : "https://shop.test/";
  await buyer.goto(landing);
  if (input.via) {
    // track.js has asked the app for a token and stored it first-party.
    await expect
      .poll(async () => (await buyer.context().cookies("https://shop.test")).some((c) => c.name === "__supaffi_referral"))
      .toBe(true);
  }
  await buyer.getByLabel("Email").fill(input.email);
  await buyer.getByRole("button", { name: /Buy/ }).click();
  await buyer.getByRole("heading", { name: "Thanks" }).waitFor();
  return {
    paymentIntent: (await buyer.getByTestId("payment-intent").textContent())!.trim(),
    referral: (await buyer.getByTestId("referral").textContent())!.trim(),
    delivered: (await buyer.getByTestId("delivered").textContent())!
      .split(",")
      .filter(Boolean)
      .map(Number),
  };
}

// A buyer arriving through an affiliate link onto a page with a Polar
// checkout link on it. As with a Payment Link, Polar's hosted checkout is not
// loaded: the order is made at the Polar fake with the reference the link
// carried, which Polar copies into the order's metadata.
export async function polarLinkSale(buyer: Page, input: { via: string; email: string; amount: number }): Promise<{ order: string; delivered: number[] }> {
  await buyer.goto(`https://polarshop.test/?via=${input.via}`);
  const link = buyer.getByTestId("polar-link");
  await expect(link).toHaveAttribute("href", /reference_id=/);
  const reference = new URL((await link.getAttribute("href"))!).searchParams.get("reference_id");
  const res = await buyer.request.post("http://127.0.0.1:12112/_test/order", {
    data: { net_amount: input.amount, email: input.email, reference_id: reference },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return { order: body.order, delivered: body.deliveries.map((d: { status: number }) => d.status) };
}
