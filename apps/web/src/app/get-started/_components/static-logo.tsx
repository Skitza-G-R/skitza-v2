// Brand-recognition logo for the /get-started ad funnel.
// Display-only — never wrapped in <a> or <Link> per design doc §3.5.
// Wordmark uses Syne (--font-head) with an amber period accent that
// matches the homepage wordmark style.

export function StaticLogo({
  variant = "light",
}: {
  variant?: "light" | "dark";
}) {
  const color = variant === "dark" ? "#EDE8E2" : "#1A1714";
  return (
    <div
      aria-label="Skitza"
      className="inline-flex items-baseline gap-px"
      style={{
        fontFamily: "var(--font-syne, Syne), system-ui, sans-serif",
        fontWeight: 800,
        letterSpacing: "-0.02em",
        fontSize: "22px",
        lineHeight: 1,
        color,
      }}
    >
      <span>skitza</span>
      <span style={{ color: "#D4960A" }}>.</span>
    </div>
  );
}
