import type { NextConfig } from "next";

// Every page refuses to be framed, so a hostile site cannot overlay the
// dashboard or the affiliate area and trick a click into a payout or settings
// change. Only the frame-ancestors directive is set: a full policy would have
// to account for every inline script Next emits, and framing is the whole risk
// being closed here. X-Frame-Options repeats it for browsers that ignore CSP.
const pageSecurityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
      // The tracking script and the endpoint it calls are loaded cross-site by
      // each Merchant's own pages, so they are left out of the page rules.
      {
        source: "/:path((?!track\\.js$|api/track$).*)",
        headers: pageSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
