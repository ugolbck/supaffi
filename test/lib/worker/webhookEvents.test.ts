import { describe, it, expect, vi, beforeEach } from "vitest";

// The database and the decryption are stood in for, so this exercises only
// the loop's own rules: which products it touches, what it records, and that
// one failing product never stops the next.
const findUnique = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ db: { merchant: { findUnique, findMany } } }));
vi.mock("@/lib/crypto", () => ({ decrypt: (value: string) => `plain:${value}` }));

const { upgradeAllWebhookEvents, upgradeMerchantWebhookEvents } = await import("@/lib/worker/webhookEvents");
const { webhookEventsProblem, recordWebhookEventsProblem } = await import("@/lib/webhookEventsProblem");

const OLD_EVENTS = ["checkout.session.completed", "invoice.paid", "charge.refunded", "customer.subscription.deleted"];

function merchant(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    domain: `${id}.example.com`,
    stripeSecretKeyEnc: `key-${id}`,
    stripeWebhookSecretEnc: `whsec-${id}`,
    stripeWebhookEndpointId: `we_${id}`,
    ...extra,
  };
}

describe("upgradeAllWebhookEvents", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
    for (const id of ["a", "b", "c"]) recordWebhookEventsProblem(id, null);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("upgrades each product in turn with its own key and records only real problems", async () => {
    const rows = { a: merchant("a"), b: merchant("b"), c: merchant("c") };
    findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    findUnique.mockImplementation(async ({ where }: { where: { id: keyof typeof rows } }) => rows[where.id]);

    const keys: string[] = [];
    const makeClient = (key: string) => {
      keys.push(key);
      return {
        webhookEndpoints: {
          retrieve: async (id: string) => {
            if (key === "plain:key-b") throw Object.assign(new Error("no"), { type: "StripeConnectionError" });
            return { id, url: "", enabled_events: OLD_EVENTS };
          },
          list: async () => ({ data: [] }),
          update: async () => {
            if (key === "plain:key-c") throw Object.assign(new Error("no"), { type: "StripePermissionError" });
            return {};
          },
        },
      };
    };

    await upgradeAllWebhookEvents(makeClient);

    expect(keys).toEqual(["plain:key-a", "plain:key-b", "plain:key-c"]);
    expect(webhookEventsProblem("a")).toBeNull();
    // A network failure says nothing about the endpoint, so it is not shown.
    expect(webhookEventsProblem("b")).toBeNull();
    expect(webhookEventsProblem("c")).toBe("permission");
  });

  it("never throws when the product list cannot be read", async () => {
    findMany.mockRejectedValue(new Error("database down"));
    await expect(upgradeAllWebhookEvents(() => { throw new Error("should not be called"); })).resolves.toBeUndefined();
  });

  it("skips a product on a local address and clears a stale problem", async () => {
    recordWebhookEventsProblem("a", "missing");
    findUnique.mockResolvedValue(merchant("a", { domain: "shop.localhost:3000" }));
    const makeClient = vi.fn();
    await upgradeMerchantWebhookEvents("a", makeClient);
    expect(makeClient).not.toHaveBeenCalled();
    expect(webhookEventsProblem("a")).toBeNull();
  });

  it("clears a recorded problem once the endpoint is fixed", async () => {
    recordWebhookEventsProblem("a", "permission");
    findUnique.mockResolvedValue(merchant("a"));
    await upgradeMerchantWebhookEvents("a", () => ({
      webhookEndpoints: {
        retrieve: async (id: string) => ({ id, url: "", enabled_events: ["*"] }),
        list: async () => ({ data: [] }),
        update: async () => ({}),
      },
    }));
    expect(webhookEventsProblem("a")).toBeNull();
  });
});
