import { describe, it, expect } from "vitest";
import { developerBrief } from "@/lib/developerBrief";

describe("developerBrief", () => {
  it("contains both snippets and says where each goes", () => {
    const brief = developerBrief({
      productName: "InstantGradient",
      websiteUrl: "https://instantgradient.com",
      scriptTag: "<script src=\"https://affiliates.instantgradient.com/track.js\" async></script>",
      checkoutSnippet: "const referralToken = cookies.get(\"supaffi_ref\");",
    });
    expect(brief).toContain("<script src=");
    expect(brief).toContain("supaffi_ref");
    expect(brief).toMatch(/head of every page/i);
    expect(brief).toMatch(/Checkout Session/);
    expect(brief).not.toContain("—");
  });
});
