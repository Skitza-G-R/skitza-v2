import { ImageResponse } from "next/og";

// Root OG image (1200x630). Surfaces when skitza.app is pasted into
// WhatsApp / iMessage / Slack / Twitter / LinkedIn / Telegram etc.
//
// Mirrors the landing-page hero (Hero() in apps/web/src/components/
// landing/landing-page.tsx) — Editorial Luxury vibe on a dark
// obsidian canvas: warm cream type, Syne extrabold grotesk, restrained
// amber accents, macro-whitespace.
//
// Design principles applied:
// - Inline period spans (not sibling flex items) so the amber period
//   sits right next to the word, not floating below the baseline.
// - Inner top-edge highlight on the "S" mark (inset white box-shadow)
//   simulates light hitting a physical machined surface — haptic depth.
// - Eyebrow pill (NOW BOOKING) before the H1 — premium editorial rhythm.
// - Amber "kicker" accent bar below the headline — the designed
//   punctuation that closes the typography block.
// - Hairline rule above the footer — editorial structural detail.
// - Loads Syne 800 + Outfit 500 from Google Fonts, glyph-subsetted to
//   only the characters we render (~5 KB each).
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

// Glyphs we render — keep in sync with the JSX so the subset stays minimal.
const SYNE_TEXT = "Sskitza.Oneapp.Yourwholestudio";
const OUTFIT_TEXT =
  "NOW BOOKING · EARLY ACCESS The producer dashboard that replaces Calendly, DocuSign, Stripe, Notion & WhatsApp.skitza.appBeta · Join the waiting listv1.0 — early access";

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
          padding: "76px 80px",
          backgroundColor: "#0E0D08",
          // Single amber bloom on the upper-right — Satori only accepts
          // one background-image layer. Restrained opacity keeps the
          // canvas reading as warm dark obsidian, not a colored field.
          backgroundImage:
            "radial-gradient(ellipse 60% 55% at 88% 22%, rgba(212,150,10,0.22) 0%, transparent 60%)",
          color: "#F2EDE6",
          fontFamily: "Outfit",
        }}
      >
        {/* ─── Top row: brand lockup ─────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* Amber "S" mark. Inner top highlight + outer warm glow give
              it the feeling of a machined amber tile catching light,
              rather than a flat colored block. */}
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 14,
              background: "#D4960A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#111009",
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 38,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              boxShadow:
                "inset 0 1.5px 0 rgba(255, 255, 255, 0.42), inset 0 -2px 0 rgba(0, 0, 0, 0.18), 0 14px 36px rgba(212, 150, 10, 0.45)",
            }}
          >
            S
          </div>
          {/* "skitza." wordmark — inline span for the amber period so
              it sits flush with the "a", no flex-item drift. */}
          <div
            style={{
              display: "flex",
              fontFamily: "Syne",
              fontSize: 44,
              fontWeight: 800,
              letterSpacing: "-1.4px",
              lineHeight: 1,
              color: "#F2EDE6",
            }}
          >
            <span>skitza</span>
            <span style={{ color: "#D4960A" }}>.</span>
          </div>
          {/* Version tag — subdued, sits to the right of the wordmark. */}
          <div
            style={{
              display: "flex",
              marginLeft: 18,
              fontSize: 16,
              fontWeight: 500,
              color: "rgba(242, 237, 230, 0.42)",
              letterSpacing: "0.02em",
            }}
          >
            v1.0 — early access
          </div>
        </div>

        {/* ─── Mid stack: eyebrow + headline + kicker + subhead ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          {/* Eyebrow pill — fully rounded per the editorial rhythm,
              subtle inner top highlight for haptic depth. */}
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: 10,
              padding: "7px 16px",
              borderRadius: 999,
              background: "rgba(212, 150, 10, 0.10)",
              border: "1px solid rgba(212, 150, 10, 0.32)",
              color: "#D4960A",
              fontFamily: "Outfit",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: 2,
              textTransform: "uppercase",
              boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 7,
                height: 7,
                borderRadius: 4,
                background: "#D4960A",
                boxShadow: "0 0 10px #D4960A",
              }}
            />
            Now booking · early access
          </div>

          {/* Huge headline — Syne 800. The amber "kicker" bar below
              acts as the singular brand-colored punctuation for the
              whole headline block (Editorial Luxury rhythm: one
              deliberate accent, not scattered punctuation glyphs).
              `whiteSpace: nowrap` keeps each line as one piece. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 80,
              lineHeight: 0.96,
              letterSpacing: "-0.038em",
              color: "#F2EDE6",
            }}
          >
            <div style={{ display: "flex", whiteSpace: "nowrap" }}>
              One app
            </div>
            <div style={{ display: "flex", whiteSpace: "nowrap" }}>
              Your whole studio
            </div>
          </div>

          {/* Amber kicker bar — the designed punctuation that closes
              the headline block. Glow shadow gives it the feeling of
              an emissive amber line, not flat color. */}
          <div
            style={{
              display: "flex",
              width: 96,
              height: 5,
              background: "#D4960A",
              borderRadius: 3,
              boxShadow: "0 0 28px rgba(212, 150, 10, 0.6)",
              marginTop: -4,
            }}
          />

          {/* Subhead — muted cream, tight measure so it sits clearly
              under the headline rather than spreading the full width. */}
          <div
            style={{
              display: "flex",
              fontFamily: "Outfit",
              fontSize: 22,
              fontWeight: 500,
              lineHeight: 1.45,
              letterSpacing: "-0.005em",
              color: "rgba(242, 237, 230, 0.6)",
              maxWidth: 840,
            }}
          >
            The producer dashboard that replaces Calendly, DocuSign, Stripe,
            Notion & WhatsApp.
          </div>
        </div>

        {/* ─── Footer: hairline + tagline row ─────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Hairline rule — editorial structural detail. */}
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 1,
              background: "rgba(242, 237, 230, 0.08)",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "Outfit",
              fontSize: 15,
              color: "rgba(242, 237, 230, 0.42)",
              letterSpacing: 2.4,
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {/* Inline-span domain so ".app" picks up the amber accent
                — same wordmark logic, miniaturised. */}
            <div style={{ display: "flex" }}>
              <span style={{ color: "rgba(242, 237, 230, 0.62)" }}>skitza</span>
              <span style={{ color: "#D4960A" }}>.app</span>
            </div>
            <div style={{ display: "flex" }}>Beta · Join the waiting list</div>
          </div>
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
