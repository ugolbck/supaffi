/**
 * Whether this instance is a developer's machine rather than a real install.
 *
 * Checks that depend on the outside world reaching us — DNS pointing here, a
 * certificate being issued, Stripe delivering a webhook — can never pass when
 * the app is only reachable on localhost. Gating on them there strands the
 * developer on a screen that will never turn green.
 *
 * Derived from NODE_ENV, which Next inlines at build time, so in the released
 * image this is the constant `false` and the branches below it are dead code.
 * It is deliberately not a runtime environment variable: that would be a
 * switch someone could flip on a real install to skip the very checks that
 * stop them handing out a link which does not resolve.
 *
 * Nothing security-bearing is behind this. Webhook signatures are verified
 * and sessions are authenticated exactly the same either way.
 */
export function isDevInstance(): boolean {
  return process.env.NODE_ENV !== "production";
}
