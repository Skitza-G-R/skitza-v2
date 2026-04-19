"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

// ScrollReveal — wraps a block and fades + lifts it into view as the
// user scrolls past the threshold. Pure IntersectionObserver, no
// animation library. Fires once per element, then the observer
// disconnects so we're not watching dozens of elements forever.
//
// Why this alongside `.reveal-up` already in globals.css: `.reveal-up`
// fires on first paint (hero, first-fold pain cards). This one fires
// on scroll for below-the-fold blocks — testimonials, compare rows,
// pricing tiers — so arriving at a section feels like each tile is
// dealt in rather than already on the table.
//
// prefers-reduced-motion: skip the animation entirely (render visible
// immediately). The IO callback still fires but the class transitions
// are neutralised in CSS (see the @media block in globals.css for
// `.sk-trans-slow` / `.reveal-up`).

type AsElement = "div" | "section" | "article" | "ul" | "ol" | "li" | "figure";

interface ScrollRevealProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Stagger delay bucket: 0, 1, 2, 3, 4. Maps to 0–0.32s lead. */
  delay?: 0 | 1 | 2 | 3 | 4;
  /** Element type; keeps semantic HTML intact. */
  as?: AsElement;
  /** IntersectionObserver rootMargin — lets you fire earlier/later. */
  rootMargin?: string;
}

const DELAY_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "",
  1: "[transition-delay:80ms]",
  2: "[transition-delay:160ms]",
  3: "[transition-delay:240ms]",
  4: "[transition-delay:320ms]",
};

export function ScrollReveal({
  children,
  delay = 0,
  as = "div",
  rootMargin = "0px 0px -10% 0px",
  className,
  ...rest
}: ScrollRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Older Safari lacks IntersectionObserver in some configurations,
    // and tests (jsdom) don't stub it. Fallback: assume visible.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin, threshold: 0.12 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [rootMargin]);

  const Element = as;
  // Combined class: start hidden (translateY + opacity 0), transition
  // to visible over 600ms ease-out. Use Tailwind's arbitrary-transition
  // utilities so this stays styleable from className overrides.
  const base = [
    "motion-safe:transition-[opacity,transform] motion-safe:duration-[600ms]",
    "motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)]",
    visible
      ? "motion-safe:translate-y-0 motion-safe:opacity-100"
      : "motion-safe:translate-y-3 motion-safe:opacity-0",
    DELAY_CLASS[delay],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // Casting the ref — TS can't narrow the union element-type ref
    // without a more elaborate generic (overkill here; the eight
    // AsElement branches all share HTMLElement as their intrinsic ref).
    <Element ref={ref as never} className={base} {...rest}>
      {children}
    </Element>
  );
}
