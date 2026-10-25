import { beforeEach, describe, expect, it, vi } from "vitest";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => incoming.headers }));

import { requestHost } from "@/lib/requestHost";

describe("requestHost", () => {
  beforeEach(() => {
    incoming.headers = new Headers();
  });

  it("prefers the name the browser used over the app's own address", async () => {
    incoming.headers = new Headers({ host: "3f2a9c1b:3000", "x-forwarded-host": "go.shop.example" });
    expect(await requestHost()).toBe("go.shop.example");
  });

  it("falls back to Host without a proxy in front", async () => {
    incoming.headers = new Headers({ host: "localhost:3000" });
    expect(await requestHost()).toBe("localhost:3000");
  });

  it("is null with neither", async () => {
    expect(await requestHost()).toBeNull();
  });
});
