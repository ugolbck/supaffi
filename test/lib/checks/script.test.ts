import { describe, it, expect } from "vitest";
import { scriptFound } from "@/lib/checks/script";

const page = (html: string) => (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;

const streamedPage = (chunks: string[]) =>
  (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      })
    )) as unknown as typeof fetch;

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

  it("caps the read at 2 MB while streaming, not after", async () => {
    const pad = "x".repeat(512 * 1024); // 512 KB
    const tag = `<script src="https://affiliates.instantgradient.com/track.js"></script>`;

    // Four 512 KB chunks land the tag chunk right at the 2 MB mark: a real
    // cap stops reading before it, a slice-after-the-fact would still see it.
    const beyondCap = await scriptFound(
      "https://instantgradient.com",
      "affiliates.instantgradient.com",
      streamedPage([pad, pad, pad, pad, tag])
    );
    expect(beyondCap.ok).toBe(false);
    expect(beyondCap.detail).toMatch(/not found/i);

    // One oversized chunk crosses the cap on its own, so the loop cannot stop
    // before reading it. The tag sits past the cap inside that same chunk.
    const overshooting = await scriptFound(
      "https://instantgradient.com",
      "affiliates.instantgradient.com",
      streamedPage([pad.repeat(5) + tag])
    );
    expect(overshooting.ok).toBe(false);

    const beforeCap = await scriptFound(
      "https://instantgradient.com",
      "affiliates.instantgradient.com",
      streamedPage([tag, pad, pad])
    );
    expect(beforeCap.ok).toBe(true);
  });
});
