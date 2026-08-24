import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()",
  },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,

  // The admin console opens interactive Neon sessions (the per-email advisory
  // lock behind Producer invitations and beta wave releases), which use the
  // Node `ws` package. If Next bundles it, Webpack replaces ws's optional
  // `bufferutil` dependency with an empty module; ws then calls a missing
  // `.mask()` and the function is killed mid-request, so the invitation
  // surfaces as an unexplained failure. apps/web carries the same opt-out.
  serverExternalPackages: ["ws"],
  env: {
    WS_NO_BUFFER_UTIL: "1",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default config;
