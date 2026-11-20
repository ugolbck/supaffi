import { installedClient } from "@/extensions/installed-client";

// Next.js runs this in the browser before the app becomes interactive. A
// failing hook is logged and never stops the app from starting.
try {
  installedClient.start?.();
} catch (err) {
  console.error("[instrumentation] browser start hook failed", err);
}
