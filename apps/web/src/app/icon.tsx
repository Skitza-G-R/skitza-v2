import { ImageResponse } from "next/og";

// Favicon — the product brand mark: amber rounded square with a dark
// "S". Mirrors `<LogoMark>` (apps/web/src/components/brand/logo-mark.tsx)
// at 32px. Same shape, same colors as the sidebar mark and the landing
// lockup, so the browser tab, the WhatsApp / iMessage preview thumbnail,
// and the in-app sidebar all read as one brand.
//
// The amber glow on LogoMark is dropped here — at 16-32px it would clip
// to nothing. The solid amber + dark "S" stays legible at every favicon
// size (browser tab 16, retina 32, link preview 24-32).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontWeight: 800,
          fontSize: 22,
          lineHeight: 1,
          letterSpacing: "-0.04em",
        }}
      >
        S
      </div>
    ),
    size,
  );
}
