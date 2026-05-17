import { ImageResponse } from "next/og";

// Root OG image (1200x630). Surfaces when skitza.app is pasted into
// WhatsApp / iMessage / Slack / Twitter / LinkedIn / Telegram etc.
//
// Mirrors the landing-page hero (Hero() in apps/web/src/components/
// landing/landing-page.tsx, 2026-05-17):
// - Same obsidian background (#111009) with the warm cream type
// - Same "NOW BOOKING · EARLY ACCESS" amber pill with glowing dot
// - Same H1 — "One app. Your whole studio." — with amber periods
// - Same lockup: amber "S" square + lowercase "skitza." wordmark
// - Same subhead copy
// Anyone who sees the link preview and then clicks through lands on a
// page that visually continues the same composition — no whiplash.
//
// Loads Syne extrabold from Google Fonts so the "S" mark and the
// headline read with the brand's actual geometric weight, not a
// generic system-ui bold. Outfit is loaded for the pill / subhead /
// footer so they match the body type stack. Both are subset to only
// the glyphs we render here (≈ 5 KB each instead of full payloads).
export const alt =
  "Skitza — one app. Your whole studio. Business automation for music producers.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadGoogleFont(
  family: string,
  text: string,
): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`;
  const css = await (
    await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    })
  ).text();
  const match = css.match(
    /src: url\((.+?)\) format\('(opentype|truetype|woff2?)'\)/,
  );
  const fontUrl = match?.[1];
  if (!fontUrl) throw new Error(`failed to find font src for ${family}`);
  const fontRes = await fetch(fontUrl);
  if (!fontRes.ok) {
    throw new Error(`failed to fetch font file (${String(fontRes.status)})`);
  }
  return await fontRes.arrayBuffer();
}

// All Syne glyphs we render — keep in sync with the JSX below so the
// subset request stays minimal.
const SYNE_TEXT =
  "Sskitza.Oneapp.Yourwholestudio.NOWBOKIG·EARLYACCS";
// All Outfit glyphs we render across the pill, subhead, and footer.
const OUTFIT_TEXT =
  "NOW BOOKING · EARLY ACCESS The producer dashboard that replaces Calendly, DocuSign, Stripe, Notion & WhatsApp. One link, one inbox, one bill — sessions book themselves and the mix delivers itself the moment the invoice clears.skitza.appBeta · Join the waiting listv1.0 — early access";

export default async function OgImage() {
  const [syne, outfit] = await Promise.all([
    loadGoogleFont("Syne:wght@800", SYNE_TEXT),
    loadGoogleFont("Outfit:wght@500", OUTFIT_TEXT),
  ]);

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
          backgroundColor: "#111009",
          // Amber bloom on the right — mirrors the hero's amber halo.
          // Satori accepts a single background-image layer.
          backgroundImage:
            "radial-gradient(ellipse at 92% 30%, rgba(212,150,10,0.20) 0%, transparent 55%)",
          color: "#F2EDE6",
          fontFamily: "Outfit",
        }}
      >
        {/* Top row: brand lockup. Same as the landing nav. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          {/* Amber "S" square — the product mark. */}
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
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 42,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              boxShadow: "0 10px 28px rgba(212, 150, 10, 0.4)",
            }}
          >
            S
          </div>
          {/* Lowercase "skitza." wordmark with amber period. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              fontFamily: "Syne",
              fontSize: 48,
              fontWeight: 800,
              letterSpacing: "-1.6px",
              lineHeight: 1,
              color: "#F2EDE6",
            }}
          >
            <div style={{ display: "flex" }}>skitza</div>
            <div style={{ display: "flex", color: "#D4960A" }}>.</div>
          </div>
          {/* Version tag — sits in the gap to the right, mono feel. */}
          <div
            style={{
              display: "flex",
              marginLeft: 18,
              fontSize: 18,
              fontWeight: 500,
              color: "rgba(242, 237, 230, 0.5)",
              letterSpacing: "0.02em",
            }}
          >
            v1.0 — early access
          </div>
        </div>

        {/* Middle stack: pill + headline + subhead. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {/* "NOW BOOKING · EARLY ACCESS" amber pill with glowing dot. */}
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: 10,
              padding: "8px 16px",
              borderRadius: 8,
              background: "rgba(212, 150, 10, 0.14)",
              border: "1px solid rgba(212, 150, 10, 0.35)",
              color: "#D4960A",
              fontFamily: "Outfit",
              fontSize: 16,
              fontWeight: 500,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 8,
                height: 8,
                borderRadius: 4,
                background: "#D4960A",
                boxShadow: "0 0 12px #D4960A",
              }}
            />
            Now booking · early access
          </div>

          {/* Huge headline — matches the H1 on the landing hero
              (clamp 44/5.4vw/76px). On the 1200px OG card we have
              ~1056px content width; at 80px Syne 800 with
              letterSpacing -0.038em, the longer "Your whole studio."
              line measures ~870px and fits comfortably on one line.
              `alignItems: baseline` so the amber period sits on the
              text baseline, not the stretched flex-item top. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 80,
              lineHeight: 0.95,
              letterSpacing: "-0.038em",
              color: "#F2EDE6",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ display: "flex", whiteSpace: "nowrap" }}>
                One app
              </div>
              <div style={{ display: "flex", color: "#D4960A" }}>.</div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ display: "flex", whiteSpace: "nowrap" }}>
                Your whole studio
              </div>
              <div style={{ display: "flex", color: "#D4960A" }}>.</div>
            </div>
          </div>

          {/* Subhead — same copy as the hero, muted cream. */}
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 500,
              lineHeight: 1.45,
              letterSpacing: "-0.005em",
              color: "rgba(242, 237, 230, 0.62)",
              maxWidth: 920,
            }}
          >
            The producer dashboard that replaces Calendly, DocuSign, Stripe,
            Notion & WhatsApp.
          </div>
        </div>

        {/* Footer row: domain + waiting-list tag. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "Outfit",
            fontSize: 18,
            color: "rgba(242, 237, 230, 0.45)",
            letterSpacing: 2,
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          <div style={{ display: "flex" }}>skitza.app</div>
          <div style={{ display: "flex" }}>Beta · Join the waiting list</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Syne", data: syne, weight: 800, style: "normal" },
        { name: "Outfit", data: outfit, weight: 500, style: "normal" },
      ],
    },
  );
}
