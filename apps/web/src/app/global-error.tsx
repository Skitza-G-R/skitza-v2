"use client";

// Nuclear fallback — the root layout itself crashed (rare: Clerk
// provider fails, font loader breaks, etc.). This replaces <html> +
// <body> wholesale, so it can't reuse the root layout's structure.
//
// Kept deliberately spare: no fonts, no CSS variables (globals.css
// hasn't loaded). Inline styles only.

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0d",
          color: "#f5f4f0",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "28rem" }}>
          <p
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: "0.7rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#6e6c68",
            }}
          >
            Critical failure
          </p>
          <h1
            style={{
              marginTop: "0.75rem",
              fontSize: "3rem",
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 0.95,
            }}
          >
            Signal cut.
          </h1>
          <p style={{ marginTop: "1.5rem", color: "#a8a6a0" }}>
            Skitza couldn&apos;t boot this page. Reload to retry.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "2rem",
              padding: "0.75rem 1.5rem",
              borderRadius: "0.5rem",
              background: "#22c55e",
              color: "#0b0b0d",
              border: "none",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
