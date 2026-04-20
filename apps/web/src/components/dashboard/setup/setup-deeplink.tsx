"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Allow-list of valid section keys for the Setup screen. Keeping this
// exported so the server page (and any tests) stay in lock-step with
// the client-side scroll target resolution. Unknown `?section=` values
// are ignored silently — the producer just lands at the top of the
// page, which is the Profile section anyway.
export const SETUP_SECTION_KEYS = [
  "profile",
  "services",
  "portfolio",
  "availability",
  "connections",
  "account",
] as const;
export type SetupSectionKey = (typeof SETUP_SECTION_KEYS)[number];

export function isSetupSectionKey(v: unknown): v is SetupSectionKey {
  return typeof v === "string"
    && (SETUP_SECTION_KEYS as readonly string[]).includes(v);
}

// Client island that reads `?section=<key>` and scrolls the target
// section into view with a brief highlight. The middleware redirects
// the legacy /dashboard/portfolio → /dashboard/settings?section=portfolio
// and we want the producer to land AT the portfolio card, not the top
// of a long settings page.
//
// The scroll target is keyed off `data-setup-section=<key>` on the
// section element — we avoid passing the id directly so the server-
// rendered anchors double as scroll hooks without adding extra props.
// A short `data-setup-focused` flag triggers a CSS outline pulse for
// 1.2s, matching the reveal-up timing already used on dashboard
// headers. Effect is idempotent via a ref guard — navigating back to
// the same section in the same render does re-focus (we want it to).
export function SetupDeeplink() {
  const search = useSearchParams();
  const sectionParam = search.get("section");

  useEffect(() => {
    if (!sectionParam) return;
    if (!isSetupSectionKey(sectionParam)) return;
    const target = document.querySelector<HTMLElement>(
      `[data-setup-section="${sectionParam}"]`,
    );
    if (!target) return;
    // smooth scroll; behaves like an anchor jump but less jarring.
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.setAttribute("data-setup-focused", "true");
    const timer = window.setTimeout(() => {
      target.removeAttribute("data-setup-focused");
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [sectionParam]);

  return null;
}
