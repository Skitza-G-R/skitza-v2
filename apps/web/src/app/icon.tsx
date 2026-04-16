import { ImageResponse } from "next/og";

// Dynamic favicon — rendered at build time into PNG via Next's ImageResponse.
// Using the same motif as the wordmark in app-shell.tsx so the tab icon
// matches what's in the header.
//
// 32x32 is Next's convention for the default `icon` file export; it auto-
// emits a link rel="icon" tag in the HTML. See:
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons
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
          background: "#0b0b0d",
          borderRadius: 7,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            border: "2px solid #22c55e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: 3, background: "#22c55e" }} />
        </div>
      </div>
    ),
    size,
  );
}
