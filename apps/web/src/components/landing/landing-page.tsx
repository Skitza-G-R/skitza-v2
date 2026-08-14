"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";

import { LogoMark } from "~/components/brand/logo-mark";
import { RevealOnScroll } from "~/components/landing/reveal-on-scroll";
import { PublicConnectivityNotice } from "~/components/public/public-connectivity";

// =============================================================================
// Skitza Landing — v3 (Phase 3 — docs/qa/phase-3-handoff.md)
// =============================================================================
//
// Phase 3 wholesale-replaces the PR #50 verbatim port with the v3 marketing
// surface from `~/Downloads/skitza (1)/tabs/landing.jsx`. Single-file shape
// preserved (the PR #50 pivot from a 17-component decomposition was
// motivated by animation reliability — see CLAUDE.md mistake-log
// 2026-04-26 (landing-restore CSS scoping)). Every section's distinguishing
// landmark is pinned by the test at apps/web/src/app/__tests__/landing-page.test.tsx.
//
// Producer access is invitation-only (SK-229). Marketing CTAs explain the
// invitation flow; Artist signup remains on each Producer's `/join/[slug]`.
// - Logged in the handoff doc.
//
// CSS contract:
// - Tokens (palette, typography, motion) come from `globals.css`.
// - Reveal-on-scroll classes (`.sk-reveal*`, `.sk-d-*`) are observed by
//   `RevealOnScroll` (mounted once at the top of the tree).
// - Hero word-fade + 3D tilt + grid mask live in `landing.css` (imported
//   by the server wrapper at `apps/web/src/app/page.tsx`).
//
// Inline SVGs: every icon is hand-written below. No `lucide-react` (see
// Phase 1 + 2 precedent in CLAUDE.md).

const PRODUCER_ACCESS_HREF = "/producer-access";

export function LandingPage() {
  // FAQ accordion — single-active-row state.
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  // Mobile menu — navbar fold-out on <lg.
  const [menuOpen, setMenuOpen] = useState(false);
  // Mounted flag drives `.is-loaded` on the root, which kicks off the
  // hero word-fade. Set in a `useEffect` so SSR markup ships at
  // opacity 0 (correct initial state for the transition).
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div id="landing-root" className={`landing-v3-root scroll-host ${loaded ? "is-loaded" : ""}`}>
      <PublicConnectivityNotice />
      <RevealOnScroll />

      <Nav menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        <Hero />
        <StackReplace />
        <FeaturesSection />
        <FeatureGrid />
        <HowSection />
        <Pricing />
        <FAQ activeFaq={activeFaq} setActiveFaq={setActiveFaq} />
        <FounderNote />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}

// =============================================================================
// Wordmark + Icon set
// =============================================================================

function Wordmark({ size = 22, inverse = false }: { size?: number; inverse?: boolean }) {
  return (
    <span
      className="font-syne inline-flex items-baseline gap-px leading-none font-extrabold"
      style={{
        fontSize: size,
        letterSpacing: "-0.03em",
        color: inverse ? "#F2EDE6" : "rgb(var(--fg-default))",
      }}
    >
      skitza
      <span
        className="inline-block transition-transform duration-300 group-hover:translate-y-[-2px] group-hover:scale-125 group-hover:rotate-12"
        style={{ color: "rgb(var(--brand-primary))" }}
      >
        .
      </span>
    </span>
  );
}

// Landing-page brand lockup — LogoMark + lowercase Wordmark.
// `markSize` controls the amber square; the wordmark size is passed
// through so each surface (navbar 22, footer 16, demo 14) keeps its
// own typographic scale. Wrapped in a flex container so the parent
// link/group still drives the dot's hover transform.
function LogoLockup({
  markSize,
  wordmarkSize,
  inverse = true,
}: {
  markSize: number;
  wordmarkSize: number;
  inverse?: boolean;
}) {
  const gap = Math.max(6, Math.round(markSize / 3));
  return (
    <span className="inline-flex items-center" style={{ gap }}>
      <LogoMark size={markSize} />
      <Wordmark size={wordmarkSize} inverse={inverse} />
    </span>
  );
}

type IconName =
  | "arrow-right"
  | "play"
  | "check"
  | "check-check"
  | "lock"
  | "dollar-sign"
  | "file-signature"
  | "users"
  | "inbox"
  | "shield-check"
  | "globe"
  | "smartphone"
  | "plus"
  | "minus"
  | "x"
  | "menu"
  | "chevron-right"
  | "home"
  | "disc-3"
  | "calendar"
  | "shopping-bag"
  | "bar-chart-3";

function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  switch (name) {
    case "arrow-right":
      return (
        <svg {...props}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      );
    case "play":
      return (
        <svg {...props}>
          <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "check-check":
      return (
        <svg {...props}>
          <path d="M18 6 7 17l-5-5" />
          <path d="m22 10-7.5 7.5L13 16" />
        </svg>
      );
    case "lock":
      return (
        <svg {...props}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case "dollar-sign":
      return (
        <svg {...props}>
          <line x1="12" y1="2" x2="12" y2="22" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    case "file-signature":
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 18h.01M13 18l4-4 2 2-4 4z" />
        </svg>
      );
    case "users":
      return (
        <svg {...props}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...props}>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      );
    case "shield-check":
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      );
    case "globe":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case "smartphone":
      return (
        <svg {...props}>
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      );
    case "plus":
      return (
        <svg {...props}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "minus":
      return (
        <svg {...props}>
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "x":
      return (
        <svg {...props}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case "menu":
      return (
        <svg {...props}>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...props}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      );
    case "home":
      return (
        <svg {...props}>
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "disc-3":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M6 12c0-1.7.7-3.2 1.8-4.2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M18 12c0 1.7-.7 3.2-1.8 4.2" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "shopping-bag":
      return (
        <svg {...props}>
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      );
    case "bar-chart-3":
      return (
        <svg {...props}>
          <path d="M3 3v18h18" />
          <path d="M18 17V9M13 17V5M8 17v-3" />
        </svg>
      );
  }
}

// =============================================================================
// 1. Sticky nav
// =============================================================================

function Nav({ menuOpen, setMenuOpen }: { menuOpen: boolean; setMenuOpen: (v: boolean) => void }) {
  return (
    <nav
      id="navbar"
      className="sticky top-0 z-50 border-b backdrop-blur-md"
      style={{
        background: "rgb(17 16 9 / 0.78)",
        borderColor: "rgb(255 255 255 / 0.06)",
        color: "#F2EDE6",
      }}
    >
      <div
        className="mx-auto flex max-w-7xl items-center justify-between px-5 pt-3.5 pb-3.5 sm:px-8"
        style={{ paddingTop: "max(0.875rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-4 sm:gap-9">
          <Link
            href="/"
            className="group sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)]"
            aria-label="Skitza home"
          >
            <LogoLockup markSize={30} wordmarkSize={22} />
          </Link>
          <span
            className="hidden font-mono text-[11px] sm:inline"
            style={{ color: "rgb(255 255 255 / 0.55)" }}
          >
            v1.0 — early access
          </span>
        </div>
        {/* Desktop links */}
        <div className="hidden items-center gap-7 text-[13px] font-medium lg:flex">
          <a
            href="#features"
            style={{ color: "rgb(255 255 255 / 0.75)" }}
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 hover:text-white"
          >
            Features
          </a>
          <a
            href="#how"
            style={{ color: "rgb(255 255 255 / 0.75)" }}
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 hover:text-white"
          >
            How it works
          </a>
          <a
            href="#pricing"
            style={{ color: "rgb(255 255 255 / 0.75)" }}
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 hover:text-white"
          >
            Pricing
          </a>
          <a
            href="#faq"
            style={{ color: "rgb(255 255 255 / 0.75)" }}
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 hover:text-white"
          >
            FAQ
          </a>
          <Link
            href="/sign-in"
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 text-[12.5px]"
            style={{ color: "rgb(255 255 255 / 0.75)" }}
          >
            Sign in
          </Link>
          <Link
            href={PRODUCER_ACCESS_HREF}
            className="sk-pop sk-press inline-flex min-h-11 items-center rounded-[10px] px-4 py-2 text-[13px] font-bold tracking-tight"
            style={{
              background: "rgb(var(--brand-primary))",
              color: "#111009",
              boxShadow: "0 2px 12px rgba(212,150,10,0.3)",
            }}
          >
            Producer access →
          </Link>
        </div>
        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => {
            setMenuOpen(!menuOpen);
          }}
          className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] lg:hidden"
          style={{ color: "#F2EDE6", background: "rgb(255 255 255 / 0.06)" }}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-menu"
        >
          <Icon name={menuOpen ? "x" : "menu"} size={18} />
        </button>
      </div>
      {menuOpen && (
        <div
          id="landing-mobile-menu"
          className="border-t lg:hidden"
          style={{ borderColor: "rgb(255 255 255 / 0.06)" }}
        >
          <div className="flex flex-col gap-1 px-5 py-3">
            <a
              href="#features"
              onClick={() => {
                setMenuOpen(false);
              }}
              className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 py-3 text-[14px]"
              style={{ color: "rgb(255 255 255 / 0.85)" }}
            >
              Features
            </a>
            <a
              href="#how"
              onClick={() => {
                setMenuOpen(false);
              }}
              className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 py-3 text-[14px]"
              style={{ color: "rgb(255 255 255 / 0.85)" }}
            >
              How it works
            </a>
            <a
              href="#pricing"
              onClick={() => {
                setMenuOpen(false);
              }}
              className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 py-3 text-[14px]"
              style={{ color: "rgb(255 255 255 / 0.85)" }}
            >
              Pricing
            </a>
            <a
              href="#faq"
              onClick={() => {
                setMenuOpen(false);
              }}
              className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 py-3 text-[14px]"
              style={{ color: "rgb(255 255 255 / 0.85)" }}
            >
              FAQ
            </a>
            <Link
              href="/sign-in"
              className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 py-3 text-[14px]"
              style={{ color: "rgb(255 255 255 / 0.85)" }}
            >
              Sign in
            </Link>
            <Link
              href={PRODUCER_ACCESS_HREF}
              className="sk-press mt-2 inline-flex min-h-11 items-center justify-center rounded-[10px] px-4 py-3 text-center text-[14px] font-bold"
              style={{
                background: "rgb(var(--brand-primary))",
                color: "#111009",
              }}
            >
              Producer access →
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

// =============================================================================
// 2. Hero (with floating product peek)
// =============================================================================

function Hero() {
  // The headline splits on whitespace so each word can stagger via
  // `--w-i`. Words inherit the line-aware structure from the template
  // string below; the period at the tail of "studio." becomes the
  // accent character, the only colored glyph in the H1.
  const heroLines = [
    ["One", "app."],
    ["Your", "whole", "studio."],
  ];
  let wordIndex = 0;

  return (
    <section
      className="relative overflow-hidden px-6 pt-12 pb-16 sm:px-5 sm:pt-16 sm:pb-20"
      style={{ background: "#111009", color: "#F2EDE6" }}
    >
      <div className="animate-shine" />
      <div className="hero-grid-bg is-dark pointer-events-none absolute inset-0 opacity-100" />

      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 sm:gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Left — copy + CTAs */}
        <div className="sk-reveal-left min-w-0">
          <div
            className="mb-5 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-[11px] font-bold tracking-[0.08em] uppercase"
            style={{
              background: "rgba(212,150,10,0.12)",
              borderColor: "rgba(212,150,10,0.3)",
              color: "rgb(var(--brand-primary))",
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: "rgb(var(--brand-primary))",
                boxShadow: "0 0 10px rgb(var(--brand-primary))",
              }}
            />
            Now booking · early access
          </div>

          <h1
            className="font-syne m-0 font-extrabold"
            style={{
              fontSize: "clamp(44px, 5.4vw, 76px)",
              letterSpacing: "-0.038em",
              lineHeight: 0.95,
            }}
          >
            {heroLines.map((line, lineIdx) => {
              const isLast = lineIdx === heroLines.length - 1;
              return (
                <span key={lineIdx} className="block">
                  {line.map((word, wIdx) => {
                    const i = wordIndex++;
                    const isLastWord = isLast && wIdx === line.length - 1;
                    // The inter-word space must be a text node BETWEEN the
                    // inline-block word spans — a trailing space INSIDE an
                    // inline-block gets trimmed by the browser, which used
                    // to render the headline as "Oneapp. Yourwhole studio."
                    return (
                      <Fragment key={wIdx}>
                        <span
                          className="hero-word"
                          style={{ ["--w-i" as string]: i } as React.CSSProperties}
                        >
                          {isLastWord ? (
                            <>
                              {word.replace(/\.$/, "")}
                              <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
                            </>
                          ) : (
                            word
                          )}
                        </span>
                        {wIdx < line.length - 1 ? " " : null}
                      </Fragment>
                    );
                  })}
                </span>
              );
            })}
          </h1>

          <p
            className="mt-7 max-w-xl text-[17px] leading-[1.55]"
            style={{
              color: "rgb(242 237 230 / 0.6)",
              letterSpacing: "-0.005em",
            }}
          >
            One Producer workspace for clients, projects, music, sessions, agreements,
            external-payment records, and delivery. One link lets Artists hear public music, join
            your studio, and keep the work in one shared place.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href={PRODUCER_ACCESS_HREF}
              className="sk-pop sk-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] px-[22px] py-4 text-[15px] font-bold tracking-tight sm:py-[14px] sm:text-[14.5px]"
              style={{
                background: "rgb(var(--brand-primary))",
                color: "#111009",
                boxShadow: "0 8px 24px rgba(212,150,10,0.35)",
              }}
            >
              How to get access
              <Icon name="arrow-right" size={16} strokeWidth={2.6} />
            </Link>
            <a
              href="#how"
              className="sk-pop sk-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] border px-[22px] py-4 text-[15px] font-bold sm:py-[14px] sm:text-[14.5px]"
              style={{
                background: "transparent",
                color: "#F2EDE6",
                borderColor: "rgb(255 255 255 / 0.18)",
              }}
            >
              <Icon name="play" size={14} strokeWidth={2.6} />
              See how it works
            </a>
          </div>

          {/* Early-access strip — pre-launch, no fabricated social proof. */}
          <div
            className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-2.5 text-[12.5px] sm:mt-10 sm:gap-x-5 sm:gap-y-2"
            style={{ color: "rgb(242 237 230 / 0.65)" }}
          >
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background: "rgb(var(--brand-primary))",
                  boxShadow: "0 0 8px rgb(var(--brand-primary))",
                }}
                aria-hidden
              />
              <strong className="font-bold text-white">Invitation-only Producer beta</strong>
            </span>
            <span className="hidden sm:inline" style={{ color: "rgb(242 237 230 / 0.35)" }}>
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="check" size={13} strokeWidth={3} />
              Producer invitation required
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="check" size={13} strokeWidth={3} />
              Artist signup stays open
            </span>
          </div>
        </div>

        {/* Right — product peek */}
        <HeroProductPeek />
      </div>
    </section>
  );
}

function HeroProductPeek() {
  return (
    <div className="sk-reveal-right sk-d-1 sk-float-slow relative min-w-0">
      <div
        className="hero-peek-frame relative overflow-hidden rounded-2xl"
        style={{
          background: "#fff",
          boxShadow:
            "0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06), 0 0 60px rgba(212,150,10,0.15)",
        }}
      >
        {/* chrome */}
        <div
          className="flex h-8 items-center gap-2 px-3"
          style={{ background: "#f2ede6", borderBottom: "1px solid #e3dac6" }}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff5f57" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#febc2e" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#28c840" }} />
          <div className="flex flex-1 justify-center">
            <div
              className="rounded-md border bg-white px-2.5 py-1 font-mono text-[10px]"
              style={{ borderColor: "#e3dac6", color: "#6b6359" }}
            >
              skitza.app / dashboard
            </div>
          </div>
        </div>
        {/* body — the fake sidebar is a desktop luxury; on phones the
            main panel alone fills the frame and stays legible. */}
        <div className="flex min-h-[360px] sm:min-h-[420px]" style={{ background: "#F2EDE6" }}>
          <div
            className="hidden flex-col gap-1 sm:flex"
            style={{
              width: 156,
              background: "#111009",
              color: "#fff",
              padding: "14px 10px",
            }}
          >
            <div className="flex items-center px-1.5 pt-1 pb-3">
              <LogoLockup markSize={18} wordmarkSize={14} />
            </div>
            {(
              [
                { i: "home", n: "Overview", a: true },
                { i: "users", n: "Clients", a: false },
                { i: "disc-3", n: "Music", a: false },
                { i: "calendar", n: "Calendar", a: false },
                { i: "shopping-bag", n: "Storefront", a: false },
                { i: "bar-chart-3", n: "Insights", a: false },
              ] satisfies Array<{ i: IconName; n: string; a: boolean }>
            ).map((it) => (
              <div
                key={it.n}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]"
                style={{
                  fontWeight: it.a ? 700 : 500,
                  color: it.a ? "rgb(var(--brand-primary))" : "rgb(255 255 255 / 0.55)",
                  background: it.a ? "rgba(212,150,10,0.13)" : "transparent",
                }}
              >
                <Icon name={it.i} size={12} strokeWidth={2.2} />
                {it.n}
              </div>
            ))}
            <div className="flex-1" />
            <div
              className="flex items-center gap-1.5 rounded-md p-1.5"
              style={{ background: "rgb(255 255 255 / 0.04)" }}
            >
              <div
                className="grad-amber flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9px] font-extrabold"
                style={{ color: "#111009" }}
                aria-hidden
              >
                GA
              </div>
              <div
                className="text-[9.5px] font-semibold"
                style={{ color: "rgb(255 255 255 / 0.75)" }}
              >
                Gili Studio
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-hidden p-4">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div>
                <div
                  className="font-syne text-[17px] font-extrabold"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  Good evening, Gili.
                </div>
                <div className="font-mono text-[9.5px]" style={{ color: "#6b6359" }}>
                  Example workspace · 3 sessions today
                </div>
              </div>
              <div
                className="sk-soft-pulse flex items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1 text-[9.5px] font-bold"
                style={{
                  background: "rgba(34,197,94,0.12)",
                  border: "1px solid rgba(34,197,94,0.22)",
                  color: "#15803d",
                }}
              >
                <span className="h-1 w-1 rounded-full" style={{ background: "#22c55e" }} />
                Public link live
              </div>
            </div>

            {/* Public link strip */}
            <div
              className="relative mb-3 flex items-center justify-between overflow-hidden rounded-md px-3 py-2"
              style={{ background: "#111009", color: "#fff" }}
            >
              <div className="animate-shine" />
              <div className="relative">
                <div className="font-mono text-[10px]" style={{ color: "rgb(255 255 255 / 0.5)" }}>
                  your link
                </div>
                <div className="font-mono text-[11.5px] font-semibold" style={{ color: "#fff" }}>
                  skitza.app/join/your-name
                </div>
              </div>
              <div className="relative flex gap-1.5">
                <span
                  className="rounded px-1.5 py-0.5 text-[9px]"
                  style={{
                    background: "rgb(255 255 255 / 0.08)",
                    color: "rgb(255 255 255 / 0.7)",
                  }}
                >
                  Public link ready
                </span>
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-bold"
                  style={{ background: "rgb(var(--brand-primary))", color: "#111009" }}
                >
                  Copy
                </span>
              </div>
            </div>

            {/* Finance pulse — 3 cols on desktop; on phones the
                "Follow up" card spans full width so the name + amount
                never wrap mid-word. */}
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                {
                  label: "Recorded · Nov",
                  value: "$8,420",
                  note: "external payments",
                  noteColor: "#15803d",
                  dot: false,
                },
                {
                  label: "Outstanding",
                  value: "$1,200",
                  note: "2 payments",
                  noteColor: "#6b6359",
                  dot: false,
                },
                {
                  label: "Follow up",
                  value: "Marcus T.",
                  note: "$450 · 9d overdue",
                  noteColor: "#dc2626",
                  dot: true,
                },
              ].map((c, ci) => (
                <div
                  key={c.label}
                  className={`relative rounded-md p-2.5 ${ci === 2 ? "col-span-2 sm:col-span-1" : ""}`}
                  style={{ background: "#fff", border: "1px solid #e8e1d4" }}
                >
                  {c.dot && (
                    <div
                      className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full"
                      style={{
                        background: "#dc2626",
                        boxShadow: "0 0 0 3px rgba(220,38,38,0.18)",
                      }}
                    />
                  )}
                  <div
                    className="mb-1 font-mono text-[9px] uppercase"
                    style={{ color: "#6b6359", letterSpacing: "0.05em" }}
                  >
                    {c.label}
                  </div>
                  <div
                    className="font-mono text-[15px] font-extrabold sm:text-[18px]"
                    style={{ color: "#111009", letterSpacing: "-0.02em" }}
                  >
                    {c.value}
                  </div>
                  <div className="mt-0.5 text-[9px] font-semibold" style={{ color: c.noteColor }}>
                    {c.note}
                  </div>
                </div>
              ))}
            </div>

            {/* Urgent projects card */}
            <div
              className="rounded-md p-2.5"
              style={{ background: "#fff", border: "1px solid #e8e1d4" }}
            >
              <div className="mb-2 flex items-center justify-between">
                <div
                  className="font-syne text-[11.5px] font-bold"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  Needs attention
                </div>
                <div className="font-mono text-[9px]" style={{ color: "#6b6359" }}>
                  3
                </div>
              </div>
              {[
                {
                  c: "Yael N.",
                  p: "Album · 4 tracks",
                  s: "Mix v3 awaiting feedback",
                  color: "#d4960a",
                },
                { c: "Tom R.", p: "Single", s: "Final approval pending", color: "#15803d" },
                { c: "Marcus T.", p: "EP · 3 tracks", s: "Payment 9d overdue", color: "#dc2626" },
              ].map((r, i) => (
                <div
                  key={r.c}
                  className="flex items-center gap-2 py-1.5"
                  style={i ? { borderTop: "1px solid #f0eadf" } : undefined}
                >
                  <div className="h-[22px] w-1 rounded" style={{ background: r.color }} />
                  <div className="flex-1">
                    <div className="text-[10.5px] font-bold" style={{ color: "#111009" }}>
                      {r.c}
                      <span style={{ color: "#6b6359", fontWeight: 500 }}> · {r.p}</span>
                    </div>
                    <div className="mt-px font-mono text-[9px]" style={{ color: r.color }}>
                      {r.s}
                    </div>
                  </div>
                  <Icon
                    name="chevron-right"
                    size={11}
                    strokeWidth={2.4}
                    className="text-[#6b6359]"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating "session booked" toast — desktop only */}
      <div
        className="reveal-up absolute hidden items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[11.5px] shadow-2xl lg:flex"
        style={{
          top: "12%",
          right: "-32px",
          background: "#111009",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.08)",
          animationDelay: "0.18s",
        }}
      >
        <div
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ background: "rgba(34,197,94,0.16)", color: "#22c55e" }}
        >
          <Icon name="check" size={14} strokeWidth={3} />
        </div>
        <div>
          <div className="font-bold">Session booked</div>
          <div className="font-mono text-[10px]" style={{ color: "rgb(255 255 255 / 0.6)" }}>
            Marcus T · Tue 15:00
          </div>
        </div>
      </div>

      {/* Floating external-payment record toast — desktop only */}
      <div
        className="reveal-up absolute hidden items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[11.5px] lg:flex"
        style={{
          bottom: "8%",
          left: "-28px",
          background: "#fff",
          color: "#111009",
          border: "1px solid rgb(var(--border-subtle))",
          boxShadow: "0 14px 30px rgba(17,16,9,0.18)",
          animationDelay: "0.26s",
        }}
      >
        <div
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ background: "rgba(212,150,10,0.18)", color: "rgb(var(--brand-primary))" }}
        >
          <Icon name="dollar-sign" size={14} strokeWidth={2.8} />
        </div>
        <div>
          <div className="font-bold">Payment confirmed</div>
          <div className="font-mono text-[10px]" style={{ color: "#6b6359" }}>
            $450 · proof recorded
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 3. Stack Replace
// =============================================================================

function StackReplace() {
  const tools = ["Bookings", "Agreements", "Payments", "Files", "Clients", "Calendar"];
  return (
    <section
      id="stack-replace"
      className="border-t border-b px-6 py-16 sm:px-5 sm:py-20"
      style={{
        background: "rgb(var(--bg-background))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <div className="mx-auto max-w-6xl text-center">
        <div className="label-tiny sk-reveal mb-5">01 · The unbundled tax</div>
        <h2
          className="font-syne sk-reveal sk-d-1 m-0 font-extrabold"
          style={{
            // 24px floor: this is the longest headline on the page and
            // Syne extrabold runs wide — anything bigger stacks 5 thin
            // lines on a 390px phone.
            fontSize: "clamp(24px, 4vw, 52px)",
            letterSpacing: "-0.035em",
            lineHeight: 1.06,
            color: "rgb(var(--fg-default))",
          }}
        >
          One studio business.
          {/* Forced break is a desktop rhythm; on phones it fights the
              balanced wrapper and produces five thin lines. */}
          <br className="hidden sm:inline" /> Too many separate records.
        </h2>

        <div className="mx-auto mt-10 grid max-w-4xl gap-8 sm:mt-14 md:grid-cols-2 md:items-stretch">
          {/* Without */}
          <div
            className="sk-reveal-left sk-d-2 relative rounded-2xl border p-6"
            style={{
              background: "#fff",
              borderColor: "rgb(var(--border-subtle))",
            }}
          >
            <div
              className="absolute -top-2.5 left-6 rounded-md border px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] uppercase"
              style={{
                background: "rgba(220,38,38,0.1)",
                borderColor: "rgba(220,38,38,0.2)",
                color: "#dc2626",
              }}
            >
              Without Skitza
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {tools.map((t) => (
                <div
                  key={t}
                  className="relative rounded-[10px] border px-2 py-3.5 text-center"
                  style={{
                    background: "rgb(var(--bg-background))",
                    borderColor: "rgb(var(--border-subtle))",
                    filter: "grayscale(0.7)",
                    opacity: 0.7,
                  }}
                >
                  <div
                    className="mx-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-extrabold"
                    style={{ background: "#111009", color: "#fff" }}
                  >
                    {t.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="text-[10.5px] font-semibold" style={{ color: "#6b6359" }}>
                    {t}
                  </div>
                  <div
                    className="absolute top-1 right-1 text-xs font-extrabold"
                    style={{ color: "#dc2626" }}
                  >
                    ×
                  </div>
                </div>
              ))}
            </div>
            <div
              className="mt-3.5 text-center font-mono text-[11px]"
              style={{ color: "#6b6359", letterSpacing: "-0.01em" }}
            >
              Separate tools · scattered context · repeated admin
            </div>
          </div>

          {/* With — outer relative wrapper hosts the pill outside the
              inner card's overflow-hidden region (the shine animation
              needs clipping, but the pill needs to bleed above the top
              edge — same -top-2.5 offset as the Without card).
              h-full + flex-col on the inner card lets the middle
              content grow to match the Without card's height, while
              keeping the "1 link · 1 fee · 1 inbox" footer pinned to
              the bottom edge. */}
          <div className="sk-reveal-right sk-d-3 relative h-full">
            <div
              className="absolute -top-2.5 left-6 z-10 rounded-md px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] uppercase"
              style={{ background: "rgb(var(--brand-primary))", color: "#111009" }}
            >
              With Skitza
            </div>
            <div
              className="relative flex h-full flex-col overflow-hidden rounded-2xl p-6 text-white"
              style={{ background: "#111009" }}
            >
              <div className="animate-shine" />
              <div className="relative flex flex-1 flex-col items-center justify-center gap-3 py-6 sm:py-0">
                {/* Two sizes: the 60px desktop lockup overflows a 390px
                    card, so phones get a 44px cut of the same lockup. */}
                <span className="sm:hidden">
                  <LogoLockup markSize={44} wordmarkSize={40} />
                </span>
                <span className="hidden sm:inline-flex">
                  <LogoLockup markSize={60} wordmarkSize={56} />
                </span>
                <div
                  className="text-center font-mono text-[12px]"
                  style={{ color: "rgb(255 255 255 / 0.6)" }}
                >
                  skitza.app/join/
                  <span style={{ color: "rgb(var(--brand-primary))" }}>your-name</span>
                </div>
              </div>
              <div
                className="mt-3.5 text-center font-mono text-[11px]"
                style={{ color: "rgb(255 255 255 / 0.7)" }}
              >
                1 link · 1 studio · 1 shared record
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// 4. Features section — 3 alternating heroes with mocks
// =============================================================================

function FeaturesSection() {
  return (
    <section
      id="features"
      className="border-b px-6 py-8 sm:px-5 sm:py-10"
      style={{
        background: "rgb(var(--bg-background))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="sk-reveal py-8 text-center">
          <div className="label-tiny">02 · What Skitza does</div>
          <h2
            className="font-syne mx-auto mt-3.5 max-w-3xl font-extrabold"
            style={{
              fontSize: "clamp(30px, 4vw, 52px)",
              letterSpacing: "-0.035em",
              lineHeight: 1.02,
            }}
          >
            Your studio. In one place.
          </h2>
        </div>

        <FeatureHero
          index="01"
          label="Artist entry & booking"
          title="One link for every Artist."
          body="Share one Skitza link. Artists can hear public samples, create an account for your studio, view private products and prices after sign-in, and request an eligible time. Sessions confirm automatically only when you enable auto-confirm; otherwise you approve them."
        >
          <FeatureStorefrontMock />
        </FeatureHero>

        <FeatureHero
          index="02"
          label="Files & feedback"
          title="Feedback stays with the right version."
          body="Artists leave timestamped comments on exact audio versions. Downloads stay locked until the Producer confirms the required external payment, unless the Producer explicitly allows an early download."
          reverse
        >
          <FeatureLockedMock />
        </FeatureHero>

        <FeatureHero
          index="03"
          label="Email reminders"
          title="Keep sessions and payments moving."
          body="Skitza sends booking updates, session reminders, comment alerts, and payment reminders by email. Producers stay in control of the business record."
        >
          <FeatureAutomationMock />
        </FeatureHero>
      </div>
    </section>
  );
}

function FeatureHero({
  index,
  label,
  title,
  body,
  children,
  reverse,
}: {
  index: string;
  label: string;
  title: string;
  body: string;
  children: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 py-12 sm:gap-10 sm:py-16 lg:grid-cols-2 lg:gap-16">
      <div
        className={(reverse ? "sk-reveal-right" : "sk-reveal-left") + " min-w-0"}
        style={{ order: reverse ? 2 : 1 }}
      >
        <div
          className="mb-4 font-mono text-[11px]"
          style={{ color: "rgb(var(--brand-primary))", letterSpacing: "-0.01em" }}
        >
          {index} / {label}
        </div>
        <h3
          className="font-syne m-0 font-extrabold"
          style={{
            fontSize: "clamp(26px, 3.5vw, 38px)",
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
          }}
        >
          {title}
        </h3>
        <p
          className="mt-4 text-[15px] leading-[1.55] sm:text-base"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          {body}
        </p>
      </div>
      <div
        className={(reverse ? "sk-reveal-left" : "sk-reveal-right") + " sk-d-2 min-w-0"}
        style={{ order: reverse ? 1 : 2 }}
      >
        {children}
      </div>
    </div>
  );
}

function FeatureStorefrontMock() {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        background: "#fff",
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "0 20px 50px rgba(17,16,9,0.1)",
      }}
    >
      <div className="mb-3.5 flex items-center justify-between">
        <span className="font-mono text-[10px]" style={{ color: "#6b6359" }}>
          skitza.app/artist/store
        </span>
        <span
          className="rounded px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] uppercase"
          style={{
            background: "rgba(34,197,94,0.10)",
            color: "rgb(var(--fg-success))",
            border: "1px solid rgba(34,197,94,0.22)",
          }}
        >
          Signed in
        </span>
      </div>
      <div
        className="font-syne mb-3 text-[22px] font-extrabold"
        style={{ letterSpacing: "-0.035em" }}
      >
        Studio services
      </div>
      <div className="flex flex-col gap-2.5">
        {[
          { n: "Full Production Package", d: "Beat + tracking + mix", p: "$1,500", g: "grad-rose" },
          { n: "3-hour Mixing Session", d: "One song, one room", p: "$150", g: "grad-amber" },
          { n: "Mastering Pass", d: "Streaming-ready", p: "$200", g: "grad-violet" },
        ].map((s) => (
          <div
            key={s.n}
            className="sk-lift flex items-center gap-3 rounded-xl border bg-white p-3"
            style={{ borderColor: "rgb(var(--border-subtle))" }}
          >
            <div className={`${s.g} h-9 w-9 shrink-0 rounded-[10px]`} aria-hidden />
            <div className="flex-1">
              <div className="text-[13px] font-bold">{s.n}</div>
              <div className="text-[11px]" style={{ color: "#6b6359" }}>
                {s.d}
              </div>
            </div>
            <div className="font-mono text-[14px] font-bold">{s.p}</div>
            <div
              className="rounded-md px-3 py-1.5 text-[11px] font-bold text-white"
              style={{ background: "#111009" }}
            >
              Review →
            </div>
          </div>
        ))}
      </div>
      {/* Calendar peek */}
      <div
        className="mt-3.5 rounded-xl border p-3"
        style={{
          background: "rgb(var(--bg-background))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <div className="label-tiny mb-2">Available session times</div>
        <div className="grid grid-cols-5 gap-1.5">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => (
            <div
              key={d}
              className="rounded-md border p-2 text-center text-[10px] font-bold"
              style={{
                background: i === 1 ? "rgb(var(--brand-primary))" : "#fff",
                borderColor: "rgb(var(--border-subtle))",
                color: "#111009",
              }}
            >
              <div>{d}</div>
              <div className="mt-1 font-mono text-[13px]">{6 + i}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureLockedMock() {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "#111009",
        color: "#fff",
        boxShadow: "0 20px 50px rgba(17,16,9,0.25)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="mb-3.5 flex gap-2">
        {["v3", "v2", "v1"].map((v, i) => (
          <span
            key={v}
            className="rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold"
            style={{
              background: i === 0 ? "rgba(212,150,10,0.18)" : "rgb(255 255 255 / 0.04)",
              color: i === 0 ? "rgb(var(--brand-primary))" : "rgb(255 255 255 / 0.5)",
              borderColor: i === 0 ? "rgba(212,150,10,0.3)" : "rgb(255 255 255 / 0.06)",
            }}
          >
            Mix · {v}
          </span>
        ))}
      </div>
      <div className="relative mb-4 flex items-center gap-0.5" style={{ height: 72 }}>
        {Array.from({ length: 48 }).map((_, i) => {
          const v = 0.3 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.3)) * 0.6;
          const played = i < 24;
          return (
            <div
              key={i}
              className="flex-1"
              style={{
                // Keep the SSR and browser-normalized CSS value identical so
                // React does not report a hydration mismatch for long floats.
                height: `${(v * 100).toFixed(4)}%`,
                borderRadius: 1,
                background: played ? "rgb(var(--brand-primary))" : "rgb(255 255 255 / 0.18)",
              }}
            />
          );
        })}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: "50%" }} />
        <div
          className="absolute flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold"
          style={{
            left: "36%",
            top: -4,
            background: "rgb(var(--brand-primary))",
            border: "2px solid #111009",
            color: "#111009",
          }}
        >
          R
        </div>
      </div>
      <div
        className="mb-4 rounded-[10px] border p-3"
        style={{
          background: "rgb(255 255 255 / 0.04)",
          borderColor: "rgb(255 255 255 / 0.06)",
        }}
      >
        <div className="mb-1 flex items-center gap-2">
          <span
            className="font-mono text-[10px] font-bold"
            style={{ color: "rgb(var(--brand-primary))" }}
          >
            01:42
          </span>
          <span className="text-[11px] font-bold">Marcus T.</span>
        </div>
        <div className="text-[12px] leading-[1.4]" style={{ color: "rgb(255 255 255 / 0.7)" }}>
          &ldquo;Snare&apos;s a touch loud here — can we drop 2dB?&rdquo;
        </div>
      </div>
      <div
        className="flex items-center gap-3 rounded-[10px] border p-3.5"
        style={{
          background: "rgba(220,38,38,0.08)",
          borderColor: "rgba(220,38,38,0.2)",
        }}
      >
        <div
          className="flex h-9 w-9 items-center justify-center rounded-md"
          style={{ background: "rgba(220,38,38,0.18)", color: "#fca5a5" }}
        >
          <Icon name="lock" size={16} strokeWidth={2.4} />
        </div>
        <div className="flex-1">
          <div className="text-[12.5px] font-bold">Final_Master.wav · 24/48</div>
          <div
            className="mt-0.5 font-mono text-[10.5px]"
            style={{ color: "rgba(252,165,165,0.85)" }}
          >
            Unlocks after $150 is confirmed
          </div>
        </div>
        <span
          className="font-mono text-[10px] font-bold tracking-[0.08em] uppercase"
          style={{ color: "#fca5a5" }}
        >
          Locked
        </span>
      </div>
    </div>
  );
}

function FeatureAutomationMock() {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        background: "#fff",
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "0 20px 50px rgba(17,16,9,0.08)",
      }}
    >
      <div className="label-tiny mb-3">Email activity · example</div>
      <div className="flex flex-col gap-2.5">
        {[
          {
            who: "Marcus T.",
            when: "09:14",
            msg: "Hey Marcus, your session is confirmed for Tue 15:00 🎛",
            kind: "Email",
            g: "grad-rose",
          },
          {
            who: "Yael N.",
            when: "11:42",
            msg: "Just a heads up — final balance ($150) is due tomorrow.",
            kind: "Email",
            g: "grad-violet",
          },
          {
            who: "The Halflights",
            when: "14:08",
            msg: "A new version is ready for your review.",
            kind: "Email",
            g: "grad-emerald",
          },
          {
            who: "Dana R.",
            when: "16:55",
            msg: "A new comment was added at 01:42.",
            kind: "Email",
            g: "grad-amber",
          },
        ].map((m) => (
          <div
            key={m.who}
            className="flex gap-2.5 rounded-[10px] border p-2.5"
            style={{
              background: "rgb(var(--bg-background))",
              borderColor: "rgb(var(--border-subtle))",
            }}
          >
            <div
              className={`${m.g} flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold`}
              style={{ color: "#111009" }}
              aria-hidden
            >
              {m.who
                .split(" ")
                .map((s) => s[0])
                .join("")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="text-[12px] font-bold">{m.who}</span>
                <span className="font-mono text-[9.5px]" style={{ color: "#6b6359" }}>
                  {m.when} · {m.kind}
                </span>
              </div>
              <div className="text-[12px] leading-[1.4]" style={{ color: "#111009" }}>
                {m.msg}
              </div>
            </div>
            <Icon name="check-check" size={14} strokeWidth={2.4} className="shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// 5. Feature grid (6 cards)
// =============================================================================

function FeatureGrid() {
  const items: Array<{ i: IconName; t: string; b: string }> = [
    {
      i: "file-signature",
      t: "Exact terms, accepted in-app",
      b: "Artists review and accept the exact service, rights, royalty, revision, and payment terms shown to them.",
    },
    {
      i: "users",
      t: "Client history, all in one place",
      b: "Every session, payment, and file. Know who's a repeat, who owes you, who referred you.",
    },
    {
      i: "inbox",
      t: "Bookings that respect availability",
      b: "Working hours, blackouts, active sessions, and selected Google busy times protect each eligible slot.",
    },
    {
      i: "shield-check",
      t: "Private files, controlled delivery",
      b: "Uploaded audio stays in private Cloudflare R2 storage. Playback and downloads use authorized delivery.",
    },
    {
      i: "globe",
      t: "One link for each studio",
      b: "Artists use one Producer link to hear public samples, join that studio, and return to their work.",
    },
    {
      i: "smartphone",
      t: "Works on every device",
      b: "Your link opens beautifully on iPhone, Android, or laptop. No app to install — just one URL your clients tap.",
    },
  ];
  return (
    <section
      id="feature-grid"
      className="px-6 pt-8 pb-16 sm:px-5 sm:pt-10 sm:pb-[88px]"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => (
            <div
              key={it.t}
              className={`sk-lift sk-reveal sk-d-${String((i % 3) + 1)} rounded-2xl border`}
              style={{
                background: "#fff",
                borderColor: "rgb(var(--border-subtle))",
                padding: 22,
              }}
            >
              <div
                className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] border"
                style={{
                  background: "rgba(212,150,10,0.12)",
                  borderColor: "rgba(212,150,10,0.2)",
                  color: "rgb(var(--brand-primary))",
                }}
              >
                <Icon name={it.i} size={17} strokeWidth={2.2} />
              </div>
              <div
                className="font-syne mb-1.5 text-[17px] font-bold"
                style={{ letterSpacing: "-0.02em" }}
              >
                {it.t}
              </div>
              <div className="text-[13px] leading-[1.5]" style={{ color: "rgb(var(--fg-muted))" }}>
                {it.b}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// 6. How it works (dark, 3 steps)
// =============================================================================

function HowSection() {
  const steps = [
    {
      n: "01",
      t: "Connect Google Calendar",
      b: "Choose calendars. Skitza checks selected busy times to avoid conflicts and creates or updates Skitza session events. Unrelated event details stay private.",
    },
    {
      n: "02",
      t: "Set your studio rules",
      b: "Define services, availability, external-payment instructions, and whether eligible sessions confirm automatically.",
    },
    {
      n: "03",
      t: "Share one Producer link",
      b: "Artists can hear public music, join your studio, and keep bookings, agreements, files, and payment records together.",
    },
  ];
  return (
    <section
      id="how"
      className="relative overflow-hidden px-6 py-16 sm:px-5 sm:py-[88px]"
      style={{ background: "#111009", color: "#fff" }}
    >
      <div className="animate-shine" />
      <div className="relative mx-auto max-w-6xl">
        <div className="sk-reveal mb-10 text-center sm:mb-14">
          <div className="label-tiny" style={{ color: "rgba(212,150,10,0.7)" }}>
            03 · Setup
          </div>
          <h2
            className="font-syne mt-3.5 font-extrabold"
            style={{
              fontSize: "clamp(30px, 4vw, 52px)",
              letterSpacing: "-0.035em",
              lineHeight: 1.02,
            }}
          >
            Set it up once. Let it run forever.
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className={`sk-reveal sk-d-${String(i + 1)} rounded-2xl border p-7`}
              style={{
                background: "rgb(255 255 255 / 0.04)",
                borderColor: "rgb(255 255 255 / 0.08)",
              }}
            >
              <div
                className="mb-4 font-mono text-[38px] font-extrabold"
                style={{
                  color: "rgb(var(--brand-primary))",
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                {s.n}
              </div>
              <div
                className="font-syne mb-2 text-[20px] font-bold"
                style={{ letterSpacing: "-0.025em" }}
              >
                {s.t}
              </div>
              <div
                className="text-[13.5px] leading-[1.5]"
                style={{ color: "rgb(255 255 255 / 0.6)" }}
              >
                {s.b}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// 7. Founder note
// =============================================================================

function FounderNote() {
  return (
    <section
      id="founder"
      className="border-t px-6 py-16 sm:px-5 sm:py-[88px]"
      style={{
        background: "rgb(var(--bg-background))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <div className="sk-reveal mx-auto flex max-w-3xl flex-col gap-5 sm:flex-row sm:gap-8">
        <div
          className="grad-amber flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[18px] font-extrabold"
          style={{ color: "#111009" }}
          aria-hidden
        >
          GA
        </div>
        <div>
          <div className="label-tiny mb-3.5">From the founder</div>
          <p
            className="m-0 text-[17px] leading-[1.6]"
            style={{ color: "rgb(var(--fg-default))", fontWeight: 500 }}
          >
            I built Skitza after a mix went unpaid. No accepted agreement, no clear delivery record
            — the artist disappeared, and I had nothing solid to point at. The tools to prevent it
            existed; the record was just scattered across separate apps.
          </p>
          <p className="mt-4 text-[15px] leading-[1.6]" style={{ color: "rgb(var(--fg-muted))" }}>
            Calendly for booking. Samply for files. Notion for notes. DocuSign for the contract.
            Stripe for the deposit. WhatsApp for everything else. The friction <em>was</em> the
            product. Skitza is what I wish I&apos;d had that night — one link, every client, every
            dollar tracked. Built so you can spend Friday night mixing instead of resending a WAV
            for the third time.
          </p>
          <div className="mt-5 text-[13px]" style={{ color: "rgb(var(--fg-muted))" }}>
            — <strong style={{ color: "rgb(var(--fg-default))" }}>Gili Asraf</strong>, founder
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// 8. Pricing
// =============================================================================

function Pricing() {
  return (
    <section
      id="pricing"
      className="px-6 pb-16 sm:px-5 sm:pb-[88px]"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="mx-auto max-w-3xl">
        <div className="sk-reveal mb-10 text-center">
          <div className="label-tiny">04 · Pricing</div>
          <h2
            className="font-syne mt-3.5 font-extrabold"
            style={{
              fontSize: "clamp(30px, 4vw, 52px)",
              letterSpacing: "-0.035em",
              lineHeight: 1.02,
            }}
          >
            Early access is invitation-only.
          </h2>
        </div>

        <div
          className="sk-reveal-scale sk-d-1 relative overflow-hidden rounded-3xl border p-6 sm:p-8"
          style={{
            background: "#fff",
            borderColor: "rgb(var(--border-subtle))",
            boxShadow: "0 20px 50px rgba(17,16,9,0.08)",
          }}
        >
          <div
            className="absolute top-0 right-0 rounded-bl-xl px-4 py-2 text-[10.5px] font-bold tracking-[0.1em] uppercase"
            style={{ background: "rgb(var(--brand-primary))", color: "#111009" }}
          >
            Beta
          </div>

          <div className="mt-2.5 mb-2 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <span
              className="font-syne text-[56px] font-extrabold sm:text-[64px]"
              style={{ letterSpacing: "-0.04em", lineHeight: 1 }}
            >
              Free
            </span>
            <span className="text-[14px]" style={{ color: "rgb(var(--fg-muted))" }}>
              during beta
            </span>
          </div>
          <div
            className="mb-6 font-mono text-[11.5px]"
            style={{ color: "rgb(var(--brand-primary))" }}
          >
            · Skitza does not collect a card for beta access ·
          </div>

          <div className="mb-7 grid gap-y-2 sm:grid-cols-2 sm:gap-x-5">
            {[
              "1 GB of Producer audio storage",
              "Client and project workspace",
              "Versioned audio and feedback",
              "Bookings and session records",
              "Exact agreements and external-payment history",
              "Optional Google Calendar sync",
              "Email notifications and reminders",
              "Controlled playback and downloads",
            ].map((f) => (
              <div key={f} className="flex items-center gap-2 text-[13.5px]">
                <Icon name="check" size={14} strokeWidth={3} className="shrink-0" />
                {f}
              </div>
            ))}
          </div>

          <Link
            href={PRODUCER_ACCESS_HREF}
            className="sk-pop sk-press block min-h-11 w-full rounded-xl px-5 py-4 text-center text-[15px] font-bold"
            style={{ background: "#111009", color: "#fff" }}
          >
            Producer access →
          </Link>
          <div
            className="mt-3 text-center font-mono text-[11.5px]"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            Invitation-only · Artist signup stays open through Producer links
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// 9. FAQ
// =============================================================================

function FAQ({
  activeFaq,
  setActiveFaq,
}: {
  activeFaq: number | null;
  setActiveFaq: (n: number | null) => void;
}) {
  const items = [
    {
      q: "Do you store my audio files?",
      a: "Yes. Skitza stores uploaded audio in private Cloudflare R2 storage. Protected playback and downloads use authorized delivery. Keep your own backup of any file that is critical to your business.",
    },
    {
      q: "What if my client doesn't pay?",
      a: "Payment happens outside Skitza using the Producer's instructions. The Artist can upload proof and the Producer records what was received. Downloads remain locked until the required payment is confirmed, unless the Producer explicitly allows an early download.",
    },
    {
      q: "Can I use my own domain?",
      a: "Not in the current beta. Each Producer gets a Skitza link such as skitza.app/join/your-name.",
    },
    {
      q: "What does the Google Calendar connection do?",
      a: "A Producer can choose calendars whose busy times block Artist booking and one destination calendar for Skitza session events. Skitza does not display or store unrelated Google event titles, attendees, locations, or descriptions.",
    },
    {
      q: "Can I import my existing clients and audio?",
      a: "You can add clients and upload audio to projects. CSV client import and third-party audio migration are not available in the current beta.",
    },
  ];
  return (
    <section
      id="faq"
      className="px-6 pb-16 sm:px-5 sm:pb-[88px]"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="mx-auto max-w-3xl">
        <div className="sk-reveal mb-8">
          <div className="label-tiny">05 · FAQ</div>
          <h2
            className="font-syne mt-3.5 font-extrabold"
            style={{
              fontSize: "clamp(30px, 4vw, 44px)",
              letterSpacing: "-0.035em",
              lineHeight: 1.02,
            }}
          >
            Things people ask before requesting access.
          </h2>
        </div>
        <div style={{ borderTop: "1px solid rgb(var(--border-subtle))" }}>
          {items.map((it, i) => {
            const open = activeFaq === i;
            return (
              <div key={it.q} style={{ borderBottom: "1px solid rgb(var(--border-subtle))" }}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveFaq(open ? null : i);
                  }}
                  className="sk-row sk-press flex min-h-11 w-full items-center justify-between px-1 py-5 text-left"
                  aria-expanded={open}
                  aria-controls={`faq-panel-${String(i)}`}
                >
                  <span
                    className="text-[15.5px] font-semibold"
                    style={{ letterSpacing: "-0.01em" }}
                  >
                    {it.q}
                  </span>
                  <Icon
                    name={open ? "minus" : "plus"}
                    size={18}
                    strokeWidth={2.4}
                    className="shrink-0"
                  />
                </button>
                {open && (
                  <div
                    id={`faq-panel-${String(i)}`}
                    className="px-1 pb-6 text-[14px] leading-[1.6]"
                    style={{ color: "rgb(var(--fg-muted))" }}
                  >
                    {it.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// 10. Final CTA
// =============================================================================

function FinalCTA() {
  return (
    <section
      id="final-cta"
      className="final-cta relative overflow-hidden px-6 py-20 text-center sm:px-5 sm:py-[120px]"
      style={{ background: "#111009", color: "#fff" }}
    >
      <div className="animate-shine" />
      <div className="sk-reveal-scale relative mx-auto max-w-3xl">
        <h2
          className="font-syne m-0 font-extrabold"
          style={{
            fontSize: "clamp(40px, 5vw, 72px)",
            letterSpacing: "-0.038em",
            lineHeight: 0.98,
          }}
        >
          One shared record for your studio
          <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
        </h2>
        <p className="mt-5 text-[16px] leading-[1.5]" style={{ color: "rgb(255 255 255 / 0.6)" }}>
          Keep clients, projects, sessions, agreements, external-payment records, and music work
          together.
        </p>
        <Link
          href={PRODUCER_ACCESS_HREF}
          className="sk-pop sk-press mt-8 inline-flex min-h-11 w-full items-center justify-center gap-2.5 rounded-xl px-7 py-4 text-[15px] font-bold sm:w-auto"
          style={{
            background: "rgb(var(--brand-primary))",
            color: "#111009",
            boxShadow: "0 12px 30px rgba(212,150,10,0.4)",
          }}
        >
          Learn about Producer access
          <Icon name="arrow-right" size={16} strokeWidth={2.6} />
        </Link>
        <div
          className="mt-3.5 font-mono text-[11.5px]"
          style={{ color: "rgb(255 255 255 / 0.55)" }}
        >
          Invitation-only · sent by Skitza
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// 11. Footer
// =============================================================================

function LandingFooter() {
  return (
    <footer
      style={{
        background: "#0a0905",
        color: "rgb(255 255 255 / 0.5)",
        padding:
          "36px max(20px, env(safe-area-inset-right)) max(36px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))",
        borderTop: "1px solid rgb(255 255 255 / 0.06)",
        fontSize: 12,
      }}
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 text-center sm:flex-row sm:flex-wrap sm:justify-between sm:text-left">
        <LogoLockup markSize={24} wordmarkSize={16} />
        <span className="order-3 font-mono sm:order-none">
          © 2026 · Built for producers, by producers
        </span>
        <div className="flex gap-6 sm:gap-5">
          <Link
            href="/privacy"
            style={{ color: "inherit" }}
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 hover:text-white"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            style={{ color: "inherit" }}
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 hover:text-white"
          >
            Terms
          </Link>
          <Link
            href="/about"
            style={{ color: "inherit" }}
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 hover:text-white"
          >
            About
          </Link>
        </div>
      </div>
    </footer>
  );
}
