import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/track.js/route";
import { REFERRAL_COOKIE } from "@/lib/referral";

async function script(origin = "https://example.com"): Promise<string> {
  const res = await GET(new NextRequest(`${origin}/track.js`));
  return res.text();
}

describe("track.js", () => {
  it("writes the cookie under the namespaced name", async () => {
    // The Merchant's own auth provider shares this cookie jar, so the name has
    // to be one nothing else picks by accident.
    expect(await script()).toContain(`"${REFERRAL_COOKIE}="`);
  });

  it("never sends SameSite=None, which would make the cookie cross-site", async () => {
    const code = await script();
    expect(code).toContain("SameSite=Lax");
    expect(code).not.toContain("SameSite=None");
  });

  it("adds Secure at runtime rather than baking it in", async () => {
    // A Secure cookie on a plain-HTTP dev site is dropped with no error, and
    // tracking would fail in a way nobody can see. The script decides on the
    // page it actually runs on, not on the scheme this route was served over.
    const code = await script();
    expect(code).toContain('window.location.protocol === "https:" ? "; Secure" : ""');
  });

  it("bakes in the origin it was served from", async () => {
    expect(await script("https://acme.test")).toContain("https://acme.test/api/track?ref=");
  });
});
