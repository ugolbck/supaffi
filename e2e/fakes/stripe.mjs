// A small stateful stand-in for the Stripe API, for the end-to-end suite only.
//
// It answers the calls Supaffi makes (key check, webhook endpoints, and the
// reads the worker does after a webhook) from what it was told, and it signs
// and delivers webhooks the way Stripe does, to the endpoint Supaffi itself
// registered during onboarding. stripe-mock cannot do this: it is stateless
// and sends no webhooks.
//
// The /_test routes are the test's levers: a paid checkout, a refund, a
// dispute. They stand in for what a buyer and a bank do on the real Stripe.
//
// Only the one-time payment path is modelled. Subscriptions, invoices and
// taxes are not; their reads answer with empty lists.

import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 12111);
const API_VERSION = "2026-09-30.endive";

const state = {
  endpoints: new Map(),
  customers: new Map(),
  paymentMethods: new Map(),
  paymentIntents: new Map(),
  charges: new Map(),
  sessions: new Map(),
  disputes: new Map(),
  deliveries: [],
};

const id = (prefix) => `${prefix}_${randomBytes(12).toString("hex")}`;
const now = () => Math.floor(Date.now() / 1000);
const list = (url, data) => ({ object: "list", url, has_more: false, data });

// Stripe's form encoding: a[b][0]=c. Enough of it for what the SDK sends.
function parseForm(text) {
  const out = {};
  for (const [rawKey, value] of new URLSearchParams(text)) {
    const keys = rawKey.split(/\[|\]\[|\]/).filter((k) => k !== "");
    let node = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) {
        node[key] = value;
      } else {
        node[key] ??= /^\d+$/.test(keys[i + 1]) ? [] : {};
        node = node[key];
      }
    });
  }
  return out;
}

const expands = (params) => {
  const e = params.expand;
  return new Set(Array.isArray(e) ? e : e ? Object.values(e) : []);
};

function charge(chargeId) {
  return state.charges.get(chargeId);
}

function paymentIntent(piId, expand = new Set()) {
  const pi = state.paymentIntents.get(piId);
  if (!pi) return null;
  return {
    ...pi,
    payment_method: expand.has("payment_method") ? state.paymentMethods.get(pi.payment_method) : pi.payment_method,
    latest_charge: expand.has("latest_charge") ? charge(pi.latest_charge) : pi.latest_charge,
  };
}

function session(sessionId, expand = new Set()) {
  const s = state.sessions.get(sessionId);
  if (!s) return null;
  return {
    ...s,
    customer: expand.has("customer") ? state.customers.get(s.customer) : s.customer,
  };
}

function sign(secret, payload) {
  const t = now();
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

// Delivered to every endpoint that asked for the event, and awaited, so the
// test knows the app accepted it before it looks for the result.
async function emit(type, object) {
  const event = {
    id: id("evt"),
    object: "event",
    api_version: API_VERSION,
    created: now(),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
  const payload = JSON.stringify(event);
  const results = [];
  for (const endpoint of state.endpoints.values()) {
    if (!endpoint.enabled_events.includes(type) && !endpoint.enabled_events.includes("*")) continue;
    let status = 0;
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": sign(endpoint.secret, payload) },
        body: payload,
      });
      status = res.status;
    } catch (err) {
      console.error(`delivery to ${endpoint.url} failed:`, err.cause?.message ?? err.message);
    }
    state.deliveries.push({ type, url: endpoint.url, status });
    results.push({ url: endpoint.url, status });
  }
  return { event: event.id, deliveries: results };
}

// --- the test's levers ---------------------------------------------------

async function testCheckout(body) {
  const amount = Number(body.amount ?? 10000);
  const currency = body.currency ?? "usd";
  const email = body.email ?? "buyer@example.com";

  const customer = { id: id("cus"), object: "customer", email, metadata: {}, deleted: undefined };
  state.customers.set(customer.id, customer);

  const pm = {
    id: id("pm"),
    object: "payment_method",
    type: "card",
    customer: customer.id,
    card: { brand: "visa", last4: "4242", fingerprint: body.cardFingerprint ?? "fp_buyer_card" },
  };
  state.paymentMethods.set(pm.id, pm);

  const piId = id("pi");
  const ch = {
    id: id("ch"),
    object: "charge",
    amount,
    amount_refunded: 0,
    currency,
    disputed: false,
    refunded: false,
    payment_intent: piId,
    customer: customer.id,
    invoice: null,
  };
  state.charges.set(ch.id, ch);

  const pi = {
    id: piId,
    object: "payment_intent",
    amount,
    currency,
    status: "succeeded",
    customer: customer.id,
    payment_method: pm.id,
    latest_charge: ch.id,
  };
  state.paymentIntents.set(pi.id, pi);

  const s = {
    id: id("cs"),
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    created: now(),
    amount_subtotal: amount,
    amount_total: amount,
    currency,
    customer: customer.id,
    customer_details: { email },
    metadata: body.metadata ?? {},
    payment_intent: pi.id,
    invoice: null,
    subscription: null,
    shipping_cost: null,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0, breakdown: { discounts: [], taxes: [] } },
  };
  state.sessions.set(s.id, s);

  const delivered = await emit("checkout.session.completed", s);
  return { session: s.id, payment_intent: pi.id, ...delivered };
}

async function testRefund(body) {
  const pi = state.paymentIntents.get(body.payment_intent);
  if (!pi) return null;
  const ch = charge(pi.latest_charge);
  ch.amount_refunded = Math.min(ch.amount, ch.amount_refunded + Number(body.amount ?? ch.amount));
  ch.refunded = ch.amount_refunded === ch.amount;
  return emit("charge.refunded", ch);
}

async function testDispute(body) {
  const pi = state.paymentIntents.get(body.payment_intent);
  if (!pi) return null;
  const ch = charge(pi.latest_charge);
  ch.disputed = true;
  const dispute = {
    id: id("dp"),
    object: "dispute",
    amount: ch.amount,
    currency: ch.currency,
    status: "needs_response",
    reason: "fraudulent",
    charge: ch.id,
    payment_intent: pi.id,
    payment_method_details: { type: "card", card: { brand: "visa", case_type: "chargeback" } },
  };
  state.disputes.set(dispute.id, dispute);
  return emit("charge.dispute.created", dispute);
}

// --- the API Supaffi calls ------------------------------------------------

function api(method, path, params) {
  let m;
  if (method === "GET" && path === "/v1/customers") {
    const all = [...state.customers.values()].filter((c) => !params.email || c.email === params.email);
    return list(path, all.slice(0, Number(params.limit ?? 10)));
  }
  if (method === "GET" && (m = path.match(/^\/v1\/customers\/([^/]+)$/))) return state.customers.get(m[1]);

  if (method === "POST" && path === "/v1/webhook_endpoints") {
    const endpoint = {
      id: id("we"),
      object: "webhook_endpoint",
      url: params.url,
      enabled_events: params.enabled_events ?? [],
      description: params.description ?? null,
      status: "enabled",
      api_version: null,
      secret: `whsec_${randomBytes(24).toString("hex")}`,
    };
    state.endpoints.set(endpoint.id, endpoint);
    return endpoint;
  }
  if (method === "GET" && path === "/v1/webhook_endpoints") {
    return list(path, [...state.endpoints.values()].map(({ secret, ...e }) => e));
  }
  if ((m = path.match(/^\/v1\/webhook_endpoints\/([^/]+)$/))) {
    const endpoint = state.endpoints.get(m[1]);
    if (!endpoint) return null;
    if (method === "DELETE") {
      state.endpoints.delete(m[1]);
      return { id: m[1], object: "webhook_endpoint", deleted: true };
    }
    if (method === "POST" && params.enabled_events) endpoint.enabled_events = params.enabled_events;
    const { secret, ...rest } = endpoint;
    return rest;
  }

  if (method === "GET" && (m = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) return session(m[1], expands(params));
  if (method === "GET" && (m = path.match(/^\/v1\/payment_intents\/([^/]+)$/))) return paymentIntent(m[1], expands(params));
  if (method === "GET" && (m = path.match(/^\/v1\/charges\/([^/]+)$/))) return charge(m[1]);
  if (method === "GET" && path === "/v1/payment_methods") {
    return list(path, [...state.paymentMethods.values()].filter((p) => p.customer === params.customer));
  }
  if (method === "GET" && path === "/v1/disputes") {
    return list(path, [...state.disputes.values()].filter((d) => !params.payment_intent || d.payment_intent === params.payment_intent));
  }
  // Payment-mode sales have no invoice, which is what an empty list says.
  if (method === "GET" && path === "/v1/invoice_payments") return list(path, []);
  return undefined;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const notFound = (path) => ({
  error: { type: "invalid_request_error", code: "resource_missing", message: `No such resource: ${path}` },
});

createServer(async (req, res) => {
  const url = new URL(req.url, "http://fake");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();

  if (url.pathname.startsWith("/_test/")) {
    const body = text ? JSON.parse(text) : {};
    const route = { "/_test/checkout": testCheckout, "/_test/refund": testRefund, "/_test/dispute": testDispute }[url.pathname];
    if (url.pathname === "/_test/state") return send(res, 200, { endpoints: [...state.endpoints.values()], deliveries: state.deliveries });
    if (!route) return send(res, 404, notFound(url.pathname));
    const result = await route(body);
    return result ? send(res, 200, result) : send(res, 404, notFound(url.pathname));
  }

  // Any test-mode key works; anything else is rejected the way Stripe does,
  // so a wrong key still fails the onboarding check.
  const key = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!/^(sk|rk)_test_/.test(key)) {
    return send(res, 401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } });
  }

  const params = req.method === "GET" || req.method === "DELETE" ? parseForm(url.search.slice(1)) : parseForm(text);
  const result = api(req.method, url.pathname, params);
  if (result === undefined) {
    console.error(`unhandled ${req.method} ${url.pathname}`);
    return send(res, 404, notFound(url.pathname));
  }
  return result ? send(res, 200, result) : send(res, 404, notFound(url.pathname));
}).listen(PORT, () => console.log(`fake stripe on :${PORT}`));
