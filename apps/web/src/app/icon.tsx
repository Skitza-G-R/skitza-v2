import { ImageResponse } from "next/og";

// Favicon — dynamic ImageResponse with amber ring on warm cream.
// Matches the new :root palette; retires the obsidian+green v1.
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
          background: "#F2EDE6",
          borderRadius: 7,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            border: "2px solid #D4960A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: 3, background: "#D4960A" }} />
        </div>
      </div>
    ),
    size,
  );
}
