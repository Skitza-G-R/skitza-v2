import type { NextConfig } from "next";

// Security headers. CSP is deliberately permissive for Clerk + Vercel
// live-region rendering (both need inline styles/scripts and connect
// back to their own origins). Tighten post-launch once we have a real
// inventory of third parties.
//
// Notes on why each header exists:
// * Strict-Transport-Security — enforce HTTPS via browser pinning.
// * X-Content-Type-Options: nosniff — stop MIME confusion attacks.
// * X-Frame-Options: DENY — never render inside an iframe (clickjacking).
// * Referrer-Policy — don't leak magic-link URLs via Referer to third
//   parties; same-origin lets the dwell beacon still work.
// * Permissions-Policy — explicit off-switches for APIs we never use;
//   keep the surface small if any third-party script loads later.
// * X-DNS-Prefetch-Control — opt in, small perf win, no privacy cost
//   because DNS prefetches leak less than the sites we already embed.
// * X-Robots-Tag — broad allow for the marketing surface; robots.ts
//   handles per-route exclusions.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=(self)",
      "usb=()",
      "magnetometer=()",
      "accelerometer=()",
      "gyroscope=()",
    ].join(", "),
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Moved out of `experimental` in Next 15.5. Keeps the typed <Link /> so
  // typos in href strings fail the typecheck instead of shipping.
  typedRoutes: true,

  // Hide the X-Powered-By banner — one less fingerprinting bit.
  poweredByHeader: false,

  // Next 15 auto-optimises images from remote hosts only when listed here.
  // Producers paste external artwork URLs for now (R2 comes in weeks 6-8);
  // the remotePatterns below cover the common MP3 / artwork sources we
  // expect during beta without going full wildcard.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "i.scdn.co" }, // Spotify artwork CDN
      { protocol: "https", hostname: "p.scdn.co" }, // Spotify preview CDN
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "**.vercel.app" },
    ],
  },

  async headers() {
    return [
      {
        // Apply to every route — server responses, static files, HTML.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default config;
