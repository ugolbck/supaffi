// The catalogue the integrations picker renders. Only providers that work: a
// greyed-out card for something that does not exist yet is an advert, not a
// choice, and it made connecting the one real provider look optional.
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
   * (Stripe's purple app icon). "glyph" is a bare mark on transparent and
   * needs a surface of its own.
   */
  logoKind?: "tile" | "glyph";
  /**
   * How much of its own canvas the glyph's ink actually spans, measured off
   * the file. Resend's mark occupies half its canvas, so rendering it at the
   * target size would draw it half the size of a mark that fills its own
   * canvas. Dividing the target size by this cancels the file's own padding.
   */
  logoInk?: number;
  /** Brand colour, used for the card's wash and the glyph tile's fill. */
  tint: string;
};

export const PAYMENT_PROVIDERS: Provider[] = [
  {
    id: "stripe",
    name: "Stripe",
    blurb: "Reads your payments and refunds.",
    logo: "stripe.svg",
    logoKind: "tile",
    tint: "#635bff",
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
  },
];
