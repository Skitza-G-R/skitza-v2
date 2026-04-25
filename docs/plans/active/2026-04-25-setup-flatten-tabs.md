# Setup tab flatten — inline forms, dynamic header

**Branch:** `feat/setup-flatten-tabs`
**PRD:** §4.4 (already specifies inline forms; this PR brings impl into compliance)
**Track:** Standard BMAD

## Problem

Two of the seven Setup tabs (Services, Availability) currently render a "cross-link card" — eyebrow + title + description + a button that bounces the producer over to `/dashboard/booking?tab=…`. Every other tab is already inline. The asymmetry is jarring and forces an extra hop for the two most-touched configuration surfaces.

## Solution

1. **Lift the form content inline.** The forms already exist on the Booking page — `PackagesTab` (services CRUD) and the Sessions stack (`GCalSyncBadge` + `DurationPicker` + `PoliciesEditor` + `AvailabilityEditor` + `BlackoutsEditor`). Wrap each as a new `setup/services-section.tsx` and `setup/availability-section.tsx` and render them in `settings/page.tsx` for the matching `?section=` value.
2. **Dynamic page header.** Replace the static H1 (`"Your studio, dialed in."`) with a `SETUP_SECTION_META[active]` lookup. Eyebrow stays `SETUP`. Breadcrumb drops (H1 carries orientation).
3. **Strip redundant inner headers.** `PortfolioSection`, `AutopilotSection`, `StripeCard` each have a single inner `<h2>` + description that now duplicates the page-level header. Remove. `SettingsForm` keeps its inner `Studio profile` / `Brand` h2s — those are real subsections of one tab. `AccountSection` keeps `Your data` / `Tour` for the same reason.
4. **Legacy redirects.** Add `/dashboard/services` → `?section=services` and `/dashboard/availability` → `?section=availability` to the `STATIC_REDIRECTS` map in `middleware.ts`.

## Out of scope

- Booking page restructure. The Sessions / Weekly / Upcoming / Packages tabs there stay as-is — same forms, same URLs. We're adding inline rendering to Setup, not deleting from Booking.
- Servicing forms changes (PackageForm, AvailabilityEditor internals). Pure structural lift.
- A `/dashboard/booking?tab=packages` redirect — query-string redirects don't fit the path-based middleware table cleanly. Producers can still hit Booking directly; the cross-link button into Booking is what's being removed.

## File touch list

**Edit:**
- `apps/web/src/app/(app)/dashboard/settings/page.tsx` — dynamic header, lift services + availability data fetches, render new section components, drop `CrossLinkSection` + breadcrumb
- `apps/web/src/components/dashboard/setup/portfolio-section.tsx` — strip inner header
- `apps/web/src/components/dashboard/setup/autopilot-section.tsx` — strip inner header
- `apps/web/src/app/(app)/dashboard/settings/stripe-card.tsx` — strip inner header
- `apps/web/src/middleware.ts` — add 2 redirects
- `apps/web/messages/en.json` + `apps/web/messages/he.json` — add `setup.headers.<key>.title` + `.description` keys (translated). Hebrew placeholder OK per CLAUDE.md i18n rules.

**New:**
- `apps/web/src/components/dashboard/setup/services-section.tsx`
- `apps/web/src/components/dashboard/setup/availability-section.tsx`
- `apps/web/src/components/dashboard/setup/setup-headers.ts` — pure data module exporting `SETUP_SECTION_META: Record<SetupSectionKey, { title: string; description: string }>`. Pure data so both server page + tests can import without `"use client"` boundary.
- `apps/web/src/components/dashboard/setup/__tests__/setup-headers.test.ts` — pin keys + non-empty content (covers all 7 keys, no missing entries)
- `apps/web/src/__tests__/middleware-redirects.test.ts` — pin `resolveLegacyRedirect` for the 2 new paths

## Test strategy

- **Section meta** — pin `SETUP_SECTION_META` shape: must have all 7 keys; each must have non-empty title + description; profile keeps the editorial copy. Same pattern as the existing `setup-deeplink.test.ts`.
- **Middleware redirects** — call `resolveLegacyRedirect` directly (already exported). RED first by adding test before adding the redirects.
- **Component module shape** — assert each new section file is NOT a `"use client"` module if it's intended to be server-rendered, OR is `"use client"` if it owns local state (matches the project-page invariant test pattern from CLAUDE.md mistake log 2026-04-23).

## Risks / mistakes to avoid

- **Don't import a `"use client"` module from the server page if the import is a non-component value.** PortfolioSection / AutopilotSection / StripeCard are all `"use client"` but they export React components — that's safe. Don't accidentally export a constant from a client module that the server page reads.
- **Don't break i18n keys.** `setup.tabs.<key>` already exists; keep using it for the tab labels. New `setup.headers.<key>.title` is additive — must be added to en.json AND he.json or `useTranslations` throws at render.
- **Don't widen `Promise.all` to fetch packages/availability when those tabs aren't active.** Cost matters at page load; the existing pattern only fetches portfolio rows when `active === "portfolio"`. Mirror that for the two new tabs.
