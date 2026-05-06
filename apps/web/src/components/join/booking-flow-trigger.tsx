"use client";

import { useState, type ReactNode } from "react";

import { BookingFlowModal } from "./booking-flow-modal";

// Tiny client-side wrapper that owns a single piece of state — the
// "is the booking modal open?" boolean — and exposes a render-prop
// trigger so its parent (typically a server component) can shape
// the button however it wants.
//
// Two invocations live on `/join/<slug>`: one in JoinNav (a small
// pill-shaped CTA) and one in JoinHero (a fuller "Book a session"
// button). Both want the same modal open behaviour but completely
// different button styling, so a render-prop fits better than a
// pre-styled button + classname prop.
//
// Public route — ENGLISH ONLY, LTR ONLY per CLAUDE.md i18n scope.

interface BookingFlowTriggerProps {
  slug: string;
  producerName: string;
  /**
   * Render-prop — receives an `onClick` to wire to whatever button-
   * shaped element the parent wants to render. Returns the trigger
   * element. The trigger sits in the layout BEFORE the modal.
   */
  trigger: (props: { onClick: () => void }) => ReactNode;
}

export function BookingFlowTrigger({
  slug,
  producerName,
  trigger,
}: BookingFlowTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger({ onClick: () => { setOpen(true); } })}
      <BookingFlowModal
        open={open}
        onOpenChange={setOpen}
        slug={slug}
        producerName={producerName}
      />
    </>
  );
}
