"use client";

import { useEffect } from "react";
import Link from "next/link";

import { SkLogoIcon } from "./landing-nav";

// Hero — verbatim port of source HTML lines 1190-1269.
//
// Source-vs-port differences:
//   1. The CTA button "Join The Waiting List" → <Link> "Sign up now"
//      pointing at /sign-up?redirect_url=%2Fonboarding.
//   2. The secondary CTA's onclick handler ("scroll to #pain") → plain
//      <a href="#pain"> — same UX (browser smooth-scrolls via the
//      `scroll-behavior: smooth` rule in landing.css).
//   3. The "★★★★★ Joined by 1,200+ producers on the waitlist" line → the
//      honest "★★★★★ Built for solo producers." (we don't have 1,200
//      waitlist signups; PRD §3.5 forbids fabricated social proof).
//
// The word-by-word fade-in (source script lines 1898-1915) is now
// declarative: HERO_TITLE_WORDS is split at module load, each word
// renders inside <span class="hero-word"> with a static
// transition-delay style. The .page-loaded class is added to <html>
// via useEffect on mount — landing.css then transitions every
// .hero-word from opacity-0 to opacity-1 with the staggered delay.
//
// The previous imperative DOM-mutation approach (innerHTML rewrite)
// can't survive React's reconciliation; the declarative version is
// hydration-safe and renders the same on server + client.

// HERO_TITLE_WORDS — pinned headline split. The two original phrases
// from source line 1898 ("Your studio." / "Fully automated.") are
// replaced by the longer founder copy in the source <h1> at line 1227
// ("Stop chasing payments. Just make music."). The word "Just" gets a
// <br /> in front of it so the second sentence starts on its own line,
// preserving the visual break the founder hand-rolled in the source.
export const HERO_TITLE_WORDS = [
  "Stop",
  "chasing",
  "payments.",
  "Just",
  "make",
  "music.",
] as const;

// Words that should render a <br /> just before them (case-sensitive).
// The source code put the linebreak before the second phrase ("Just")
// — extracting it as a set keeps the JSX readable.
const BREAK_BEFORE = new Set<string>(["Just"]);

export function Hero() {
  // Add .page-loaded to <html> on mount (mirrors source script line
  // 1911). landing.css has `.landing-root .page-loaded .hero-word { ...
  // opacity: 1; }` rules that flip every word to its visible state.
  // The 100ms timeout matches the original; it lets the fonts hydrate
  // before the fade kicks in so the word baseline doesn't shift.
  useEffect(() => {
    const id = window.setTimeout(() => {
      document.documentElement.classList.add("page-loaded");
    }, 100);
    return () => {
      window.clearTimeout(id);
      // We deliberately don't remove .page-loaded on unmount — the
      // hero only mounts once per session, and removing it would
      // cause every animated element on the page to fade back out.
    };
  }, []);

  return (
    <header className="hero" id="hero">
      <div className="blob-amber ambient-blob" />
      <div className="blob-copper ambient-blob" />

      <div className="container">
        <div className="sk-brand-link hero-mode">
          <div className="sk-icon-wrap hero-scale">
            <SkLogoIcon />
          </div>
          <div className="sk-wordmark-wrap">
            <span className="sk-wordmark">Skitza</span>
          </div>
        </div>

        {/* Source line 1224 — keep the inline animation/delay verbatim
            (the per-element keyframe + delay can't move into the
            stylesheet without losing the chained reveal effect). */}
        <span
          className="label"
          style={{
            opacity: 0,
            transform: "translateY(10px)",
            animation: "fadeUp 1s forwards 0.3s",
            marginTop: 24,
            marginBottom: 24,
          }}
        >
          The all-in-one business tool for music producers
        </span>

        <h1 id="hero-title" className="syne">
          {HERO_TITLE_WORDS.map((word, i) => (
            <span key={`${word}-${String(i)}`}>
              {BREAK_BEFORE.has(word) ? <br /> : null}
              <span
                className="hero-word"
                style={{ transitionDelay: `${String(i * 0.15)}s` }}
              >
                {word}
              </span>
              {/* Trailing space so the words don't collapse together
                  when the .hero-word spans render inline. */}
              {i < HERO_TITLE_WORDS.length - 1 ? " " : ""}
            </span>
          ))}
        </h1>

        <p className="sub-copy body-text">
          Skitza is the only link you need.
          <br />
          Clients book sessions, sign contracts, and pay automatically
          <br />
          and your final mixes stay locked until the invoice is cleared.
        </p>

        <div className="hero-ctas">
          <Link
            href="/sign-up?redirect_url=%2Fonboarding"
            className="btn-primary"
          >
            Sign up now
          </Link>
          <a href="#pain" className="btn-ghost">
            See how it works ↓
          </a>
        </div>

        {/* Source line 1241 micro-copy + the trust-bar line.
            Inline styles preserved verbatim from the source. */}
        <p
          style={{
            fontSize: 13,
            color: "var(--light-body)",
            marginBottom: 20,
            opacity: 0,
            animation: "fadeUp 1s forwards 1s",
          }}
        >
          Share one link. Your clients handle everything else.
        </p>
        <div className="trust-bar">★★★★★ Built for solo producers.</div>

        <div className="hero-mockup">
          <div className="mockup-glow" />
          <div className="mockup-wrapper">
            <div className="mockup-card">
              <span>Session booked · Tuesday 3pm — Marcus T.</span>
              <span className="check">✓</span>
            </div>
          </div>
          <div className="mockup-wrapper">
            <div className="mockup-card">
              <span>Invoice paid · $450 received automatically</span>
              <span className="check">✓</span>
            </div>
          </div>
          <div className="mockup-wrapper">
            <div className="mockup-card">
              <span>Files delivered · Final mix + stems</span>
              <span className="check">✓</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
