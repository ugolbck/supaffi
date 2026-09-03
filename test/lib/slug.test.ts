import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and joins words with a single hyphen", () => {
    expect(slugify("IG DEV")).toBe("ig-dev");
    expect(slugify("Acme   Analytics")).toBe("acme-analytics");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugify("Café Créme")).toBe("cafe-creme");
  });

  it("never starts or ends with a separator", () => {
    expect(slugify("  --Hello, World!  ")).toBe("hello-world");
  });

  it("leaves no trailing separator behind when the cap falls on one", () => {
    // The 48-character cap can land mid-separator, which would otherwise
    // produce a slug ending in a hyphen.
    const name = "a".repeat(47) + " tail";
    expect(slugify(name).endsWith("-")).toBe(false);
  });

  it("returns an empty string when there is nothing to slugify", () => {
    // The caller decides the fallback, since it differs per model.
    expect(slugify("!!!")).toBe("");
  });
});

describe("uniqueSlug", () => {
  it("uses the plain slug when it is free", async () => {
    expect(await uniqueSlug("Docs", "product", async () => false)).toBe("docs");
  });

  it("walks to the first free suffix", async () => {
    const taken = new Set(["docs", "docs-2"]);
    expect(await uniqueSlug("Docs", "product", async (c) => taken.has(c))).toBe("docs-3");
  });

  it("falls back when the name has nothing sluggable in it", async () => {
    expect(await uniqueSlug("???", "product", async () => false)).toBe("product");
  });
});
