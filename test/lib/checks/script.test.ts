import { describe, it, expect } from "vitest";
import { scriptFound } from "@/lib/checks/script";

const page = (html: string) => (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;

describe("scriptFound", () => {
  it("finds the tag", async () => {
    const result = await scriptFound("https://instantgradient.com", "affiliates.instantgradient.com",
      page(`<html><head><script src="https://affiliates.instantgradient.com/track.js" async></script></head></html>`));
    expect(result.ok).toBe(true);
  });

  it("finds it with single quotes and extra attributes", async () => {
    const result = await scriptFound("https://instantgradient.com", "affiliates.instantgradient.com",
      page(`<script defer data-x='1' src='https://affiliates.instantgradient.com/track.js'></script>`));
    expect(result.ok).toBe(true);
  });

  it("does not match a different product's script", async () => {
    const result = await scriptFound("https://instantgradient.com", "affiliates.instantgradient.com",
      page(`<script src="https://affiliates.mokkit.co/track.js"></script>`));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/not found/i);
  });

  it("reports an unreachable site", async () => {
    const result = await scriptFound("https://instantgradient.com", "affiliates.instantgradient.com",
      (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/could not load/i);
  });

  it("refuses a non-http website url", async () => {
    const result = await scriptFound("file:///etc/passwd", "affiliates.instantgradient.com", page(""));
    expect(result.ok).toBe(false);
  });
});
