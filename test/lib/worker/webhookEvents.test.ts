import { describe, it, expect, vi, beforeEach } from "vitest";

// The database and the decryption are stood in for, so this exercises only
// the loop's own rules: which products it touches, what it records, and that
// one failing product never stops the next.
const findUnique = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ db: { merchant: { findUnique, findMany } } }));
vi.mock("@/lib/crypto", () => ({ decrypt: (value: string) => `plain:${value}` }));

const { upgradeAllWebhookEvents, upgradeMerchantWebhookEvents, moveMerchantWebhookEndpoint } = await import(
  "@/lib/payments/stripe/endpointUpkeep"
);

const OLD_EVENTS = ["checkout.session.completed", "invoice.paid", "charge.refunded", "customer.subscription.deleted"];

function merchant(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    domain: `${id}.example.com`,
    paymentKeyEnc: `key-${id}`,
    webhookSecretEnc: `whsec-${id}`,
    webhookEndpointId: `we_${id}`,
    ...extra,
  };
}

describe("upgradeAllWebhookEvents", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("upgrades each product in turn with its own key and warns only about a real problem", async () => {
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
    // A network failure says nothing about the endpoint, so it is not warned about.
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("merchant c"));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Replace the key in settings"));
  });

  it("never throws when the product list cannot be read", async () => {
    findMany.mockRejectedValue(new Error("database down"));
    await expect(upgradeAllWebhookEvents(() => { throw new Error("should not be called"); })).resolves.toBeUndefined();
  });

  it("skips a product on a local address", async () => {
    findUnique.mockResolvedValue(merchant("a", { domain: "shop.localhost:3000" }));
    const makeClient = vi.fn();
    await upgradeMerchantWebhookEvents("a", makeClient);
    expect(makeClient).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns when the endpoint is missing from Stripe, naming the fix", async () => {
    findUnique.mockResolvedValue(merchant("a"));
    await upgradeMerchantWebhookEvents("a", () => ({
      webhookEndpoints: {
        retrieve: async () => {
          throw Object.assign(new Error("no"), { code: "resource_missing", statusCode: 404 });
        },
        list: async () => ({ data: [] }),
        update: async () => ({}),
      },
    }));
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("merchant a"));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Add the webhook again"));
  });

  it("does not warn once the endpoint already has every event", async () => {
    findUnique.mockResolvedValue(merchant("a"));
    await upgradeMerchantWebhookEvents("a", () => ({
      webhookEndpoints: {
        retrieve: async (id: string) => ({ id, url: "", enabled_events: ["*"] }),
        list: async () => ({ data: [] }),
        update: async () => ({}),
      },
    }));
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("moveMerchantWebhookEndpoint", () => {
  beforeEach(() => {
    findUnique.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function client(update: (id: string, params: { url?: string }) => Promise<unknown>) {
    return {
      webhookEndpoints: {
        retrieve: async () => {
          throw new Error("not called");
        },
        list: async () => ({ data: [] }),
        update: vi.fn(update),
      },
    };
  }

  it("moves the endpoint Supaffi created to the product's new address, with the product's own key", async () => {
    findUnique.mockResolvedValue(merchant("a", { domain: "partners.example.com" }));
    const fake = client(async () => ({}));
    const keys: string[] = [];
    const result = await moveMerchantWebhookEndpoint("a", (key) => {
      keys.push(key);
      return fake;
    });
    expect(result).toBe("moved");
    expect(keys).toEqual(["plain:key-a"]);
    expect(fake.webhookEndpoints.update).toHaveBeenCalledWith("we_a", {
      url: "https://partners.example.com/api/webhooks/stripe",
    });
  });

  it("asks the owner to move it when Stripe refuses, and logs why", async () => {
    findUnique.mockResolvedValue(merchant("a"));
    const result = await moveMerchantWebhookEndpoint("a", () =>
      client(async () => {
        throw Object.assign(new Error("no"), { type: "StripePermissionError", statusCode: 403 });
      })
    );
    expect(result).toBe("manual");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("merchant a"));
  });

  it("asks the owner to move an endpoint Supaffi did not create, without touching it", async () => {
    findUnique.mockResolvedValue(merchant("a", { webhookEndpointId: null }));
    const makeClient = vi.fn();
    expect(await moveMerchantWebhookEndpoint("a", makeClient)).toBe("manual");
    expect(makeClient).not.toHaveBeenCalled();
  });

  it("asks the owner when the key cannot be read", async () => {
    findUnique.mockResolvedValue(merchant("a"));
    const result = await moveMerchantWebhookEndpoint("a", () => {
      throw new Error("bad key");
    });
    expect(result).toBe("manual");
  });

  it("has nothing to move without a webhook, or on a local address", async () => {
    const makeClient = vi.fn();
    findUnique.mockResolvedValue(merchant("a", { webhookSecretEnc: null, webhookEndpointId: null }));
    expect(await moveMerchantWebhookEndpoint("a", makeClient)).toBe("none");
    findUnique.mockResolvedValue(merchant("a", { domain: "shop.localhost:3000" }));
    expect(await moveMerchantWebhookEndpoint("a", makeClient)).toBe("none");
    expect(makeClient).not.toHaveBeenCalled();
  });
});
