import { ImageResponse } from "next/og";

// OG image for the root / landing page. 1200x630 is Facebook + Twitter's
// recommended resolution. Next 15 auto-generates <meta property="og:image">
// pointing at `/opengraph-image` when this file exists.
//
// We don't load external fonts here — ImageResponse uses the runtime's
// default Noto Sans (bundled). Fraunces would be nicer but each font file
// costs cold-start latency on every build. Good enough for v1.
export const alt = "Skitza — the studio in one link";
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
          background: "radial-gradient(ellipse at 20% 10%, rgba(34,197,94,0.18) 0%, transparent 55%), radial-gradient(ellipse at 95% 85%, rgba(245,158,11,0.15) 0%, transparent 55%), #0b0b0d",
          color: "#f5f4f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#16161a",
              border: "1px solid #3c3c44",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                border: "3px solid #22c55e",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 5, background: "#22c55e" }} />
            </div>
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>Skitza</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 500,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#22c55e",
            }}
          >
            For independent music producers
          </div>
          <div
            style={{
              fontSize: 112,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: -4,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div>The studio,</div>
            <div style={{ color: "#22c55e", fontStyle: "italic" }}>in one link.</div>
          </div>
          <div style={{ fontSize: 26, color: "#a8a6a0", maxWidth: 880 }}>
            Booking, portfolio, contracts, collaboration, payments — all behind a single magic link.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            color: "#6e6c68",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          <div>skitza.app</div>
          <div>Beta · Free during launch</div>
        </div>
      </div>
    ),
    size,
  );
}
