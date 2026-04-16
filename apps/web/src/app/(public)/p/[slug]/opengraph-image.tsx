import { ImageResponse } from "next/og";

import { loadProducerPortfolio } from "./load-portfolio";

// Per-producer OG image. Renders the producer's display name as the hero
// so a shared `/p/<slug>` URL previews with their brand, not the app's.
//
// Route params arrive typed by Next based on the enclosing dynamic segment.
export const alt = "Producer portfolio on Skitza";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function ProducerOgImage({ params }: { params: { slug: string } }) {
  const data = await loadProducerPortfolio(params.slug);
  // 404 producers get a generic image — the bot is already being sent to
  // a not-found page, but caching layers may still try to fetch this.
  const displayName = data?.producer.displayName ?? "Producer";
  const trackCount = data?.tracks.length ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background:
            "radial-gradient(ellipse at 15% 15%, rgba(34,197,94,0.22) 0%, transparent 55%), radial-gradient(ellipse at 90% 90%, rgba(245,158,11,0.20) 0%, transparent 55%), #0b0b0d",
          color: "#f5f4f0",
        }}
      >
        <div
          style={{
            fontSize: 22,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: "#a8a6a0",
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: "#22c55e",
            }}
          />
          Portfolio · {trackCount} track{trackCount === 1 ? "" : "s"}
        </div>
        <div
          style={{
            fontSize: 144,
            fontWeight: 700,
            lineHeight: 0.95,
            letterSpacing: -5,
            maxWidth: 1000,
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            color: "#6e6c68",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "#16161a",
                border: "1px solid #3c3c44",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  border: "2px solid #22c55e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ width: 4, height: 4, borderRadius: 2, background: "#22c55e" }} />
              </div>
            </div>
            <div>Skitza</div>
          </div>
          <div style={{ letterSpacing: 3, textTransform: "uppercase" }}>
            skitza.app/p/{params.slug}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
