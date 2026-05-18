// tax-mode-segmented.tsx
//
// 3-segment toggle for the producer's tax disclosure mode. Used in
// both Settings → Currency & region and the Storefront header chip
// so the two surfaces feel like the same control.
//
// Design (Emil + impeccable synthesis):
//   • Outer bordered pill (rounded-full, --border-subtle).
//   • A single floating "indicator" pill in --brand-primary slides
//     between the three segments via translate + width, animated
//     with the Skitza ease-drawer curve (the same iOS-feel curve
//     Vaul uses for sheet snaps). transform-only — GPU-cheap.
//   • Active button text flips to --bg-sidebar (the dark warm
//     near-black) so it reads on the brand amber.
//   • Inactive buttons fade their text from muted → default on hover,
//     200ms ease-out-strong.
//   • Buttons individually scale down on :active (Emil's "interface
//     heard you" press feedback).
//   • Each segment is a real <button>, keyboard-navigable, focus-ring
//     wraps the segment itself (not the indicator).
//
// Sizes:
//   • "lg" — Settings full-width row (44px tall, 13.5px text)
//   • "sm" — Storefront chip inline (32px tall, 11.5px text)

"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

import {
  TAX_MODES,
  type TaxMode,
  taxModeOptionLabel,
} from "~/lib/tax-mode";

interface Props {
  value: TaxMode;
  onChange: (next: TaxMode) => void;
  size?: "sm" | "lg";
  disabled?: boolean;
  // Drives the optional "first-paint glow" — when true, the outer
  // pill pulses a soft brand-color halo once on mount so a producer
  // landing on the page can't miss the new control. Settings passes
  // true; the Storefront chip passes false (the surface is already
  // attention-grabbing).
  highlight?: boolean;
  ariaLabel?: string;
}

export function TaxModeSegmented({
  value,
  onChange,
  size = "lg",
  disabled = false,
  highlight = false,
  ariaLabel = "Tax disclosure mode",
}: Props) {
  const groupId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Indicator geometry as inline px so the animation is hardware-
  // accelerated on transform/width — no Tailwind class-swap rerender.
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  // Measure the active segment after layout so the indicator lines up
  // exactly with whichever segment is selected. Re-measures on value
  // change (drives the slide animation) and on container resize (font
  // load, layout shifts).
  useLayoutEffect(() => {
    function measure() {
      const i = TAX_MODES.indexOf(value);
      const btn = buttonRefs.current[i];
      const container = containerRef.current;
      if (!btn || !container) return;
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
    };
  }, [value]);

  // Keyboard nav: left/right arrows cycle through segments. Wraps at
  // the ends so the toggle feels like a single control, not three
  // disconnected buttons.
  function handleKeyDown(e: React.KeyboardEvent, currentIndex: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + delta + TAX_MODES.length) % TAX_MODES.length;
    const next = TAX_MODES[nextIndex];
    if (next) {
      onChange(next);
      buttonRefs.current[nextIndex]?.focus();
    }
  }

  const dims =
    size === "sm"
      ? {
          height: "h-8",
          padding: "p-[3px]",
          buttonPad: "px-3",
          text: "text-[11.5px]",
          indicatorOffset: 3,
        }
      : {
          height: "h-11",
          padding: "p-1",
          buttonPad: "px-4",
          text: "text-[13.5px]",
          indicatorOffset: 4,
        };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={[
        "relative inline-flex w-full items-stretch rounded-full border bg-[rgb(var(--bg-elevated))]",
        dims.height,
        dims.padding,
        "border-[rgb(var(--border-subtle))]",
        // First-paint highlight pulse — runs once on mount when
        // `highlight` is true. Brand-amber halo expanding outward,
        // 1.4s, same keyframe used by Stripe-success states elsewhere.
        highlight ? "tax-segment-highlight" : "",
        disabled ? "pointer-events-none opacity-60" : "",
      ].join(" ")}
    >
      {/* Sliding indicator — single pill that moves between segments.
          Width + left are inline px (measured), transition the visible
          properties (transform doesn't help here since width and left
          both change with the segment). 300ms is right at the edge of
          Emil's "under 300ms" — the slide reads as a single committed
          motion, not a drag. */}
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full bg-[rgb(var(--brand-primary))] shadow-[0_1px_2px_rgba(17,16,9,0.12)] transition-[transform,width] duration-300"
        style={{
          top: dims.indicatorOffset,
          bottom: dims.indicatorOffset,
          width: `${String(indicator.width)}px`,
          transform: `translateX(${String(indicator.left)}px)`,
          transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      />
      {TAX_MODES.map((mode, i) => {
        const picked = mode === value;
        return (
          <button
            key={mode}
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={picked}
            tabIndex={picked ? 0 : -1}
            onClick={() => {
              if (!picked) onChange(mode);
            }}
            onKeyDown={(e) => {
              handleKeyDown(e, i);
            }}
            data-testid={`tax-segment-${mode}`}
            id={`${groupId}-${mode}`}
            className={[
              // Each segment fills 1/3. relative + z-10 so the text
              // sits ON the sliding indicator, not under it.
              "relative z-10 flex-1 rounded-full font-semibold leading-none",
              "transition-[color,transform] duration-200",
              "active:scale-[0.97] disabled:active:scale-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.45)] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
              dims.buttonPad,
              dims.text,
              picked
                ? "text-[rgb(var(--bg-sidebar))]"
                : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
            ].join(" ")}
            style={{ transitionTimingFunction: "var(--ease-press)" }}
          >
            {taxModeOptionLabel(mode)}
          </button>
        );
      })}
    </div>
  );
}
