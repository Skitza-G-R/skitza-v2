// Brand-recognition logo for the /get-started ad funnel.
// Display-only — never wrapped in <a> or <Link> per design doc §3.5.
//
// Renders the canonical app lockup (LogoMark + lowercase "skitza."
// wordmark with amber period) so the funnel header matches what
// signed-in producers see in their dashboard sidebar — visual
// continuity from ad → funnel → app.
//
// `size` drives the LogoMark dimensions; the wordmark scales at 0.6x
// (mockup spec: 30px mark + 18px wordmark = 30/18 ≈ 0.6).

import { LogoMark } from "~/components/brand/logo-mark";

export function StaticLogo({
  variant = "light",
  size = 30,
}: {
  variant?: "light" | "dark";
  size?: number;
}) {
  const wordmarkSize = Math.round(size * 0.6);
  const gap = Math.max(8, Math.round(size / 3));
  const color = variant === "dark" ? "#EDE8E2" : "#1A1714";
  return (
    <div
      aria-label="Skitza"
      className="inline-flex items-center"
      style={{ gap }}
    >
      <LogoMark size={size} />
      <span
        className="skitza-wordmark"
        style={{
          fontFamily: "var(--font-syne, Syne), system-ui, sans-serif",
          fontWeight: 800,
          letterSpacing: "-0.03em",
          fontSize: `${String(wordmarkSize)}px`,
          lineHeight: 1,
          color,
        }}
      >
        skitza<span className="dot">.</span>
      </span>
    </div>
  );
}
