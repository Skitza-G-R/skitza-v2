"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { NoiseOverlay } from "~/components/landing/noise-overlay";
import { RevealOnScroll } from "~/components/landing/reveal-on-scroll";

// Verbatim port of the founder's source HTML
// (`docs/plans/active/2026-04-26-landing-restore-source.html`, lines 1144-1846)
// into a SINGLE client component. Pivoted to this shape after PR #50's
// 17-component decomposition broke the hero word-fade animation: the
// original script adds `.page-loaded` to the document body, but the
// React port added it to `<html>` instead, so the
// `.landing-root .page-loaded .hero-word` selector never matched and
// every hero word stayed at opacity 0.
//
// The single-file approach mirrors the source HTML one-to-one. JSX
// structure follows the source line-for-line; the entire `<script>`
// block (source lines 1894-2050) runs inside one `useEffect`. CTAs +
// social proof copy + injected sections (TrustBar, Compare, Security,
// FAQ, Founder, Download) are the only deltas vs the source.
//
// Mobile-menu behaviour is React-controlled via `menuOpen` so the JSX
// stays idiomatic; everything else (hero word stagger, navbar
// scroll-shadow, IntersectionObserver, feature-tabs indicator,
// pain-card spotlight, pricing-card 3D tilt, flow-diagram sequence)
// runs imperatively against the DOM exactly as the source script did.
//
// `landing.css` is imported by `apps/web/src/app/page.tsx` (the server
// component that wraps this) and stays unchanged.
export function LandingPage() {
  // FAQ accordion — single-active-item state. Carried over from the
  // original FAQ component since its behaviour matches the source HTML
  // gap (the source shipped no FAQ).
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  // Mobile-menu toggle — source HTML had a `mobile-menu-btn` with no JS
  // wired up. We add a minimal toggle that flips an inline display on
  // the `.nav-links` list so producers on phones can reach the anchor
  // links without scrolling through the nav.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // Source script lines 1894-2050. Reproduced as a single
    // imperative block — keeping the mutation pattern identical to
    // the source so any future tweak by the founder can be applied
    // to both files without translation.

    // 1. Hero word-fade stagger (source 1898-1909).
    //
    // The source uses `innerHTML` to inject the `.hero-word` spans.
    // We use safe DOM methods (createElement + textContent) instead —
    // same visual outcome, no XSS surface from `innerHTML`. The text
    // content is a hard-coded constant so the risk is zero either way,
    // but the explicit-DOM path is the codebase convention.
    const titleParts: { text: string; lineBreakBefore: boolean }[] = [
      { text: "Stop chasing payments.", lineBreakBefore: false },
      { text: "Just make music.", lineBreakBefore: true },
    ];
    const titleEl = document.getElementById("hero-title");
    if (titleEl) {
      titleEl.replaceChildren();
      titleParts.forEach((part, index) => {
        if (part.lineBreakBefore) {
          titleEl.appendChild(document.createElement("br"));
        }
        const span = document.createElement("span");
        span.className = "hero-word";
        span.style.transitionDelay = `${String(index * 0.15)}s`;
        span.textContent = part.text;
        titleEl.appendChild(span);
      });
    }

    // Source script adds `.page-loaded` to the document body. Our
    // landing.css uses the chained-class pattern `.landing-root.page-loaded`
    // (S1 originally ported this with a stray space — descendant
    // combinator — which left every fade-in element invisible; fixed
    // by re-running the CSS port with chained class). Just add the
    // class to `.landing-root` itself; no children-propagation hack.
    const pageLoadedTimer = setTimeout(() => {
      document.querySelector(".landing-root")?.classList.add("page-loaded");
    }, 100);

    // 2. Navbar scroll-shadow (source 1913-1918).
    const navbar = document.getElementById("navbar");
    const onScroll = () => {
      if (!navbar) return;
      if (window.scrollY > 50) navbar.classList.add("scrolled");
      else navbar.classList.remove("scrolled");
    };
    window.addEventListener("scroll", onScroll);

    // 3. Premium scroll-reveal (source 1920-1932).
    //
    // The repo's existing `<RevealOnScroll />` component already runs
    // an IntersectionObserver against `.landing-root .reveal-up`. We
    // run our own here too so the source script's flow-diagram
    // sequencing (which fires `animateFlowDiagram()` when
    // `#flow-diagram` first intersects) stays attached. Both observers
    // adding `.is-revealed` is a no-op (idempotent) so there is no
    // double-fire concern.
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries, obs) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-revealed");
              if (entry.target.id === "flow-diagram") {
                animateFlowDiagram();
              }
              obs.unobserve(entry.target);
            }
          });
        },
        { root: null, rootMargin: "0px", threshold: 0.15 },
      );
      document.querySelectorAll(".reveal-up").forEach((el) => {
        observer?.observe(el);
      });
    }

    // 4. Feature-tabs (source 1934-1964) — imperative, indicator-driven.
    const tabs = document.querySelectorAll<HTMLElement>(".feature-tab");
    const contents = document.querySelectorAll<HTMLElement>(".feature-content");
    const indicator = document.getElementById("feature-indicator");

    function updateIndicator(activeTab: HTMLElement) {
      if (window.innerWidth <= 992) return;
      const listEl = document.querySelector(".features-list");
      if (!listEl || !indicator) return;
      const listRect = listEl.getBoundingClientRect();
      const tabRect = activeTab.getBoundingClientRect();
      const offsetTop = tabRect.top - listRect.top;
      indicator.style.transform = `translateY(${String(offsetTop)}px)`;
      indicator.style.height = `${String(tabRect.height)}px`;
    }

    const tabClickHandlers: { tab: HTMLElement; handler: () => void }[] = [];
    tabs.forEach((tab, index) => {
      const handler = () => {
        tabs.forEach((t) => {
          t.classList.remove("active");
        });
        contents.forEach((c) => {
          c.classList.remove("active");
        });
        tab.classList.add("active");
        document.getElementById(`feat-${String(index)}`)?.classList.add("active");
        updateIndicator(tab);
      };
      tab.addEventListener("click", handler);
      tabClickHandlers.push({ tab, handler });
    });

    const indicatorTimer = setTimeout(() => {
      const firstActive =
        document.querySelector<HTMLElement>(".feature-tab.active");
      if (firstActive) updateIndicator(firstActive);
    }, 200);

    // 5. Flow diagram sequential animation (source 1966-1974).
    function animateFlowDiagram() {
      const line = document.getElementById("flow-line-active");
      const nodes = document.querySelectorAll<HTMLElement>(".flow-node");
      if (line) line.style.width = "100%";
      nodes.forEach((node, index) => {
        setTimeout(() => {
          node.classList.add("active");
        }, index * 300 + 300);
      });
    }

    // 6. Pain-card mouse spotlight (source 1976-1985).
    const painCards = document.querySelectorAll<HTMLElement>(".pain-card");
    const painMoveHandlers: {
      card: HTMLElement;
      handler: (e: MouseEvent) => void;
    }[] = [];
    painCards.forEach((card) => {
      const handler = (e: MouseEvent) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mouse-x", `${String(e.clientX - rect.left)}px`);
        card.style.setProperty("--mouse-y", `${String(e.clientY - rect.top)}px`);
      };
      card.addEventListener("mousemove", handler);
      painMoveHandlers.push({ card, handler });
    });

    // 7. Pricing-card 3D tilt (source 1987-2008). Desktop-only.
    const pricingCard = document.getElementById("pricing-card-3d");
    let pricingMoveHandler: ((e: MouseEvent) => void) | undefined;
    let pricingLeaveHandler: (() => void) | undefined;
    if (pricingCard && window.innerWidth > 768) {
      pricingMoveHandler = (e: MouseEvent) => {
        const rect = pricingCard.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -6;
        const rotateY = ((x - centerX) / centerX) * 6;
        pricingCard.style.transition = "transform 0.1s ease-out";
        pricingCard.style.transform = `perspective(1200px) rotateX(${String(rotateX)}deg) rotateY(${String(rotateY)}deg) scale3d(1.02, 1.02, 1.02)`;
      };
      pricingLeaveHandler = () => {
        pricingCard.style.transition =
          "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)";
        pricingCard.style.transform =
          "perspective(1200px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
      };
      pricingCard.addEventListener("mousemove", pricingMoveHandler);
      pricingCard.addEventListener("mouseleave", pricingLeaveHandler);
    }

    return () => {
      clearTimeout(pageLoadedTimer);
      clearTimeout(indicatorTimer);
      window.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      tabClickHandlers.forEach(({ tab, handler }) => {
        tab.removeEventListener("click", handler);
      });
      painMoveHandlers.forEach(({ card, handler }) => {
        card.removeEventListener("mousemove", handler);
      });
      if (pricingCard) {
        if (pricingMoveHandler)
          pricingCard.removeEventListener("mousemove", pricingMoveHandler);
        if (pricingLeaveHandler)
          pricingCard.removeEventListener("mouseleave", pricingLeaveHandler);
      }
    };
  }, []);

  return (
    <div className="landing-root">
      <NoiseOverlay />
      <RevealOnScroll />

      {/* Navigation — source lines 1148-1187 */}
      <nav id="navbar">
        <div className="container nav-inner">
          <a href="#" className="sk-brand-link">
            <div className="sk-icon-wrap nav-scale">
              <div className="sk-logo-icon">
                <div className="sk-rings"></div>
                <div className="sk-papers">
                  <div className="sk-paper p1"></div>
                  <div className="sk-paper p2"></div>
                  <div className="sk-paper p3">
                    <div className="sk-stamp">OVERDUE</div>
                  </div>
                </div>
                <div className="sk-char">
                  <div className="sk-headphone-band"></div>
                  <div className="sk-head">
                    <div className="sk-steam st1"></div>
                    <div className="sk-steam st2"></div>
                    <div className="sk-sweat"></div>
                    <div className="sk-brow l"></div>
                    <div className="sk-brow r"></div>
                    <div className="sk-eye l"></div>
                    <div className="sk-eye r"></div>
                    <div className="sk-mouth"></div>
                  </div>
                  <div className="sk-earcup l"></div>
                  <div className="sk-earcup r"></div>
                </div>
                <div className="sk-badge">9</div>
              </div>
            </div>
            <div className="sk-wordmark-wrap">
              <span className="sk-wordmark">Skitza</span>
              <div className="sk-underline"></div>
            </div>
          </a>
          <ul
            className="nav-links"
            style={menuOpen ? { display: "flex" } : undefined}
          >
            <li>
              <a href="#features" className="nav-link">
                Features
              </a>
            </li>
            <li>
              <a href="#how-it-works" className="nav-link">
                How It Works
              </a>
            </li>
            <li>
              <a href="#pricing" className="nav-link">
                Pricing
              </a>
            </li>
            <li>
              <Link href="/sign-in" className="nav-link">
                Sign in
              </Link>
            </li>
          </ul>
          <Link
            href="/sign-up?redirect_url=%2Fonboarding"
            className="btn-primary small nav-btn"
          >
            Sign up now
          </Link>
          <button
            type="button"
            className="mobile-menu-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
          >
            ☰
          </button>
        </div>
      </nav>

      {/* SECTION 1: HERO (LIGHT OFF-WHITE) — source 1189-1269 */}
      <header className="hero" id="hero">
        <div className="blob-amber ambient-blob"></div>
        <div className="blob-copper ambient-blob"></div>

        <div className="container">
          <div className="sk-brand-link hero-mode">
            <div className="sk-icon-wrap hero-scale">
              <div className="sk-logo-icon">
                <div className="sk-rings"></div>
                <div className="sk-papers">
                  <div className="sk-paper p1"></div>
                  <div className="sk-paper p2"></div>
                  <div className="sk-paper p3">
                    <div className="sk-stamp">OVERDUE</div>
                  </div>
                </div>
                <div className="sk-char">
                  <div className="sk-headphone-band"></div>
                  <div className="sk-head">
                    <div className="sk-steam st1"></div>
                    <div className="sk-steam st2"></div>
                    <div className="sk-sweat"></div>
                    <div className="sk-brow l"></div>
                    <div className="sk-brow r"></div>
                    <div className="sk-eye l"></div>
                    <div className="sk-eye r"></div>
                    <div className="sk-mouth"></div>
                  </div>
                  <div className="sk-earcup l"></div>
                  <div className="sk-earcup r"></div>
                </div>
                <div className="sk-badge">9</div>
              </div>
            </div>
            <div className="sk-wordmark-wrap">
              <span className="sk-wordmark">Skitza</span>
            </div>
          </div>

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
          <style>{`@keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }`}</style>

          <h1 id="hero-title" className="syne">
            Stop chasing payments. Just make music.
          </h1>

          <p className="sub-copy body-text">
            Skitza is the only link you need.<br />
            Clients book sessions, sign contracts, and pay automatically<br />
            and your final mixes stay locked until the invoice is cleared.
          </p>

          <div className="hero-ctas">
            <Link
              href="/sign-up?redirect_url=%2Fonboarding"
              className="btn-primary"
            >
              Sign up now
            </Link>
            <a className="btn-ghost" href="#pain">
              See how it works ↓
            </a>
          </div>

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
          <div className="trust-bar">
            ★★★★★ Built for solo producers.
          </div>

          {/* UI Mockup Cards with Floating Anim — source 1247-1267 */}
          <div className="hero-mockup">
            <div className="mockup-glow"></div>
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

      {/* INJECTED SECTION (S3): TrustBar — light strip after Hero, before
          theme-transition. Was a separate component pre-pivot. */}
      <section
        className="trust-strip"
        aria-label="Press and publication mentions"
      >
        <div className="container">
          <div className="trust-strip-inner">
            <span className="label">As featured in</span>
            <div className="trust-logos syne">
              {["Pitchfork", "Resident Advisor", "Bandcamp Daily", "MusicTech", "Production Expert"].map(
                (name, i, arr) => (
                  <span
                    key={name}
                    style={{ display: "inline-flex", alignItems: "center", gap: 32 }}
                  >
                    <span className="trust-logo">{name}</span>
                    {i < arr.length - 1 ? (
                      <span className="trust-divider" aria-hidden>
                        ·
                      </span>
                    ) : null}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      {/* THE CINEMATIC DISSOLVE (Pulled behind hero) — source 1271-1272 */}
      <section className="theme-transition"></section>

      {/* DARK TERRITORY — source 1274 */}
      <main className="dark-world">
        {/* SECTION 2: PAIN — source 1277-1410 */}
        <section className="section" id="pain">
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">01</span>
              <span className="label" style={{ color: "var(--copper)" }}>
                Sound familiar?
              </span>
              <h2 className="syne">
                You became a producer.<br />
                Not a secretary.
              </h2>
              <p className="body-text" style={{ marginLeft: 0 }}>
                Yet here you are — scheduling, invoicing, chasing,<br />
                reminding, resending, following up.<br />
                Every day. Before you&apos;ve played a single note.
              </p>
            </div>

            <div className="pain-grid">
              <div className="card pain-card reveal-up delay-1">
                <div className="pain-ill">
                  <div className="meme-face face-1">
                    <div className="f1-acc">...same answer</div>
                    <div className="m-brow l"></div>
                    <div className="m-brow r"></div>
                    <div className="m-eye l"></div>
                    <div className="m-eye r"></div>
                    <div className="m-mouth"></div>
                  </div>
                  <div className="ill-chat-wrap">
                    <div className="ill-bubble">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    <div className="ill-bubble-2">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
                <h3>&quot;What are your rates?&quot;</h3>
                <p>
                  You&apos;ve copy-pasted that answer so many times<br />
                  you could send it in your sleep.
                </p>
              </div>

              <div className="card pain-card reveal-up delay-2">
                <div className="pain-ill">
                  <div className="meme-face face-2">
                    <div className="f2-acc"></div>
                    <div className="m-brow l"></div>
                    <div className="m-brow r"></div>
                    <div className="m-eye l"></div>
                    <div className="m-eye r"></div>
                    <div className="m-mouth"></div>
                  </div>
                  <div className="ill-calendar">
                    <div className="ill-cal-cell">×</div>
                    <div className="ill-cal-cell">×</div>
                    <div className="ill-cal-cell amber-q">?</div>
                    <div className="ill-cal-cell">×</div>
                    <div className="ill-cal-cell">×</div>
                    <div className="ill-cal-cell amber-q">?</div>
                    <div className="ill-cal-cell">×</div>
                    <div className="ill-cal-cell">×</div>
                  </div>
                </div>
                <h3>The scheduling nightmare</h3>
                <p>
                  6 messages to confirm one session.<br />
                  &quot;Does Tuesday work? Actually Thursday?&quot;
                </p>
              </div>

              <div className="card pain-card reveal-up delay-3">
                <div className="pain-ill">
                  <div className="meme-face face-3">
                    <div className="f3-acc"></div>
                    <div className="m-brow l"></div>
                    <div className="m-brow r"></div>
                    <div className="m-eye l"></div>
                    <div className="m-eye r"></div>
                    <div className="m-mouth"></div>
                  </div>
                  <div className="ill-stack-wrap">
                    <div className="ill-inv-card ill-inv-1"></div>
                    <div className="ill-inv-card ill-inv-2"></div>
                    <div className="ill-inv-card ill-inv-3">
                      <div className="ill-stamp">OVERDUE</div>
                    </div>
                  </div>
                </div>
                <h3>Unpaid invoices stacking up</h3>
                <p>
                  Chasing clients for money is the worst part<br />
                  of the job. Somehow it&apos;s also your job.
                </p>
              </div>

              <div className="card pain-card reveal-up delay-4">
                <div className="pain-ill">
                  <div className="meme-face face-4">
                    <div className="f4-acc">3</div>
                    <div className="m-brow l"></div>
                    <div className="m-brow r"></div>
                    <div className="m-eye l"></div>
                    <div className="m-eye r"></div>
                    <div className="m-mouth"></div>
                  </div>
                  <div className="ill-resend-wrap">
                    <div className="ill-resend-arrow"></div>
                    <div className="ill-file-icon"></div>
                    <div className="ill-resend-num">3</div>
                  </div>
                </div>
                <h3>&quot;Can you resend the files?&quot;</h3>
                <p>
                  For the third time.<br />
                  On WhatsApp. At midnight.
                </p>
              </div>

              <div className="card pain-card reveal-up delay-5">
                <div className="pain-ill">
                  <div className="meme-face face-5">
                    <div className="f5-acc">
                      <span className="f5-z1">z</span>
                      <span className="f5-z2">z</span>
                      <span className="f5-z3">z</span>
                    </div>
                    <div className="m-brow l"></div>
                    <div className="m-brow r"></div>
                    <div className="m-eye l"></div>
                    <div className="m-eye r"></div>
                    <div className="m-mouth"></div>
                  </div>
                  <div className="ill-loop-wrap">
                    <div className="ill-loop-border"></div>
                    <div className="ill-loop-content">
                      <span>DMs</span>{" "}
                      <span className="ill-loop-arrow-right">→</span>{" "}
                      <span>Session</span>{" "}
                      <span className="ill-loop-arrow-right">→</span>{" "}
                      <span>Invoice</span>{" "}
                      <span className="ill-loop-arrow-right">→</span>{" "}
                      <span>Chase</span>
                    </div>
                  </div>
                </div>
                <h3>Doing it all again tomorrow</h3>
                <p>
                  Wake up. Answer DMs. Make a beat.<br />
                  Chase payment. Repeat until you hate this.
                </p>
              </div>

              <div className="card pain-card reveal-up delay-6">
                <div className="pain-ill">
                  <div className="meme-face face-6">
                    <div className="f6-acc">
                      <div className="f6-arc f6-a1"></div>
                      <div className="f6-arc f6-a2"></div>
                      <div className="f6-arc f6-a3"></div>
                    </div>
                    <div className="m-brow l"></div>
                    <div className="m-brow r"></div>
                    <div className="m-eye l"></div>
                    <div className="m-eye r"></div>
                    <div className="m-mouth"></div>
                  </div>
                  <div className="ill-mental-wrap">
                    <div className="ill-batt">
                      <div className="ill-batt-level"></div>
                    </div>
                    <div className="ill-drain-bolt"></div>
                  </div>
                </div>
                <h3>Mental bandwidth, gone</h3>
                <p>
                  By the time you open your DAW,<br />
                  you&apos;re already running on empty.
                </p>
              </div>
            </div>

            <h3
              className="syne reveal-up"
              style={{
                textAlign: "center",
                color: "var(--amber)",
                marginTop: 56,
                fontSize: "clamp(20px, 3vw, 28px)",
                letterSpacing: "-0.01em",
              }}
            >
              Every one of these problems disappears with Skitza. ↓
            </h3>
          </div>
        </section>

        {/* SECTION 3: SOLUTION — source 1412-1441 */}
        <section className="section" id="solution">
          <div
            className="blob-amber ambient-blob"
            style={{ top: "50%", right: -200 }}
          ></div>
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">02</span>
              <span className="label">Enter Skitza</span>
              <h2 className="syne">
                One platform.<br />
                Everything automated.<br />
                Nothing missed.
              </h2>
              <p
                className="body-text"
                style={{ marginLeft: 0, marginBottom: 12 }}
              >
                Skitza connects to your calendar, payments, and messaging — and
                runs your entire client workflow automatically.
              </p>
              <p
                className="body-text"
                style={{
                  marginLeft: 0,
                  color: "var(--dark-body)",
                  lineHeight: 2.2,
                  fontSize: 15,
                }}
              >
                📅 Clients book themselves — you just show up<br />
                💸 Invoices sent and chased automatically<br />
                📁 Files delivered securely — no WhatsApp links<br />
                💬 Follow-ups and reminders — done for you
              </p>
            </div>

            <div className="solution-flow reveal-up delay-2" id="flow-diagram">
              <div className="flow-line"></div>
              <div className="flow-line-active" id="flow-line-active"></div>

              <div className="flow-node">
                Lead <span className="check">✓</span>
              </div>
              <div className="flow-node">
                Booking <span className="check">✓</span>
              </div>
              <div className="flow-node">
                Session <span className="check">✓</span>
              </div>
              <div className="flow-node">
                Invoice <span className="check">✓</span>
              </div>
              <div className="flow-node">
                Delivery <span className="check">✓</span>
              </div>
              <div className="flow-node">
                Follow-up <span className="check">✓</span>
              </div>
            </div>
          </div>
        </section>

        {/* INJECTED SECTION (S3): Compare — 2-column dark grid. Was a
            separate component pre-pivot. */}
        <section className="section" id="compare">
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">02</span>
              <span className="label">Why Skitza</span>
              <h2 className="syne">
                One tool replaces<br />the whole stack.
              </h2>
              <p className="body-text" style={{ marginLeft: 0 }}>
                The math on the unbundled producer setup: 6 logins, 6 monthly
                fees, 4 contexts to switch between, and a client who has to
                remember which app you sent the link in.
              </p>
            </div>

            <div className="compare-grid">
              <div className="compare-card reveal-up">
                <span className="compare-eyebrow">Without Skitza</span>
                <h3>The unbundled stack</h3>
                <ul className="compare-list">
                  {[
                    { tool: "Calendly", role: "Booking" },
                    { tool: "Samply", role: "File review" },
                    { tool: "Notion", role: "Project notes" },
                    { tool: "DocuSign", role: "Contracts" },
                    { tool: "Stripe (manual)", role: "Invoicing" },
                    { tool: "WhatsApp", role: "Everything else" },
                  ].map((item) => (
                    <li key={item.tool} className="compare-row">
                      <span className="compare-mark bad" aria-hidden>
                        ×
                      </span>
                      <span>
                        <strong style={{ color: "var(--dark-text)", fontWeight: 500 }}>
                          {item.tool}
                        </strong>
                        {" — "}
                        {item.role}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="compare-cost">
                  ≈ 6 tools · 6 monthly fees · 47 emails per session
                </div>
              </div>

              <div className="compare-card is-skitza reveal-up delay-1">
                <span className="compare-eyebrow">With Skitza</span>
                <h3>One unified studio</h3>
                <ul className="compare-list">
                  {[
                    "Booking, contracts, audio, payments, CRM",
                    "One URL per producer",
                    "Clients sign + pay + review without an account",
                    "Master files gated until the invoice clears",
                    "Desktop app + mobile companion",
                    "Single subscription. Single login.",
                  ].map((row) => (
                    <li key={row} className="compare-row">
                      <span className="compare-mark good" aria-hidden>
                        ✓
                      </span>
                      <span>{row}</span>
                    </li>
                  ))}
                </ul>
                <div className="compare-cost">
                  1 tool · 1 subscription · 1 link your clients remember
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: FEATURES — source 1443-1660 */}
        <section className="section" id="features">
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">03</span>
              <span className="label">What Skitza does</span>
              <h2 className="syne">
                Your studio.<br />
                On autopilot.
              </h2>
            </div>

            <div className="features-layout reveal-up delay-1">
              <div className="features-list">
                <div className="feature-indicator" id="feature-indicator"></div>
                <button className="feature-tab active" data-index="0" type="button">
                  Storefront &amp; Booking
                </button>
                <button className="feature-tab" data-index="1" type="button">
                  Payments on autopilot
                </button>
                <button className="feature-tab" data-index="2" type="button">
                  Files &amp; Feedback
                </button>
                <button className="feature-tab" data-index="3" type="button">
                  Client history
                </button>
                <button className="feature-tab" data-index="4" type="button">
                  Follow-up on autopilot
                </button>
                <button className="feature-tab" data-index="5" type="button">
                  Lead Management
                </button>
                <button className="feature-tab" data-index="6" type="button">
                  Contracts &amp; Protection
                </button>
              </div>

              <div className="features-views">
                {/* 0. Booking */}
                <div className="feature-content active" id="feat-0">
                  <h3>Sell packages, not just time.</h3>
                  <p>
                    Share your Skitza link as your personal storefront. Clients
                    select a service (e.g. &quot;Full Production&quot;), pick a
                    date, and pay the deposit — all in one flow.<br />
                    No more &quot;does Thursday at 4 work?&quot;
                  </p>
                  <div
                    className="feature-mockup"
                    style={{ justifyContent: "center" }}
                  >
                    <div
                      style={{
                        background: "var(--dark-surface)",
                        border: "1px solid rgba(212,150,10,0.5)",
                        borderRadius: 6,
                        padding: 12,
                        marginBottom: 16,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        textAlign: "left",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: "var(--amber)",
                          }}
                        >
                          Full Production Package
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--dark-body)",
                            marginTop: 2,
                          }}
                        >
                          Includes beat, tracking, and mix
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-head)",
                          fontWeight: 700,
                          color: "var(--dark-text)",
                        }}
                      >
                        $1,500
                      </div>
                    </div>
                    <div className="mu-booking-grid">
                      <div className="mu-day">Mon</div>
                      <div className="mu-day">Tue</div>
                      <div className="mu-day">Wed</div>
                      <div className="mu-day">Thu</div>
                      <div className="mu-day">Fri</div>
                      <div className="mu-slot">10am</div>
                      <div className="mu-slot">10am</div>
                      <div className="mu-slot">10am</div>
                      <div className="mu-slot">10am</div>
                      <div className="mu-slot">10am</div>
                      <div className="mu-slot">1pm</div>
                      <div className="mu-slot">1pm</div>
                      <div className="mu-slot">1pm</div>
                      <div className="mu-slot">1pm</div>
                      <div className="mu-slot">1pm</div>
                      <div className="mu-slot">4pm</div>
                      <div className="mu-slot active">3pm</div>
                      <div className="mu-slot">4pm</div>
                      <div className="mu-slot">4pm</div>
                      <div className="mu-slot">4pm</div>
                    </div>
                    <div className="mu-confirm-card">
                      <div>Marcus T. · 2hr session · $150 deposit paid</div>
                      <div style={{ color: "var(--amber)", fontWeight: "bold" }}>
                        ✓
                      </div>
                    </div>
                  </div>
                </div>

                {/* 1. Payments */}
                <div className="feature-content" id="feat-1">
                  <h3>Payments on autopilot</h3>
                  <p>
                    Clients pay the deposit when they book — no invoice needed.
                    <br />
                    A contract is sent automatically and signed before the
                    session.<br />
                    After the session, the balance is collected without you
                    asking.<br />
                    Money in. No chasing. No awkward follow-ups.
                  </p>
                  <div className="feature-mockup" style={{ padding: 16 }}>
                    <div className="mu-inv-main">
                      <div className="mu-inv-head">
                        <span>Invoice #0042 · Marcus T.</span>
                        <span className="mu-badge">Paid ✓</span>
                      </div>
                      <div className="mu-inv-row">
                        <span>Recording session 2hr</span>
                        <span>$300</span>
                      </div>
                      <div className="mu-inv-row">
                        <span>Mix revision</span>
                        <span>$150</span>
                      </div>
                      <div className="mu-inv-total">
                        <span>Total</span>
                        <span>$450</span>
                      </div>
                    </div>
                    <div>
                      <div className="mu-inv-mini">
                        <span>#0043 · Alex D.</span>
                        <span
                          className="mu-badge ghost"
                          style={{
                            color: "var(--amber)",
                            borderColor: "rgba(212,150,10,0.3)",
                          }}
                        >
                          Pending
                        </span>
                      </div>
                      <div className="mu-inv-mini">
                        <span>#0041 · Jordan S.</span>
                        <span className="mu-badge copper">Overdue</span>
                      </div>
                      <div className="mu-inv-mini">
                        <span>#0040 · Marcus T.</span>
                        <span className="mu-badge">Paid ✓</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Music (Merged Delivery/Studio) */}
                <div className="feature-content" id="feat-2">
                  <h3>
                    Stream freely.<br />
                    Download when paid.
                  </h3>
                  <p>
                    Clients can listen to the latest mix and leave timestamped
                    feedback. &quot;Fix the snare at 1:42&quot; stays at 1:42.
                  </p>
                  <p>
                    But the high-res download button?{" "}
                    <strong>
                      That stays securely locked until the final invoice is
                      paid.
                    </strong>
                    <br />
                    Deliver files via a clean, branded page. No more chasing
                    money after sending the final WAV.
                  </p>
                  <div className="feature-mockup waveform-mockup">
                    <div className="mu-panel">
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          marginBottom: 16,
                          overflowX: "auto",
                          paddingBottom: 4,
                        }}
                      >
                        <div
                          style={{
                            background: "rgba(212,150,10,0.15)",
                            color: "var(--amber)",
                            border: "1px solid var(--amber)",
                            borderRadius: 4,
                            padding: "4px 8px",
                            fontSize: 10,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Mix V3 (Current)
                        </div>
                        <div
                          style={{
                            background: "var(--dark-elevated)",
                            color: "var(--dark-body)",
                            border: "1px solid var(--dark-border)",
                            borderRadius: 4,
                            padding: "4px 8px",
                            fontSize: 10,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Mix V2 (Approved)
                        </div>
                        <div
                          style={{
                            background: "var(--dark-elevated)",
                            color: "var(--dark-body)",
                            border: "1px solid var(--dark-border)",
                            borderRadius: 4,
                            padding: "4px 8px",
                            fontSize: 10,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Mix V1
                        </div>
                      </div>
                      <div className="track-title">Draft_v3_unreleased.wav</div>
                      <div className="player-bar-container">
                        <div className="player-progress"></div>
                        <div className="player-pin pin-1"></div>
                        <div className="player-pin pin-2"></div>
                      </div>
                      <div className="comment-bubble">
                        <div className="comment-header">
                          <span className="comment-time">1:42</span>
                          <span
                            style={{
                              color: "var(--amber)",
                              fontSize: 10,
                              textTransform: "uppercase",
                              fontWeight: "bold",
                            }}
                          >
                            ✓ Resolved
                          </span>
                        </div>
                        &quot;Snare too loud here&quot;
                      </div>
                    </div>
                    <div className="mu-panel mu-delivery-flex">
                      <div>
                        <div className="track-title" style={{ marginBottom: 2 }}>
                          Final Mix + Stems.zip
                        </div>
                        <div
                          style={{ fontSize: 11, color: "var(--dark-body)" }}
                        >
                          Ready for download · 450MB
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          className="mu-dl-btn"
                          style={{
                            background: "rgba(212,150,10,0.1)",
                            color: "rgba(255,255,255,0.4)",
                            border: "1px solid rgba(212,150,10,0.3)",
                            cursor: "not-allowed",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          🔒 Download
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--copper)",
                            marginTop: 6,
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                          }}
                        >
                          Unlocks after $150 payment
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. CRM */}
                <div className="feature-content" id="feat-3">
                  <h3>Client Management</h3>
                  <p>
                    Every client&apos;s history, sessions, payments, notes,
                    <br />
                    and files in one place. Know who&apos;s coming back,<br />
                    who owes you, and who sent you three referrals.
                  </p>
                  <div className="feature-mockup" style={{ padding: 24 }}>
                    <div className="mu-crm-head">
                      <div className="mu-avatar">MT</div>
                      <div className="mu-crm-name">Marcus T.</div>
                    </div>
                    <div className="mu-crm-stats">
                      <div className="mu-stat-chip">8 sessions</div>
                      <div className="mu-stat-chip">$3,200 total</div>
                      <div className="mu-stat-chip">2 referrals</div>
                    </div>
                    <div>
                      <div className="mu-feed-item">
                        <div className="mu-dot"></div>
                        <div>Session booked · 2 days ago</div>
                      </div>
                      <div className="mu-feed-item">
                        <div className="mu-dot"></div>
                        <div>Invoice paid · 5 days ago</div>
                      </div>
                      <div className="mu-feed-item">
                        <div className="mu-dot"></div>
                        <div>Files delivered · 1 week ago</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Comms */}
                <div className="feature-content" id="feat-4">
                  <h3>Follow-up on autopilot</h3>
                  <p>
                    Booking confirmations, session reminders, post-session
                    thank-yous,<br />
                    payment nudges — sent via WhatsApp or email, in your voice.
                    <br />
                    Clients feel taken care of. You didn&apos;t lift a finger.
                  </p>
                  <div className="feature-mockup">
                    <div className="mu-chat">
                      <div className="mu-bubble left">
                        Hey Marcus, your session is confirmed for Tuesday at
                        3pm 🎛
                      </div>
                      <div className="mu-bubble left">
                        Your files are ready — click here to download
                      </div>
                      <div className="mu-bubble right">Perfect, thanks!</div>
                      <div className="mu-chat-note">
                        Sent automatically by Skitza
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Leads */}
                <div className="feature-content" id="feat-5">
                  <h3>Lead Management</h3>
                  <p>
                    Someone DMs and goes quiet?<br />
                    Skitza tracks the lead, sends automated follow-ups,<br />
                    and tells you exactly when to reach back out.<br />
                    Your pipeline, managed.
                  </p>
                  <div className="feature-mockup" style={{ padding: 16 }}>
                    <div className="mu-board">
                      <div className="mu-col">
                        <div className="mu-col-title">New</div>
                        <div className="mu-l-card">
                          <div className="mu-l-name">Sarah J.</div>
                          <div className="mu-l-sub">DM inquiry · Today</div>
                        </div>
                        <div className="mu-l-card" style={{ opacity: 0.5 }}>
                          <div className="mu-l-name">Jay K.</div>
                          <div className="mu-l-sub">Instagram DM</div>
                        </div>
                      </div>
                      <div
                        className="mu-col"
                        style={{
                          border: "1px dashed rgba(255,255,255,0.05)",
                        }}
                      >
                        <div className="mu-col-title">Following Up</div>
                        <div className="mu-l-card active">
                          <div className="mu-l-name">Marcus T.</div>
                          <div className="mu-l-sub">Rates sent</div>
                          <div className="mu-l-action">
                            <div className="mu-pulse-dot"></div> Auto-follow-up
                            sent
                          </div>
                        </div>
                        <div className="mu-l-card" style={{ opacity: 0.5 }}>
                          <div className="mu-l-name">Dana R.</div>
                          <div className="mu-l-sub">No reply · 3 days</div>
                        </div>
                      </div>
                      <div className="mu-col">
                        <div className="mu-col-title">Booked</div>
                        <div className="mu-l-card" style={{ opacity: 0.6 }}>
                          <div className="mu-l-name">Alex D.</div>
                          <div className="mu-l-sub">Deposit paid</div>
                        </div>
                        <div className="mu-l-card" style={{ opacity: 0.4 }}>
                          <div className="mu-l-name">Mia L.</div>
                          <div className="mu-l-sub">Session confirmed</div>
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: "1px solid var(--dark-border)",
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "var(--dark-body)",
                      }}
                    >
                      <span>6 active leads</span>
                      <span style={{ color: "var(--amber)" }}>
                        2 need follow-up
                      </span>
                    </div>
                  </div>
                </div>

                {/* 6. Contracts (NEW) */}
                <div className="feature-content" id="feat-6">
                  <h3>Zero disputes. Guaranteed.</h3>
                  <p>
                    Don&apos;t start a session without a signature. Skitza
                    generates custom copyright agreements and split sheets that
                    clients digitally sign right from their phone. Your final
                    files remain securely locked until the balance is completely
                    cleared.
                  </p>
                  <div
                    className="feature-mockup mu-contract-split"
                    style={{
                      padding: 24,
                      background:
                        "repeating-linear-gradient(45deg, var(--dark-elevated), var(--dark-elevated) 10px, var(--dark-surface) 10px, var(--dark-surface) 20px)",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        background: "var(--light-bg)",
                        color: "var(--light-text)",
                        padding: 16,
                        borderRadius: 6,
                        boxShadow: "0 15px 40px rgba(0,0,0,0.4)",
                        transform: "rotate(-2deg)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontFamily: "'Times New Roman', serif",
                            fontSize: 14,
                            fontWeight: "bold",
                            borderBottom: "2px solid #000",
                            paddingBottom: 4,
                            marginBottom: 8,
                            textAlign: "center",
                          }}
                        >
                          Master Agreement
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "#444",
                            lineHeight: 1.5,
                          }}
                        >
                          Artist agrees to the 50% publishing split and
                          acknowledges files remain securely locked until the
                          balance is cleared.
                        </div>
                      </div>
                      <div
                        style={{
                          borderTop: "1px dashed #ccc",
                          paddingTop: 8,
                          marginTop: 12,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-end",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: 8,
                              color: "#666",
                              textTransform: "uppercase",
                              letterSpacing: "0.1em",
                              marginBottom: 2,
                            }}
                          >
                            Artist Signature
                          </div>
                          <div
                            style={{
                              fontFamily: "cursive",
                              fontSize: 20,
                              color: "#0015ff",
                              transform: "rotate(-5deg)",
                              display: "inline-block",
                            }}
                          >
                            Marcus T.
                          </div>
                        </div>
                        <div
                          style={{
                            background: "#27ae60",
                            color: "white",
                            fontSize: 8,
                            padding: "3px 6px",
                            borderRadius: 4,
                            fontWeight: "bold",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          Verified
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        flex: 1,
                        background: "var(--dark-surface)",
                        border: "1px solid var(--dark-border)",
                        borderRadius: 6,
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        textAlign: "center",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                        transform: "rotate(1deg)",
                      }}
                    >
                      <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: 13,
                          marginBottom: 4,
                        }}
                      >
                        Final_Master.wav
                      </div>
                      <div
                        style={{
                          background: "rgba(212,150,10,0.05)",
                          border: "1px solid rgba(212,150,10,0.3)",
                          color: "rgba(255,255,255,0.4)",
                          padding: "8px 16px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 500,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          marginTop: 12,
                          cursor: "not-allowed",
                        }}
                      >
                        🔒 Download
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          color: "var(--amber)",
                          marginTop: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        Unlocks after $150 final payment
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4.5: Consolidation Section — source 1662-1704 */}
        <section className="section" id="consolidation">
          <div className="container">
            <div
              className="section-header reveal-up"
              style={{ maxWidth: 700, margin: "0 auto 32px", textAlign: "center" }}
            >
              <span
                className="watermark"
                style={{
                  left: "50%",
                  transform: "translateX(-50%)",
                  opacity: 0.3,
                }}
              >
                —
              </span>
              <span className="label">One tool. Full stop.</span>
              <h2 className="syne" style={{ color: "var(--light-bg)" }}>
                Cancel the rest.<br />
                Skitza is the only<br />
                tab you need open.
              </h2>
              <p className="body-text">
                Most producers juggle multiple tools that barely talk to each
                other. Skitza replaces all of them — one subscription, one
                login, one place where everything just works.
              </p>
            </div>

            <div className="stats-grid reveal-up delay-1">
              <div className="stat-card">
                <div className="stat-num">9+</div>
                <div className="stat-label">tools replaced</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">1</div>
                <div className="stat-label">subscription</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">0</div>
                <div className="stat-label">new apps to learn</div>
              </div>
            </div>

            <div className="consolidation-footer reveal-up delay-2">
              <div className="tools-replaced">
                <div className="tool-chip replaced">
                  <span className="tool-icon">💬</span> WhatsApp
                </div>
                <div className="tool-chip replaced">
                  <span className="tool-icon">🔗</span> Linktree
                </div>
                <div className="tool-chip replaced">
                  <span className="tool-icon">✍️</span> DocuSign
                </div>
                <div className="tool-chip replaced">
                  <span className="tool-icon">📤</span> WeTransfer
                </div>
                <div className="tool-chip replaced">
                  <span className="tool-icon">📊</span> Google Sheets
                </div>
                <div className="tool-chip replaced">
                  <span className="tool-icon">💸</span> PayPal / Wave
                </div>
                <div className="tool-chip replaced">
                  <span className="tool-icon">📁</span> Google Drive
                </div>
                <div className="tool-chip replaced">
                  <span className="tool-icon">📧</span> Gmail drafts
                </div>
                <div className="tool-chip replaced">
                  <span className="tool-icon">📅</span> Calendly
                </div>
                <div className="tool-chip skitza">
                  <span className="tool-icon">⚡</span> Skitza
                </div>
              </div>
              <p
                style={{
                  color: "var(--dark-body)",
                  fontSize: 13,
                  marginBottom: 24,
                }}
              >
                One subscription. One login. Zero context-switching.
              </p>
              <a className="btn-ghost dark-ghost" href="#features">
                See Everything Skitza Does →
              </a>
            </div>
          </div>
        </section>

        {/* SECTION 5: HOW IT WORKS — source 1706-1734 */}
        <section className="section" id="how-it-works">
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">04</span>
              <span className="label">Setup</span>
              <h2 className="syne">
                Set it up once.<br />
                Let it run forever.
              </h2>
            </div>

            <div className="steps-layout">
              <div className="steps-line"></div>
              <div className="step-card reveal-up delay-1">
                <div className="step-num">01</div>
                <h3>Connect your studio</h3>
                <p>
                  Link your calendar, WhatsApp, payment method,<br />
                  and file storage in under 10 minutes.
                </p>
              </div>
              <div className="step-card reveal-up delay-2">
                <div className="step-num">02</div>
                <h3>Set your rules</h3>
                <p>
                  Your rates, your availability, your workflow.<br />
                  Skitza learns how you work and automates it exactly.
                </p>
              </div>
              <div className="step-card reveal-up delay-3">
                <div className="step-num">03</div>
                <h3>Focus on music</h3>
                <p>
                  New session? Handled.<br />
                  Payment due? Handled.<br />
                  File delivered? Handled.<br />
                  You just open your DAW.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* INJECTED SECTION (S3): Security — 3-card pillar grid. Was a
            separate component pre-pivot. */}
        <section className="section" id="security">
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">08</span>
              <span className="label">Enterprise-grade by default</span>
              <h2 className="syne">
                Your masters never<br />leave the building.
              </h2>
              <p className="body-text" style={{ marginLeft: 0 }}>
                Audio and contracts move across the internet every day.
                Here&apos;s what happens to yours when they pass through Skitza.
              </p>
            </div>

            <div className="security-grid">
              {[
                {
                  icon: "🔒",
                  title: "Privacy",
                  body:
                    "GDPR-ready architecture. Single-tenant audit log per producer. Row-level isolation enforced at the query layer — no silent cross-tenant leaks, ever.",
                },
                {
                  icon: "☁️",
                  title: "Storage",
                  body:
                    "Cloudflare R2 with AES-256 at rest. Every audio playback uses a short-lived signed URL scoped to the client. 90-day rolling backup of all metadata.",
                },
                {
                  icon: "🛡️",
                  title: "Auth",
                  body:
                    "Clerk-backed sessions with MFA-ready accounts. Client access rides on single-use magic links — no standing credentials. SOC 2 Type II in progress.",
                },
              ].map((pillar, i) => (
                <article
                  key={pillar.title}
                  className={`security-card reveal-up delay-${String(i + 1)}`}
                >
                  <span className="security-icon" aria-hidden>
                    {pillar.icon}
                  </span>
                  <h3 className="syne">{pillar.title}</h3>
                  <p>{pillar.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 6: TESTIMONIALS — source 1736-1760 */}
        <section className="section" id="testimonials">
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">05</span>
              <span className="label">
                Producers who got their time back
              </span>
              <h2 className="syne">
                Real results.<br />
                No fluff.
              </h2>
            </div>

            <div className="test-grid">
              <div className="test-card reveal-up delay-1">
                <p className="test-quote">
                  &quot;I used to spend 2 hours a day just managing bookings
                  and chasing invoices. Now I check Skitza once a week.&quot;
                </p>
                <p className="test-author">— Jordan M., Mixing Engineer</p>
              </div>
              <div className="test-card reveal-up delay-2">
                <p className="test-quote">
                  &quot;My clients think I have a whole team behind me.
                  It&apos;s just me and Skitza.&quot;
                </p>
                <p className="test-author">— Davi R., Music Producer</p>
              </div>
              <div className="test-card reveal-up delay-3">
                <p className="test-quote">
                  &quot;First month in, I recovered 3 unpaid invoices I&apos;d
                  completely forgotten about.&quot;
                </p>
                <p className="test-author">— Kai T., Beatmaker</p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 7: PRICING — source 1762-1795 */}
        <section className="section" id="pricing">
          <div
            className="blob-copper ambient-blob"
            style={{ top: 0, left: -200 }}
          ></div>
          <div className="container">
            <div
              className="section-header reveal-up"
              style={{ margin: "0 auto 40px", textAlign: "center" }}
            >
              <span
                className="watermark"
                style={{ left: "50%", transform: "translateX(-50%)" }}
              >
                06
              </span>
              <span className="label">Pricing</span>
              <h2 className="syne">
                One plan.<br />
                No surprises.
              </h2>
            </div>

            <div className="pricing-wrap reveal-up delay-1">
              <div className="pricing-card" id="pricing-card-3d">
                <span className="price-plan">Early Access</span>
                <div className="price-amount">$29</div>
                <span className="price-period">/month</span>
                <span className="price-strike">$79 after launch</span>
                <span className="price-sub">Lock in this price forever</span>

                <ul className="pricing-features">
                  <li>Unlimited sessions &amp; bookings</li>
                  <li>Automated invoicing &amp; payments</li>
                  <li>Branded file delivery</li>
                  <li>Full client CRM</li>
                  <li>WhatsApp &amp; email automation</li>
                  <li>Lead management &amp; follow-ups</li>
                  <li>Priority support</li>
                </ul>

                <Link
                  href="/sign-up?redirect_url=%2Fonboarding"
                  className="btn-primary full"
                >
                  Sign up now →
                </Link>
                <span className="price-footer">
                  14-day free trial · Cancel anytime · No credit card required
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* INJECTED SECTION (S3): FAQ — accordion. Was a separate
            component pre-pivot. Inlined here so the verbatim port keeps
            its single-component shape. */}
        <section className="section" id="faq">
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">07</span>
              <span className="label">FAQ</span>
              <h2 className="syne">
                Things people<br />ask before they sign up.
              </h2>
            </div>

            <div className="faq-list reveal-up delay-1">
              {[
                {
                  q: "Do you store my master files?",
                  a: "All files stay in your Cloudflare R2 bucket — Skitza never reads them. We hold metadata and signed URLs only, so the moment you cancel, your audio is still 100% yours and accessible.",
                },
                {
                  q: "What if my client doesn't pay?",
                  a: "Stripe handles the payment plans and late-fee logic automatically. The high-resolution download stays locked behind a paid status — your client can preview the watermarked mix, but the deliverable is gated until the invoice clears.",
                },
                {
                  q: "Can I use my own domain?",
                  a: "Not at launch. You get skitza.app/<your-name> — clean, instantly memorable, zero DNS configuration. Custom domains are on the Studio-tier roadmap once we know what 80% of producers actually need.",
                },
                {
                  q: "Does it work offline?",
                  a: "The Tauri desktop app caches your last 7 days of projects, so you can open sessions, view contracts, and queue file deliveries without a connection. Everything syncs the next time you're online.",
                },
                {
                  q: "Is there a free tier?",
                  a: "14-day free trial, no credit card required. Cancel anytime — your client links keep working for 30 days post-cancel, so an in-flight session never breaks because you decided Skitza wasn't for you.",
                },
                {
                  q: "Can I import from Calendly, Samply, or Notion?",
                  a: "CSV imports for clients and invoices ship at launch. Sample uploads via drag-and-drop. Notion import is on the roadmap — most producers find the migration painless because the new home for everything is one URL anyway.",
                },
              ].map((item, i) => {
                const open = activeFaq === i;
                const panelId = `faq-panel-${String(i)}`;
                const buttonId = `faq-button-${String(i)}`;
                return (
                  <div
                    key={item.q}
                    className={open ? "faq-item is-open" : "faq-item"}
                  >
                    <button
                      type="button"
                      id={buttonId}
                      className="faq-question"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => {
                        setActiveFaq(open ? null : i);
                      }}
                    >
                      <span>{item.q}</span>
                      <span className="faq-icon" aria-hidden>
                        ⌄
                      </span>
                    </button>
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      className="faq-answer"
                    >
                      <p>{item.a}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* INJECTED SECTION (S3): Founder — single-column editorial.
            Was a separate component pre-pivot. */}
        <section className="section" id="founder">
          <div className="container">
            <div className="founder-wrap">
              <span className="label reveal-up">From the founder</span>

              <div className="founder-portrait reveal-up delay-1" aria-hidden>
                GA
              </div>

              <div className="founder-body">
                <p className="reveal-up delay-2">
                  I built Skitza after losing a $4k mix. No signed contract, no
                  proof of delivery — the artist ghosted, and I had nothing to
                  point at. The tools to prevent it existed; they were just
                  scattered across six different apps.
                </p>
                <p className="reveal-up delay-3">
                  Calendly for booking. Samply for files. Notion for project
                  notes. DocuSign for the contract. Stripe for the deposit.
                  WhatsApp for everything else. The friction <em>was</em> the
                  product, and every solo producer I knew lived inside it.
                </p>
                <p className="reveal-up delay-4">
                  Skitza is the tool I wish I&apos;d had that night. One link.
                  Every client. Every session. Every dollar tracked. Built so
                  you can spend Friday night mixing instead of resending a WAV
                  for the third time.
                </p>
              </div>

              <div className="founder-signoff reveal-up delay-5">
                — Gili Asraf, founder
              </div>
            </div>
          </div>
        </section>

        {/* INJECTED SECTION (S3): Download — 2-card platform grid. Was
            a separate component pre-pivot. */}
        <section className="section" id="download">
          <div className="container">
            <div className="section-header no-cta reveal-up">
              <span className="watermark">09</span>
              <span className="label">Anywhere you work</span>
              <h2 className="syne">
                Studio. Sofa.<br />Subway.
              </h2>
              <p className="body-text" style={{ marginLeft: 0 }}>
                The web app is live today. Native desktop and mobile builds
                land the moment the signed-binary pipeline is in place — same
                account, same data, same one URL.
              </p>
            </div>

            <div className="download-grid">
              {[
                {
                  icon: "💻",
                  title: "Desktop",
                  sub:
                    "Native app for macOS, Windows, and Linux. Drag-and-drop files straight from Finder, get global keyboard shortcuts, and keep working offline.",
                },
                {
                  icon: "📱",
                  title: "Mobile",
                  sub:
                    "Add to Home Screen on iOS or Android — works offline, ships push notifications, and keeps your client booking link one tap away.",
                },
              ].map((p, i) => (
                <article
                  key={p.title}
                  className={`download-card reveal-up delay-${String(i + 1)}`}
                >
                  <span className="download-icon" aria-hidden>
                    {p.icon}
                  </span>
                  <h3 className="syne">{p.title}</h3>
                  <p className="download-sub">{p.sub}</p>
                  <button
                    type="button"
                    className="download-disabled"
                    disabled
                    aria-disabled="true"
                  >
                    <span aria-hidden>🔒</span> Coming soon
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 8: FINAL CTA — source 1797-1809 */}
        <section className="final-cta">
          <div className="final-glow"></div>
          <div className="container">
            <span
              className="label"
              style={{ position: "relative", zIndex: 1 }}
            >
              Ready?
            </span>
            <h2 className="syne">
              The studio that<br />
              runs itself is here.
            </h2>
            <p
              className="body-text"
              style={{ position: "relative", zIndex: 1 }}
            >
              Stop spending hours on admin.<br />
              Make the music you actually want to make.
            </p>
            <div className="final-ctas">
              <Link
                href="/sign-up?redirect_url=%2Fonboarding"
                className="btn-primary"
              >
                Sign up now
              </Link>
            </div>
          </div>
        </section>

        {/* FOOTER — source 1811-1848 */}
        <footer>
          <div className="container">
            <div className="footer-grid">
              <div>
                <a href="#" className="footer-logo">
                  Skitza
                </a>
                <p className="footer-tag">Your studio runs itself.</p>
              </div>
              <div className="footer-col">
                <h4>Product</h4>
                <ul>
                  <li>
                    <a href="#features">Features</a>
                  </li>
                  <li>
                    <a href="#pricing">Pricing</a>
                  </li>
                  <li>
                    <a href="#">Blog</a>
                  </li>
                  <li>
                    <a href="#">Contact</a>
                  </li>
                </ul>
              </div>
              <div className="footer-col">
                <h4>Socials</h4>
                <ul>
                  <li>
                    <a href="#">Instagram</a>
                  </li>
                  <li>
                    <a href="#">Twitter/X</a>
                  </li>
                  <li>
                    <a href="#">YouTube</a>
                  </li>
                </ul>
              </div>
              <div className="footer-col">
                <h4>Legal</h4>
                <ul>
                  <li>
                    <a href="#">Privacy Policy</a>
                  </li>
                  <li>
                    <a href="#">Terms of Service</a>
                  </li>
                </ul>
              </div>
            </div>
            <div className="footer-bottom">
              © 2026 Skitza. Built for producers, by producers.
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
