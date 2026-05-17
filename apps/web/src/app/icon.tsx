import { ImageResponse } from "next/og";

// Favicon — Skitza's product mark: amber rounded square with a Syne
// extrabold "S". Mirrors `<LogoMark>` (apps/web/src/components/brand/
// logo-mark.tsx) and the landing nav lockup.
//
// The "S" character is distinctive — Syne 800 has a heavy, geometric
// stroke that reads as Skitza. System-ui bold "S" falls back to SF Pro
// / Segoe / Cantarell which all look generic, so we fetch the actual
// Syne font from Google Fonts at runtime. The font fetch only fires
// when this image is generated; after that the PNG is edge-cached.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

async function loadGoogleFont(
  family: string,
  text: string,
): Promise<ArrayBuffer> {
  // `text=` narrows the font subset to just the glyphs we need so the
  // fetched file is < 5 KB instead of the full ~100 KB Syne payload.
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

export default async function Icon() {
  const syne = await loadGoogleFont("Syne:wght@800", "S");
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: "#D4960A",
          borderRadius: 7,
          color: "#111009",
          fontFamily: "Syne",
          fontWeight: 800,
          fontSize: 22,
          lineHeight: 1,
          letterSpacing: "-0.04em",
        }}
      >
        S
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Syne", data: syne, weight: 800, style: "normal" }],
    },
  );
}
