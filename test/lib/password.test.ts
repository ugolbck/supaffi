import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  verifyAgainstNoAccount,
  limitConcurrency,
  ConcurrencyLimitError,
} from "@/lib/password";

describe("password", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("refuses every password when there is no account to check against", async () => {
    expect(await verifyAgainstNoAccount("correct horse battery staple")).toBe(false);
    expect(await verifyAgainstNoAccount("")).toBe(false);
  });
});

describe("limitConcurrency", () => {
  it("never runs more than the limit at once, and runs everything eventually", async () => {
    // Each Argon2 call holds 64 MiB, so a burst of logins must queue rather
    // than all start together.
    const run = limitConcurrency(2);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return i;
        })
      )
    );
    expect(peak).toBe(2);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("turns callers away at once when the queue is full, and serves them again after", async () => {
    // An unbounded queue let a flood of logins push the Owner's own attempt
    // back until it timed out.
    const run = limitConcurrency(1, 2);
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => (release = resolve));
    const running = run(() => blocker);
    const queued = [run(async () => "a"), run(async () => "b")];
    await expect(run(async () => "c")).rejects.toBeInstanceOf(ConcurrencyLimitError);
    release();
    await running;
    expect(await Promise.all(queued)).toEqual(["a", "b"]);
    expect(await run(async () => "d")).toBe("d");
  });

  it("frees the slot when the work throws", async () => {
    const run = limitConcurrency(1);
    await expect(run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await run(async () => "next")).toBe("next");
  });
});
