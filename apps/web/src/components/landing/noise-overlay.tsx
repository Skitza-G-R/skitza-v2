// apps/web/src/components/landing/noise-overlay.tsx
//
// Tactile SVG noise layer — fixed-position overlay that sits on top of
// the entire viewport at 2% opacity, giving the warm-cream marketing
// surface a subtle film-grain texture. Originally lived as the first
// child of <body> in the source HTML (lines 63-73 + 1144 of
// docs/plans/active/2026-04-26-landing-restore-source.html).
//
// All positioning, opacity, and the data-URI background-image live in
// landing.css under `.landing-root .noise-overlay`. This component is
// just the empty <div> that picks up that style.
//
// Server component: zero interactivity, zero hooks, zero state — it's
// the cheapest possible primitive. Rendered as the first child of
// <div className="landing-root"> in apps/web/src/app/page.tsx so the
// CSS scoping resolves correctly.
export function NoiseOverlay() {
  return <div className="noise-overlay" aria-hidden="true" />;
}
