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
          background: "#F2EDE6",
          color: "#1A1714",
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
              color: "#8C8880",
            }}
          >
            Critical failure
          </p>
          <h1
            style={{
              marginTop: "0.75rem",
              fontSize: "3rem",
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 0.95,
            }}
          >
            Signal cut.
          </h1>
          <p style={{ marginTop: "1.5rem", color: "#6B6560" }}>
            Skitza couldn&apos;t boot this page. Reload to retry.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "2rem",
              padding: "0.75rem 1.5rem",
              borderRadius: "0.5rem",
              background: "linear-gradient(135deg, #D4960A, #B06830)",
              color: "#0C0A07",
              border: "none",
              fontSize: "0.95rem",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 8px 24px -4px rgba(212,150,10,0.35)",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
