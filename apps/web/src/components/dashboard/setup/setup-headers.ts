// Per-section page-level header copy for /dashboard/settings.
//
// Pre-flatten the page rendered a single static H1 ("Your studio,
// dialed in.") with a generic description below. After the flatten
// every tab is its own focused surface, so the H1 + description swap
// per active tab — the eyebrow stays "SETUP" so the page identity
// is constant. This map is the source of truth for that per-tab
// copy; settings/page.tsx looks it up by SetupSectionKey.
//
// PURE DATA MODULE — no `"use client"` directive. The settings page
// is a server component and reads these strings during render; the
// 2026-04-23 RSC-boundary mistake (page importing a function from a
// client module) means we keep this strictly server-and-test-importable.
//
// Profile keeps the editorial "Your studio, dialed in." copy because
// that's the default landing tab — first impression on the page is
// still a brand moment. The other six tabs use focused-task copy
// that mirrors what the per-section cards used to display before
// the flatten.

import type { SetupSectionKey } from "./setup-deeplink";

export interface SetupSectionMeta {
  title: string;
  description: string;
}

export const SETUP_SECTION_META: Record<SetupSectionKey, SetupSectionMeta> = {
  profile: {
    title: "Your studio, dialed in.",
    description:
      "Everything that’s not day-to-day client work — your identity, services, portfolio, hours, and payments — lives on one page.",
  },
  services: {
    title: "What you sell.",
    description:
      "Each service is one thing clients can book — sessions, mixing, mastering, production days. Set a price, a duration, and a deposit rule.",
  },
  portfolio: {
    title: "Your tracklist.",
    description:
      "Flag the tracks that play for visitors on your join page, before they sign up. Up to three appear publicly — pick the ones that sell the vibe.",
  },
  availability: {
    title: "When you’re open.",
    description:
      "Weekly hours, buffers between sessions, and blackout dates. Clients only see slots that fit inside these windows.",
  },
  autopilot: {
    title: "What Skitza handles for you.",
    description:
      "Flip a switch and it’s automatic. Flip it back whenever you want — nothing here is locked in.",
  },
  connections: {
    title: "Your tools, connected.",
    description:
      "Stripe takes deposits and final payments. Skitza adds no platform fee — you keep everything minus Stripe’s standard rates.",
  },
  account: {
    title: "Your account.",
    description:
      "Export your data, manage email and password, or replay the four-screen tour any time.",
  },
};
