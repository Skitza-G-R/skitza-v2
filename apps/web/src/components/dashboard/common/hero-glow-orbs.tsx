// Drifting amber + copper glow orbs that anchor every dark hero band
// in the producer dashboard (DESIGN.md hero spec lines 253–255). Two
// off-screen radial gradients animate on different timelines so they
// never align — the "premium poster" feel from the prototype.
//
// Used by AlbumHero, ClientSpaceHero, SongSpaceHero. Extracted so a
// future tweak (color, size, motion path) lands in one place.

export function HeroGlowOrbs() {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute -left-20 -top-20 h-[280px] w-[280px] rounded-full motion-safe:animate-[skitza-drift_18s_ease-in-out_infinite] motion-reduce:animate-none"
        style={{
          background:
            "radial-gradient(circle, rgb(var(--brand-primary)/0.32), transparent 70%)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-16 h-[340px] w-[340px] rounded-full motion-safe:animate-[skitza-drift_22s_ease-in-out_infinite_reverse] motion-reduce:animate-none"
        style={{
          background:
            "radial-gradient(circle, rgb(176 104 48 / 0.28), transparent 70%)",
        }}
      />
    </>
  );
}
