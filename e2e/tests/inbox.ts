import { expect } from "@playwright/test";

// Reads what the app sent from Mailpit's API (docker-compose.yml).
const MAILPIT = "http://127.0.0.1:8025/api/v1";

type Found = { ID: string; Subject: string; To: { Address: string }[] };

/** Waits for an email to `to` whose subject matches, and answers its text. */
export async function email(to: string, subject: string | RegExp): Promise<{ subject: string; text: string }> {
  let found: Found | undefined;
  await expect(async () => {
    const res = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: Found[] };
    found = messages.find((m) => (typeof subject === "string" ? m.Subject === subject : subject.test(m.Subject)));
    expect(found, `an email to ${to} matching ${subject}`).toBeTruthy();
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000] });
  const message = (await (await fetch(`${MAILPIT}/message/${found!.ID}`)).json()) as { Subject: string; Text: string };
  return { subject: message.Subject, text: message.Text };
}

/** The first link in an email's text that starts with `prefix`. */
export function linkIn(text: string, prefix: string): string {
  const link = text.split(/\s+/).find((word) => word.startsWith(prefix));
  if (!link) throw new Error(`No ${prefix} link in: ${text}`);
  return link;
}
