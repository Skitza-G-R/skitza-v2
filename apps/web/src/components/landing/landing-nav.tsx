"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Landing top nav — verbatim port of source HTML lines 1148-1187.
// Two surgical changes from the original:
//   1. The amber CTA button becomes a <Link> to /sign-up with the
//      onboarding redirect (Clerk honours the query param after sign-up).
//   2. A "Sign in" text link slots in just before the CTA — added per
//      PRD §3.5 so existing producers always have a frictionless
//      one-click way back into the dashboard from the marketing page.
//
// "use client" is required for two reasons:
//   - useEffect adds the .scrolled class on the <nav> when scrollY > 50,
//     mirroring the source script (lines 1913-1918).
//   - useState backs the mobile menu open/close toggle (replaces the
//     inline-CSS-driven mobile sheet from the source). The button uses
//     aria-expanded so screen readers can read the state.
//
// All decorative SVG-style markup (sk-rings, sk-papers, sk-char...)
// is rendered as a tree of nested divs; the styles + animations live
// in landing.css under .landing-root .sk-* selectors.
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <nav id="navbar" className={scrolled ? "scrolled" : undefined}>
      <div className="container nav-inner">
        <a href="#" className="sk-brand-link">
          <div className="sk-icon-wrap nav-scale">
            <SkLogoIcon />
          </div>
          <div className="sk-wordmark-wrap">
            <span className="sk-wordmark">Skitza</span>
            <div className="sk-underline" />
          </div>
        </a>

        <ul className="nav-links">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="nav-link">
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <Link
          href="/sign-in"
          className="nav-link nav-signin"
          style={{ marginRight: 16 }}
        >
          Sign in
        </Link>

        <Link
          href="/sign-up?redirect_url=%2Fonboarding"
          className="btn-primary small nav-btn"
        >
          Sign up now
        </Link>

        <button
          type="button"
          className="mobile-menu-btn"
          aria-expanded={menuOpen}
          aria-label="Toggle menu"
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile menu sheet — only renders when toggled open. The CSS in
          landing.css hides the desktop nav-links + nav-btn at <=768px;
          this sheet steps in to replicate them in a vertical stack so
          the user still has access to the full navigation. */}
      {menuOpen ? (
        <div className="mobile-menu" role="menu">
          <ul className="mobile-menu-list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="nav-link"
                  onClick={() => {
                  setMenuOpen(false);
                }}
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link
                href="/sign-in"
                className="nav-link"
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                Sign in
              </Link>
            </li>
            <li>
              <Link
                href="/sign-up?redirect_url=%2Fonboarding"
                className="btn-primary small"
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                Sign up now
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

// SkLogoIcon — the animated emoji-character mark from the source. Same
// nested-div tree used by both the nav and the hero (the hero scales
// it up via the .hero-scale wrapper). Extracted into a tiny private
// component so we don't duplicate ~25 lines of decorative markup.
function SkLogoIcon() {
  return (
    <div className="sk-logo-icon">
      <div className="sk-rings" />
      <div className="sk-papers">
        <div className="sk-paper p1" />
        <div className="sk-paper p2" />
        <div className="sk-paper p3">
          <div className="sk-stamp">OVERDUE</div>
        </div>
      </div>
      <div className="sk-char">
        <div className="sk-headphone-band" />
        <div className="sk-head">
          <div className="sk-steam st1" />
          <div className="sk-steam st2" />
          <div className="sk-sweat" />
          <div className="sk-brow l" />
          <div className="sk-brow r" />
          <div className="sk-eye l" />
          <div className="sk-eye r" />
          <div className="sk-mouth" />
        </div>
        <div className="sk-earcup l" />
        <div className="sk-earcup r" />
      </div>
      <div className="sk-badge">9</div>
    </div>
  );
}

// NAV_LINKS — the 3 in-page anchors from source line 1180-1182. Pinned
// as a constant so the test can assert their order without spinning up
// a renderer. If a section is renamed/reordered, both the markup AND
// the test fail in the same commit.
type NavLink = { label: string; href: `#${string}` };

export const NAV_LINKS: readonly NavLink[] = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
];

// Re-exported so the hero (which lives in the same module) can pull the
// shared logo icon if needed without circular imports.
export { SkLogoIcon };
