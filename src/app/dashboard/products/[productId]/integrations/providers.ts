// The catalogue the integrations picker renders. Planned providers are listed
// but unavailable on purpose: one lone option reads as a hidden requirement,
// several read as a choice.
export type Provider = {
  id: string;
  name: string;
  blurb: string;
  /**
   * Filename under /public/logos, extension included, because these come
   * straight from each brand's press kit and are not all SVG.
   */
  logo?: string;
  /**
   * "tile" artwork ships its own background and fills the square edge to edge
   * (Stripe's purple app icon, Paddle's yellow one). "glyph" is a bare mark on
   * transparent and needs a surface of its own.
   */
  logoKind?: "tile" | "glyph";
  /**
   * How much of its own canvas the glyph's ink actually spans, measured off
   * the file. Resend's mark occupies half its canvas and Polar's fills it
   * completely, so rendering both at one scale makes Resend half the size of
   * Polar. Dividing the target size by this cancels each file's own padding.
   */
  logoInk?: number;
  /** Brand colour, used for the card's wash and the glyph tile's fill. */
  tint: string;
  status: "available" | "planned";
};

export const PAYMENT_PROVIDERS: Provider[] = [
  {
    id: "stripe",
    name: "Stripe",
    blurb: "Reads your payments and refunds.",
    logo: "stripe.svg",
    logoKind: "tile",
    tint: "#635bff",
    status: "available",
  },
  {
    id: "paddle",
    name: "Paddle",
    blurb: "Merchant of record billing.",
    logo: "paddle.jpeg",
    logoKind: "tile",
    tint: "#ffdd00",
    status: "planned",
  },
  {
    id: "polar",
    name: "Polar",
    blurb: "Billing for developers.",
    logo: "polar.svg",
    logoKind: "glyph",
    logoInk: 1,
    tint: "#0062ff",
    status: "planned",
  },
];

export const EMAIL_PROVIDERS: Provider[] = [
  {
    id: "resend",
    name: "Resend",
    blurb: "Sends affiliates their login links.",
    logo: "resend.svg",
    logoKind: "glyph",
    logoInk: 0.5,
    tint: "#000000",
    status: "available",
  },
  {
    id: "smtp",
    name: "SMTP",
    blurb: "Your own mail server.",
    tint: "#71717a",
    status: "planned",
  },
];
