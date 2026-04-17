import { ImageResponse } from "next/og";

// Root OG image (1200x630). Warm cream bg + amber blob, bold headline
// matching the landing: "Stop chasing payments. Just make music."
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
            "radial-gradient(ellipse at 85% 15%, rgba(212,150,10,0.28) 0%, transparent 60%)",
          color: "#1A1714",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#FFFBF5",
              border: "1px solid rgba(0,0,0,0.12)",
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
                border: "3px solid #D4960A",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 5, background: "#D4960A" }} />
            </div>
          </div>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>Skitza</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 500,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#B06830",
            }}
          >
            Business automation for music producers
          </div>
          <div
            style={{
              fontSize: 112,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: -4,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div>Stop chasing payments.</div>
            <div style={{ color: "#D4960A", fontStyle: "italic" }}>Just make music.</div>
          </div>
          <div style={{ fontSize: 26, color: "#6B6560", maxWidth: 940 }}>
            The only link you need. Clients book, sign, and pay automatically.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            color: "#8C8880",
            letterSpacing: 2,
            textTransform: "uppercase",
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
