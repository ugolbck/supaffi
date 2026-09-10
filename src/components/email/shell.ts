// A function, not a component: this produces the HTML string Resend sends,
// never anything React renders in a browser. Mail clients strip an external
// stylesheet, a web font and most images on arrival, so the layout is a
// table, every rule is inline, and colours are the literal hex values from
// `src/app/globals.css` (no CSS variable survives into an inbox either).

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes only the character that could break out of a double-quoted HTML
 * attribute. Not full HTML-escaping: `&` is left alone on purpose, so a
 * query string (`?token=abc&ref=1`) still reaches the link verbatim, which
 * is what makes it work. Every caller in this codebase builds `href` from
 * trusted, already-encoded URLs, but this module is a general shell for
 * whatever mail comes next, so the one genuinely dangerous character is
 * escaped defensively rather than assumed away.
 */
function escapeHrefAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export type EmailShellInput = {
  merchantName: string;
  heading: string;
  body: string;
  /**
   * A URL, not display text: emitted verbatim except for a double quote,
   * which is escaped so it cannot end the `href` attribute early.
   */
  action?: { label: string; href: string };
};

/**
 * The one shell every outbound email is built from: the merchant's name as
 * plain text, one heading, one paragraph, one button. Nothing else — no
 * footer, no logo, no second link, so nothing here can imply the email said
 * more than it did.
 */
export function emailShell(input: EmailShellInput): string {
  const merchantName = escapeHtml(input.merchantName);
  const heading = escapeHtml(input.heading);
  const body = escapeHtml(input.body);

  const button = input.action
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 0; border-collapse: collapse;">
                <tr>
                  <td bgcolor="#232dbe" style="background-color: #232dbe; border-radius: 10px;">
                    <a href="${escapeHrefAttribute(input.action.href)}" style="display: inline-block; padding: 11px 22px; font-family: ${FONT_STACK}; font-size: 14px; font-weight: 600; color: #f2f4fe; text-decoration: none; border-radius: 10px;">${escapeHtml(input.action.label)}</a>
                  </td>
                </tr>
              </table>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin: 0; padding: 0; background-color: #f4f4f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5; border-collapse: collapse;">
      <tr>
        <td align="center" style="padding: 40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width: 480px; max-width: 100%; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; border-collapse: separate;">
            <tr>
              <td style="padding: 32px;">
                <p style="margin: 0 0 20px; font-family: ${FONT_STACK}; font-size: 13px; line-height: 18px; font-weight: 600; color: #71717a;">${merchantName}</p>
                <h1 style="margin: 0 0 12px; font-family: ${FONT_STACK}; font-size: 20px; line-height: 28px; font-weight: 600; color: #18181b;">${heading}</h1>
                <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 14px; line-height: 22px; color: #3f3f46;">${body}</p>${button}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
