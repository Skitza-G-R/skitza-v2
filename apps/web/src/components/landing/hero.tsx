import { SkitzaMark } from "~/components/brand/skitza-mark";
import { WaitlistForm } from "./waitlist-form";

// Hero — LIGHT world. Matches user-supplied index.html §1.
//
// Anatomy: brand mark → small label → huge Syne headline (two lines,
// italic color-break on line 2) → sub-copy → waitlist form →
// microcopy → trust bar → 3 floating mockup cards (Session booked,
// Invoice paid, Files delivered).
//
// Ambient drifting blobs in the background — amber + copper, 600px,
// heavy blur. Motion uses the skitza-drift keyframe from globals.
export function Hero() {
  return (
    <header className="relative overflow-hidden pb-20 pt-10 sm:pb-28 sm:pt-16">
      {/* Ambient blobs — driftable, pinned behind content. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <span
          className="absolute left-[-12%] top-[-8rem] h-[36rem] w-[36rem] rounded-full blur-[100px]"
          style={{
            background: "rgba(212,150,10,0.10)",
            animation: "skitza-drift 25s ease-in-out infinite alternate",
          }}
        />
        <span
          className="absolute right-[-10%] top-[30%] h-[30rem] w-[30rem] rounded-full blur-[100px]"
          style={{
            background: "rgba(176,104,48,0.10)",
            animation: "skitza-drift 30s ease-in-out -5s infinite alternate",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <div className="reveal-up mx-auto inline-flex items-center justify-center">
          <SkitzaMark size="hero" />
        </div>

        <p className="reveal-up-delay-1 mt-6 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          The all-in-one business tool for music producers
        </p>

        <h1
          className="reveal-up-delay-2 mt-6 font-display text-[clamp(2.75rem,8vw,5.25rem)] leading-[0.98] tracking-tight text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 800 }}
        >
          Stop chasing payments.
          <span className="mt-1 block italic text-[rgb(var(--brand-primary))]">
            Just make music.
          </span>
        </h1>

        <p className="reveal-up-delay-3 mx-auto mt-6 max-w-xl text-base leading-relaxed text-[rgb(var(--fg-secondary))]">
          Skitza is the only link you need. Clients book sessions, sign contracts, and
          pay automatically — and your final mixes stay locked until the invoice is
          cleared.
        </p>

        <div id="waitlist-hero" className="reveal-up-delay-4 mx-auto mt-10 max-w-md">
          <WaitlistForm source="landing-hero" cta="Join The Waiting List" compact />
        </div>

        <p className="mt-4 font-mono text-xs text-[rgb(var(--fg-muted))]">
          Share one link. Your clients handle everything else.
        </p>

        <p className="mt-3 text-sm text-[rgb(var(--fg-secondary))]">
          ★★★★★ Joined by 1,200+ producers on the waitlist
        </p>

        {/* Floating mockup cards — the 3-step "it just worked" proof. */}
        <div className="mx-auto mt-14 flex max-w-md flex-col gap-3 text-left">
          {MOCKUPS.map((label, i) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[0_10px_30px_-8px_rgb(0_0_0_/_0.08)]"
              style={{
                animation: "skitza-reveal-up 0.6s cubic-bezier(0.16,1,0.3,1) both",
                animationDelay: `${String(0.6 + i * 0.15)}s`,
              }}
            >
              <span className="text-sm text-[rgb(var(--fg-primary))]">{label}</span>
              <span className="text-base font-bold text-[rgb(var(--brand-primary))]">✓</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

const MOCKUPS = [
  "Session booked · Tuesday 3pm — Marcus T.",
  "Invoice paid · $450 received automatically",
  "Files delivered · Final mix + stems",
] as const;
