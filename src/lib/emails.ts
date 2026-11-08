import { headerSafe, type OutgoingEmail } from "@/lib/mail";

/**
 * Every email Supaffi sends, as plain text and as HTML built from the same
 * lines. Short on purpose: one thing happened, here is the figure, here is the
 * button. The look is the dashboard's: flat, square, one accent colour.
 *
 * Built from strings rather than a template library. Seven emails of a few
 * lines each do not need one, and every value a user typed goes through
 * `escape` on the HTML side.
 */

/** `value` sets a line apart in a grey box, for something to copy. */
type Block = { text: string; strong?: boolean; value?: boolean };
type Message = {
  to: string;
  /** Who it is from: the product's name. */
  product: string;
  subject: string;
  heading: string;
  lines: Block[];
  button?: { label: string; href: string } | null;
  /** Under the button, in small type. */
  footnote?: string;
};

const ACCENT = "#232dbe";
const TEXT = "#18181b";
const MUTED = "#71717a";
const BORDER = "#e4e4e7";
const PAGE = "#f4f4f5";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render(message: Message): OutgoingEmail {
  const text = [
    message.heading,
    "",
    ...message.lines.map((line) => line.text),
    ...(message.button ? ["", `${message.button.label}: ${message.button.href}`] : []),
    ...(message.footnote ? ["", message.footnote] : []),
    "",
    `${message.product}, via Supaffi`,
  ].join("\n");

  const paragraphs = message.lines
    .map((line) =>
      line.value
        ? `<p style="margin:0 0 16px;padding:10px 12px;background:${PAGE};border:1px solid ${BORDER};border-radius:2px;font-family:${MONO};font-size:14px;line-height:20px;color:${TEXT};word-break:break-all;">${escape(line.text)}</p>`
        : `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:${TEXT};${line.strong ? "font-weight:600;" : ""}">${escape(line.text)}</p>`
    )
    .join("");
  const button = message.button
    ? `<p style="margin:20px 0 0;"><a href="${escape(message.button.href)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;line-height:20px;padding:10px 16px;border-radius:2px;">${escape(message.button.label)}</a></p>`
    : "";
  const footnote = message.footnote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:${MUTED};">${escape(message.footnote)}</p>`
    : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(message.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${PAGE};font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid ${BORDER};border-radius:2px;">
<tr><td style="padding:24px 28px 0;font-size:13px;font-weight:500;color:${MUTED};">${escape(message.product)}</td></tr>
<tr><td style="padding:12px 28px 28px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;color:${TEXT};">${escape(message.heading)}</h1>
${paragraphs}${button}${footnote}
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:${MUTED};">Sent with Supaffi</p>
</td></tr></table>
</body></html>`;

  return { to: message.to, fromName: message.product, subject: message.subject, text, html };
}

/** Cleaned and capped: it goes into subjects and headings. */
function nameOf(affiliate: { name: string | null; email: string }): string {
  return headerSafe(affiliate.name?.trim() || affiliate.email);
}

export function newAffiliateEmail(args: {
  to: string;
  product: string;
  affiliate: { name: string | null; email: string };
  program: string;
  href: string | null;
}): OutgoingEmail {
  const name = nameOf(args.affiliate);
  return render({
    to: args.to,
    product: args.product,
    subject: `${name} joined your affiliate program`,
    heading: `${name} joined`,
    lines: [{ text: `${args.affiliate.email} signed up to ${args.program}.` }],
    button: args.href ? { label: "Open affiliate", href: args.href } : null,
  });
}

export function newSaleEmail(args: {
  to: string;
  product: string;
  affiliate: { name: string | null; email: string };
  sale: string | null;
  commission: string;
  payableOn: string;
  href: string | null;
}): OutgoingEmail {
  const name = nameOf(args.affiliate);
  return render({
    to: args.to,
    product: args.product,
    subject: `New sale from ${name}`,
    heading: args.sale ? `${name} brought a ${args.sale} sale` : `${name} brought a sale`,
    lines: [{ text: `Their commission is ${args.commission}, payable on ${args.payableOn}.` }],
    button: args.href ? { label: "Open commission", href: args.href } : null,
  });
}

export function flaggedSaleEmail(args: {
  to: string;
  product: string;
  affiliate: { name: string | null; email: string };
  commission: string;
  href: string | null;
}): OutgoingEmail {
  const name = nameOf(args.affiliate);
  return render({
    to: args.to,
    product: args.product,
    subject: `Check a sale from ${name}`,
    heading: `A sale from ${name} needs a look`,
    lines: [
      { text: `It looks like ${name} bought through their own link.` },
      { text: `The ${args.commission} commission is held until you decide.` },
    ],
    button: args.href ? { label: "Review sale", href: args.href } : null,
  });
}

export function welcomeEmail(args: {
  to: string;
  product: string;
  link: string;
  terms: string;
  /** The program's discount, when it has one to claim a promo code for. */
  discount?: string | null;
  href: string;
}): OutgoingEmail {
  return render({
    to: args.to,
    product: args.product,
    subject: `Welcome to the ${args.product} affiliate program`,
    heading: "You're in",
    lines: [
      { text: `You earn ${args.terms}. Share your link:` },
      { text: args.link, value: true },
      ...(args.discount ? [{ text: `Your audience can also get ${args.discount} with a promo code of your own. Claim it from your dashboard.` }] : []),
    ],
    button: { label: "Open your dashboard", href: args.href },
  });
}

export function earnedEmail(args: {
  to: string;
  product: string;
  commission: string;
  payableOn: string;
  href: string;
}): OutgoingEmail {
  return render({
    to: args.to,
    product: args.product,
    subject: `You earned ${args.commission}`,
    heading: `You earned ${args.commission}`,
    lines: [{ text: `Someone you referred bought ${args.product}. It's payable on ${args.payableOn}.` }],
    button: { label: "See commissions", href: args.href },
  });
}

export function paidEmail(args: { to: string; product: string; amount: string; href: string }): OutgoingEmail {
  return render({
    to: args.to,
    product: args.product,
    subject: `${args.product} paid you ${args.amount}`,
    heading: `You were paid ${args.amount}`,
    lines: [{ text: `${args.product} sent your payout.` }],
    button: { label: "See payouts", href: args.href },
  });
}

export function passwordLinkEmail(args: { to: string; product: string; href: string; validFor: string }): OutgoingEmail {
  return render({
    to: args.to,
    product: args.product,
    subject: `Set your ${args.product} password`,
    heading: "Set your password",
    lines: [{ text: `Use this button to set a password for your ${args.product} affiliate account.` }],
    button: { label: "Set password", href: args.href },
    footnote: `The link works once, within ${args.validFor}. If you didn't ask for it, ignore this email.`,
  });
}

export function testEmail(args: { to: string }): OutgoingEmail {
  return render({
    to: args.to,
    product: "Supaffi",
    subject: "Supaffi can send email",
    heading: "Email works",
    lines: [{ text: "This is the test email from your Supaffi account settings." }],
  });
}
