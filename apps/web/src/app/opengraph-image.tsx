import { ImageResponse } from "next/og";

// Root OG image (1200x630). Surfaces when skitza.app is pasted into
// WhatsApp / iMessage / Slack / Twitter / LinkedIn etc.
//
// Brand parity with the landing page (apps/web/src/components/landing/
// landing-page.tsx):
// - The lockup is `<LogoMark>` (amber rounded square with "S") + the
//   lowercase "skitza." wordmark with an amber period — same identity
//   the user sees the moment they click through.
// - The thin amber rule before the small-caps tagline is the editorial
//   "brand line" accent — same rhythm the landing hero uses.
// - Cream canvas + amber bloom corner is the locked palette
//   (--surface-base #F2EDE6, --brand-primary #D4960A).
//
// No custom font loading: Satori falls back to system-ui weight-800
// which renders close enough to Syne extrabold at this size. If we
// later want pixel-perfect Syne, we'd add a `fetch` of the Google Font
// here and pass it to `ImageResponse({ fonts })`.
export const alt = "Skitza — business automation for music producers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#F2EDE6",
          // Satori accepts only one background-image layer — pair a
          // solid base with a single radial gradient for the amber bloom.
          backgroundImage:
            "radial-gradient(ellipse at 85% 15%, rgba(212,150,10,0.32) 0%, transparent 60%)",
          color: "#1A1714",
        }}
      >
        {/* Brand lockup: amber "S" square + lowercase "skitza." wordmark
            with the signature amber period. Matches the landing nav. */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#D4960A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#111009",
              fontWeight: 800,
              fontSize: 40,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              boxShadow: "0 10px 28px rgba(212, 150, 10, 0.35)",
            }}
          >
            S
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              fontSize: 48,
              fontWeight: 800,
              letterSpacing: "-1.4px",
              lineHeight: 1,
            }}
          >
            <div style={{ display: "flex" }}>skitza</div>
            <div style={{ display: "flex", color: "#D4960A" }}>.</div>
          </div>
        </div>

        {/* Headline block. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* "Brand line" — thin amber rule + small-caps tagline.
              The rule is the editorial accent that ties the card to the
              landing-page rhythm. */}
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                width: 56,
                height: 3,
                background: "#D4960A",
                borderRadius: 2,
              }}
            />
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: "#B06830",
              }}
            >
              Business automation for music producers
            </div>
          </div>

          {/* Big headline — same copy as the landing hero. */}
          <div
            style={{
              fontSize: 116,
              fontWeight: 800,
              lineHeight: 0.98,
              letterSpacing: -4,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div>Stop chasing payments.</div>
            <div style={{ color: "#D4960A", fontStyle: "italic" }}>
              Just make music.
            </div>
          </div>

          {/* Subhead. */}
          <div style={{ fontSize: 26, color: "#6B6560", maxWidth: 940 }}>
            The only link you need. Clients book, sign, and pay automatically.
          </div>
        </div>

        {/* Footer wordmark row. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 20,
            color: "#8C8880",
            letterSpacing: 2,
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          <div>skitza.app</div>
          <div>Beta · Join the waiting list</div>
        </div>
      </div>
    ),
    size,
  );
}
