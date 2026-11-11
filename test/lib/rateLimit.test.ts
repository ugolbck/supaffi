import { describe, it, expect } from "vitest";
import { windowLimit } from "@/lib/rateLimit";

const WINDOW_MS = 60_000;
const T0 = 1_700_000_000_000;

let counter = 0;
function limit(eviction?: "oldest" | "fewestHits") {
  counter += 1;
  const created = windowLimit({ name: `rate-limit-test-${counter}`, windowMs: WINDOW_MS, max: 3, maxTracked: 3, eviction });
  created.reset();
  return created;
}

function spend(l: ReturnType<typeof limit>, key: string, times: number, at = T0): void {
  for (let i = 0; i < times; i += 1) l.hit(key, at);
}

describe("windowLimit eviction", () => {
  it("drops the first-seen key by default", () => {
    const l = limit();
    spend(l, "a", 3);
    spend(l, "b", 1);
    spend(l, "c", 1);
    spend(l, "d", 1);
    expect(l.allows("a", T0)).toBe(true);
  });

  it("with fewestHits, drops the key with the fewest hits and keeps one at the limit", () => {
    const l = limit("fewestHits");
    spend(l, "a", 3);
    spend(l, "b", 2);
    spend(l, "c", 1);
    spend(l, "d", 1);
    expect(l.allows("a", T0)).toBe(false);
    spend(l, "b", 1);
    expect(l.allows("b", T0)).toBe(false);
  });

  it("with fewestHits, refuses a new key while every tracked key is at the limit", () => {
    const l = limit("fewestHits");
    spend(l, "a", 3);
    spend(l, "b", 3);
    spend(l, "c", 3);
    expect(l.allows("d", T0)).toBe(false);
    l.hit("d", T0);
    expect(l.allows("a", T0)).toBe(false);
    expect(l.allows("d", T0 + WINDOW_MS)).toBe(true);
  });
});
