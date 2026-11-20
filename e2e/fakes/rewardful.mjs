// A stand-in for Rewardful's REST API, for the end-to-end suite only: one
// small program to import, behind the one key the suite pastes.

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 12113);
const KEY = "rw_e2e_secret";

const page = (data) => ({ pagination: { previous_page: null, current_page: 1, next_page: null, count: data.length, limit: 100, total_pages: 1, total_count: data.length }, data });

const routes = {
  "/v1/campaigns": () => page([{ id: "camp_1", name: "Partners" }]),
  "/v1/affiliates": () =>
    page([
      {
        id: "aff_bob",
        email: "bob@example.com",
        first_name: "Bob",
        last_name: "Moved",
        paypal_email: "bob@paypal.test",
        wise_email: null,
        state: "active",
        campaign: { id: "camp_1", name: "Partners" },
        links: [{ id: "lnk_1", url: "https://shop.test/?via=bob-old", token: "bob-old" }],
      },
    ]),
  "/v1/referrals": () =>
    page([
      {
        id: "ref_1",
        conversion_state: "conversion",
        stripe_customer_id: null,
        affiliate: { id: "aff_bob" },
        created_at: "2026-01-01T00:00:00.000Z",
        became_conversion_at: "2026-01-02T00:00:00.000Z",
      },
    ]),
  "/v1/commissions": () =>
    page([
      { id: "com_owed", amount: 2500, currency: "USD", state: "due", created_at: "2026-02-01T00:00:00.000Z", paid_at: null, sale: { affiliate: { id: "aff_bob" }, referral: { id: "ref_1" } } },
      { id: "com_paid", amount: 1000, currency: "USD", state: "paid", created_at: "2026-01-02T00:00:00.000Z", paid_at: "2026-01-31T00:00:00.000Z", sale: { affiliate: { id: "aff_bob" }, referral: { id: "ref_1" } } },
    ]),
};

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") return res.end("ok");
  if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "Unauthorized" }));
  }
  const route = routes[url.pathname];
  res.writeHead(route ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify(route ? route() : { error: "Not found" }));
}).listen(PORT, () => console.log(`fake rewardful on ${PORT}`));
