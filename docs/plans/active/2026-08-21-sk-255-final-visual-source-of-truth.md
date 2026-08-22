# SK-255 final visual and integration source of truth

**Status:** approved finish gate from Gili's latest feedback on 21 August 2026.

**Purpose:** prevent the SK-255 finish pass from drifting back to the rejected four-step UI, to a generic HTML preview, or to stale screenshots.

## Authority order

1. Gili's latest explicit decision in SK-255 or the working Codex task.
2. This finish gate for visual presentation, responsive behavior, and proof.
3. `2026-08-21-sk-255-compact-import-handoff.md` for the compact three-step behavior and edge cases.
4. Linear SK-255 and `docs/product/PRD.md` for durable product, money, ownership, invitation, reminder, and safety rules.
5. Earlier plans and screenshots are historical context only.

When two sources disagree, stop and use the higher source. Do not silently choose.

## Correction that triggered this finish pass

The isolated Vite screenshots are **not accepted visual proof**. They rendered current feature components, but invented a light text-only dashboard shell and substituted Arial/system fonts for Skitza's real Syne, Outfit, and JetBrains Mono pipeline. They are useful only as behavior-harness evidence.

The older four-step screenshots and the five repository visual references are also not final acceptance evidence. They can explain density or state intent, but must not be copied or presented as the current design.

Only screenshots captured from the real Next.js route inside the real authenticated Skitza v3 `AppShell` count for visual sign-off.

## Product behavior that remains locked

- The visible item flow is exactly **Client & Project → Agreement → Payments**.
- Desktop is a compact work queue plus one focused editor. It is not a marketing page, hero, dashboard of statistic cards, or stack of tall cards.
- Mobile starts at the queue and opens one item in a full-screen editor.
- Agreement shows required essentials first and reveals optional detail only when requested.
- Payments show a compact installment list with exactly one inline editor.
- A fully recorded Payment 1 opens, scrolls to, and focuses Payment 2 with a blank date.
- A partial Payment 1 stays on Payment 1 and prefills only the remaining amount.
- A final 50/50 installment stays locked until exact Artist approval.
- Review keeps original row order and expands exactly one item.
- Drafting and creation contact nobody. Invitations stay optional. Finish setup activates reminders only for eligible unpaid installments; final 50/50 waits for Artist approval.
- Preserve autosave, retry, provenance, ownership, access, download, ledger, silent creation, invitation, and reminder behavior.
- No schema, migration, server-domain, production, merge, deployment, or promotion work is authorized by this finish pass.

## Real Skitza visual direction

### Subject and job

This is a producer's fast intake desk for roughly ten existing clients and active music projects. Its one job is to make a batch truthful and ready without making the producer feel that they are filling a generic admin database.

### Existing token system — do not invent a new theme

- Canvas: Skitza warm cream, `#F2EDE6`, through `--bg-background`.
- Shell/text: Skitza near-black, `#111009`, through the existing shell and foreground tokens.
- Work surfaces: existing elevated white token.
- Accent: Skitza mustard, `#D4960A`, reserved for the selected-row edge, current step, and the single primary action.
- Status: existing semantic success, warning, and danger tokens only.
- Display type: real Syne, used with restraint for the page's main title only.
- Body/forms/actions: real Outfit.
- Money, dates, IDs, step numbers, and compact metadata: real JetBrains Mono.

### Layout and signature

The signature is the same restrained 3px amber selection/playhead used by the real Skitza sidebar: it ties the stable queue row to the active editor. Everything else stays quiet so this signal remains meaningful.

```text
1024px and wider
┌ real dark Skitza rail ┬ real top bar ─────────────────────────────┐
│                       │ compact page header + one primary action │
│                       ├──────── queue 40% ─┬──── editor 60% ─────┤
│                       │ stable 64px rows   │ one current step     │
│                       │ independent scroll│ one action footer    │
└───────────────────────┴────────────────────┴──────────────────────┘

below 1024px
┌ real Skitza mobile top bar ┐
│ queue first                │
│ full-screen item editor    │
│ real Skitza bottom nav     │
└────────────────────────────┘
```

Do not add gradients, glow, a dark inner hero, decorative statistics, oversized headings, or new visual effects. Distinctiveness comes from the real Skitza shell, type, warm materials, disciplined linework, and the amber selection/playhead.

## Required finish corrections

1. Align the workspace/editor mode switch with Skitza's `lg`/1024px shell switch. Widths 768–1023 must not show the desktop split inside the mobile shell.
2. Use canonical Skitza table/card surfaces: subtle borders and warm `shadow-sm`; keep the queue table quieter than the editor.
3. Reserve Syne for one display anchor. Workflow section titles use the normal dashboard section hierarchy.
4. Reserve mustard for selected/current/primary states. Tertiary links and decorative eyebrows use default or muted text.
5. Show exactly one primary action. While a payment editor is open, **Save payment** is primary; **Finish item** cannot compete with it.
6. Make the mobile Payments summary compact instead of four tall rows.
7. Make the mobile Review dock compact: safety message plus one usable action row, without hiding the last review row.
8. Make Agreement essentials, lists, and terms genuinely compact on desktop and mobile while keeping all exact required facts.
9. Make Review metadata readable at compact Skitza table sizes; do not use 8px essential labels.
10. Make Setup fill the desktop workspace width, with its inner content centered.
11. Apply the locked radius tiers to text buttons and keep loading/loaded dividers consistent.

## Verification gate

The feature is not finished until all of the following are true:

- The exact SK-255 worktree and branch are confirmed before every implementation or verification run.
- Focused regressions cover every correction above.
- Typecheck, lint, full tests, and the web production build pass.
- The real route is exercised through real user actions in the real Skitza shell.
- Database-backed verification targets only `skitza-v3` (`raspy-pine-96654399`) and the confirmed isolated `sk-255-test` branch (`br-noisy-band-al2lz7n8`). Never use `quiet-sun-92221754`.
- No real invitation, reminder, payment, or client-facing message is sent.
- Fresh screenshots are captured from the real route at desktop, 390px, and 360px for queue, Client & Project, Agreement, Payments with Payment 1 collapsed and Payment 2 open, Review, and Setup.
- Screenshots use the real dark desktop shell or real mobile chrome, real fonts, and show no horizontal overflow, clipping, competing primary actions, stale four-step UI, or fake preview chrome.
- The final Linear update names the exact checks, screenshot paths, database target, and any remaining blocker.

## Scope guard

Implementation remains inside:

- `apps/web/src/app/(producer)/dashboard/clients-projects/bring-active-work/**`
- `apps/web/src/components/dashboard/active-work-import/**`

This document and the matching Linear update are the only documentation changes authorized by Gili's request to record the finish gate. Stop and report before any server-domain, schema, migration, or unrelated file change.
