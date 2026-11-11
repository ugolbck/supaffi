// A stand-in for Polar's API and webhooks, for the end-to-end suite only.
//
// It answers the calls Supaffi makes (the webhook endpoints) and delivers
// events signed the way Polar signs them (Standard Webhooks), so the app's
// real signature check runs. The /_test/* routes are the suite's levers: a
// paid order, a refund, a subscription ending.

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 12112);

const state = { endpoints: new Map(), orders: new Map(), discounts: new Map(), deliveries: [] };

// The owner's own discounts: one to put behind a program, and a code that is
// already taken.
for (const discount of [
  { id: "d_partner", name: "Partners", code: null },
  { id: "d_taken", name: "Spring sale", code: "PARTNER20" },
]) {
  state.discounts.set(discount.id, {
    ...discount,
    type: "percentage",
    basis_points: 2000,
    duration: "repeating",
    duration_in_months: 3,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    max_redemptions_per_customer: null,
    redemptions_count: 0,
    products: [],
    metadata: {},
  });
}

const liveDiscounts = () => [...state.discounts.values()].filter((d) => !d.deleted);
const byCode = (code) => liveDiscounts().find((d) => d.code && d.code.toLowerCase() === String(code).toLowerCase());

function sign(secret, id, timestamp, payload) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;
}

// Delivered to every endpoint that asked for the event, and awaited, so the
// test knows the app accepted it before it looks for the result.
async function emit(type, data) {
  const payload = JSON.stringify({ type, timestamp: new Date().toISOString(), data });
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const results = [];
  for (const endpoint of state.endpoints.values()) {
    if (!endpoint.events.includes(type)) continue;
    let status = 0;
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-id": id,
          "webhook-timestamp": timestamp,
          "webhook-signature": sign(endpoint.secret, id, timestamp, payload),
        },
        body: payload,
      });
      status = res.status;
    } catch (err) {
      console.error(`delivery to ${endpoint.url} failed:`, err.cause?.message ?? err.message);
    }
    state.deliveries.push({ type, url: endpoint.url, status });
    results.push({ url: endpoint.url, status });
  }
  return results;
}

// --- the test's levers ---------------------------------------------------

async function testOrder(body) {
  const order = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    status: "paid",
    billing_reason: body.billing_reason ?? "purchase",
    subtotal_amount: body.net_amount ?? 10000,
    discount_amount: 0,
    net_amount: body.net_amount ?? 10000,
    tax_amount: 0,
    total_amount: body.net_amount ?? 10000,
    refunded_amount: 0,
    refunded_tax_amount: 0,
    currency: "usd",
    customer_id: randomUUID(),
    product_id: body.product_id ?? "prod_e2e",
    subscription_id: body.subscription_id ?? null,
    discount_id: body.discount_code ? (byCode(body.discount_code)?.id ?? null) : null,
    checkout_id: randomUUID(),
    metadata: {
      ...(body.metadata ?? {}),
      ...(body.reference_id ? { reference_id: body.reference_id } : {}),
    },
    customer: { email: body.email ?? "buyer@example.com", metadata: {} },
    subscription: null,
  };
  state.orders.set(order.id, order);
  return { order: order.id, deliveries: await emit("order.paid", order) };
}

async function testRefund(body) {
  const order = state.orders.get(body.order);
  if (!order) return null;
  order.refunded_amount = Math.min(order.net_amount, order.refunded_amount + Number(body.amount ?? order.net_amount));
  order.status = order.refunded_amount >= order.net_amount ? "refunded" : "partially_refunded";
  return { deliveries: await emit("order.refunded", order) };
}

async function testRevoke(body) {
  return { deliveries: await emit("subscription.revoked", { id: body.subscription, status: "canceled" }) };
}

// --- the API Supaffi calls ------------------------------------------------

function discounts(method, path, search, body) {
  if (path === "/v1/discounts/" && method === "GET") {
    const query = (search.get("query") ?? "").toLowerCase();
    const items = liveDiscounts().filter((d) => !query || d.name.toLowerCase().includes(query) || (d.code ?? "").toLowerCase().includes(query));
    return [200, { items }];
  }
  if (path === "/v1/discounts/" && method === "POST") {
    if (body.code && byCode(body.code)) return [422, { error: "RequestValidationError" }];
    const discount = { ...body, id: randomUUID(), redemptions_count: 0, ends_at: null, max_redemptions: null, products: (body.products ?? []).map((id) => ({ id })) };
    state.discounts.set(discount.id, discount);
    return [201, discount];
  }
  const match = path.match(/^\/v1\/discounts\/([^/]+)$/);
  const discount = match && state.discounts.get(match[1]);
  if (!discount || discount.deleted) return [404, { error: "ResourceNotFound" }];
  if (method === "GET") return [200, discount];
  if (method === "DELETE") {
    discount.deleted = true;
    return [204, null];
  }
  return [405, { error: "MethodNotAllowed" }];
}

function api(method, path, body) {
  if (path === "/v1/webhooks/endpoints" && method === "GET") return [200, { items: [...state.endpoints.values()] }];
  if (path === "/v1/webhooks/endpoints" && method === "POST") {
    const endpoint = {
      id: randomUUID(),
      url: body.url,
      name: body.name ?? null,
      format: body.format,
      events: body.events ?? [],
      enabled: true,
      secret: `whsec_${randomBytes(32).toString("base64")}`,
    };
    state.endpoints.set(endpoint.id, endpoint);
    return [201, endpoint];
  }
  const match = path.match(/^\/v1\/webhooks\/endpoints\/([^/]+)$/);
  const endpoint = match && state.endpoints.get(match[1]);
  if (!endpoint) return [404, { error: "ResourceNotFound" }];
  if (method === "GET") return [200, endpoint];
  if (method === "PATCH") {
    if (body.url) endpoint.url = body.url;
    if (body.events) endpoint.events = body.events;
    return [200, endpoint];
  }
  if (method === "DELETE") {
    state.endpoints.delete(endpoint.id);
    return [204, null];
  }
  return [405, { error: "MethodNotAllowed" }];
}

function send(res, status, body) {
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://fake");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  const body = text ? JSON.parse(text) : {};

  if (url.pathname.startsWith("/_test/")) {
    if (url.pathname === "/_test/state") {
      return send(res, 200, { endpoints: [...state.endpoints.values()], discounts: [...state.discounts.values()], deliveries: state.deliveries });
    }
    const route = { "/_test/order": testOrder, "/_test/refund": testRefund, "/_test/revoke": testRevoke }[url.pathname];
    const result = route ? await route(body) : null;
    return result ? send(res, 200, result) : send(res, 404, { error: "ResourceNotFound" });
  }

  // Any token for the fake's organization works. Anything else is unknown, as
  // a token from the other environment is on Polar, so a wrong token still
  // fails the onboarding check.
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!token.startsWith("polar_oat_e2e")) return send(res, 401, { error: "invalid_token" });

  const [status, answer] = url.pathname.startsWith("/v1/discounts/")
    ? discounts(req.method, url.pathname, url.searchParams, body)
    : api(req.method, url.pathname, body);
  return send(res, status, answer);
}).listen(PORT, () => console.log(`fake polar on :${PORT}`));
