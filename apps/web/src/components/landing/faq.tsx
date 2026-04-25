"use client";

import { useState } from "react";

// FAQ — DARK world. Accordion of 6 questions with a single-active-item
// open state. New section in S3 (no source HTML equivalent). Restyled
// to match the warm aesthetic — uses landing.css `.faq-item`,
// `.faq-question`, `.faq-answer`, `.faq-icon` classes.
//
// Behaviour: clicking a closed question opens it AND closes any other
// open question. Clicking the currently open question closes it.
// useState<number | null>(null) starts with all closed.
//
// The chevron rotation + max-height transition both ride the catch-all
// reduce-motion gate at the top of landing.css §7 (Story 1) — no per-rule
// motion gate needed here.
//
// Tests pin FAQ_ITEMS, isFaqItemOpen, and the structural invariants
// (6 items, default-closed, all questions present in markup).

// Pure helper — exported so the test suite can pin the open-state rule
// without rendering React. Returns true iff this item is the currently
// active one. activeIndex=null means every item is closed.
export function isFaqItemOpen(activeIndex: number | null, itemIndex: number): boolean {
  return activeIndex === itemIndex;
}

// FAQ_ITEMS — 6 questions a real producer asks before paying for new
// software. Pinned by the test so a drift (additions/removals/reordering)
// fails fast. Order is intentional: data ownership first (the masters
// fear), then payment fear, then the operational + cancellation fears.
export const FAQ_ITEMS: readonly { q: string; a: string }[] = [
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
] as const;

export function FAQ() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
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
          {FAQ_ITEMS.map((item, i) => {
            const open = isFaqItemOpen(activeIndex, i);
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
                    setActiveIndex(open ? null : i);
                  }}
                >
                  <span>{item.q}</span>
                  <span className="faq-icon" aria-hidden>
                    {/* Chevron — rotates 180deg via .faq-item.is-open */}
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
  );
}
