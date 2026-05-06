"use client";

import { useState, type ReactNode } from "react";

import { BookingFlowModal } from "./booking-flow-modal";

// Client-side wrapper that owns "is the booking modal open?" and
// renders a `<button>` that toggles it on click.
//
// API is `children` + `className`, NOT a render-prop callback.
// Why: this file is `"use client"`, but it's invoked from server
// components (JoinHero, JoinNav, SignupCta). RSC payloads are
// serialized when the server hands work over to the client, and
// functions are not serializable — Next throws
//
//   Error: Functions cannot be passed directly to Client Components
//   unless you explicitly expose it by marking it with "use server"
//
// at runtime when an RSC parent passes a callback prop.
//
// An earlier iteration used `trigger={({ onClick }) => <button .../>}`.
// It typechecked, passed `renderToStaticMarkup` unit tests (which run
// in one process, no RSC boundary), and built clean. But every
// `/join/<slug>` request died on Vercel with that exact error. See
// the runtime logs around 2026-05-06T16:44Z and CLAUDE.md mistake log.
//
// The fix: let the parent describe the button declaratively. `children`
// carries the icons/text (server-rendered JSX, serializable). `className`
// carries the visual variant (string, serializable). The trigger renders
// its own `<button>` so the click handler stays inside the client island.
//
// Two visual variants live today — a small pill in JoinNav (`min-h-9`)
// and a fuller CTA in JoinHero / SignupCta (`min-h-12`). Both share
// this trigger by varying `className` only.
//
// Public route — ENGLISH ONLY, LTR ONLY per CLAUDE.md i18n scope.

interface BookingFlowTriggerProps {
  slug: string;
  producerName: string;
  /**
   * Tailwind / CSS classes applied to the wrapping `<button>`. The
   * visual variants live at the callsites; the trigger does not
   * impose its own styling.
   */
  className?: string;
  /**
   * Button contents (text, icons, etc.). Server-rendered JSX is fine —
   * ReactNode serializes across the RSC boundary; functions do not.
   */
  children: ReactNode;
}

export function BookingFlowTrigger({
  slug,
  producerName,
  className,
  children,
}: BookingFlowTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className={className}
      >
        {children}
      </button>
      <BookingFlowModal
        open={open}
        onOpenChange={setOpen}
        slug={slug}
        producerName={producerName}
      />
    </>
  );
}
