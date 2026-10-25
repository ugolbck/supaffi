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
