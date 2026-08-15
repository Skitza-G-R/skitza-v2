# SK-249 — Mobile PWA install invitation

**Status:** Implemented on 15 August 2026; browser visual lane pending  
**Linear:** SK-249  
**Scope:** Signed-in mobile producers and artists only

## Outcome

Skitza clearly tells signed-in mobile users that it can be installed as an app. The invitation is
beautiful, brief, dismissible, and honest about the installation flow available on the current
device.

This task presents the existing installable PWA foundation. It does not change Web Push, offline
caching, service-worker cache policy, backend APIs, database schema, public landing pages, or the
desktop-app download experience.

## Experience contract

1. After the signed-in mobile app shell settles, an eligible browser opens one premium install
   sheet. It never appears on public, sign-in, or sign-up routes.
2. The invitation uses the real Skitza app icon, the title **Get the Skitza app**, the benefit copy
   **Open Skitza full screen, straight from your Home Screen.**, and the actions **Install Skitza**
   and **Not now**.
3. On browsers exposing `beforeinstallprompt`, **Install Skitza** opens the browser-owned install
   confirmation. Accepted, dismissed, unavailable, and failed outcomes are handled without a dead
   button or false success message.
4. On iPhone and iPad, **Install Skitza** reveals a three-step Share → Add to Home Screen → Add
   guide. If **Open as Web App** is shown by the OS, the guide tells the user to leave it enabled.
5. On other mobile browsers without a programmable prompt, the same action reveals truthful manual
   browser-menu instructions.
6. **Not now**, overlay dismissal, Escape, or sheet dismissal suppresses automatic guidance for 90
   days. A manual **Install Skitza** entry remains in both producer and artist mobile account menus.
7. Standalone or known-installed contexts render no invitation or account-menu entry. Installation
   never requests notification permission.

## Visual direction

The sheet should feel like a small Skitza app sleeve, not a generic browser alert.

- **Palette:** existing warm canvas, elevated surface, sidebar ink, and amber brand tokens.
- **Type:** Syne for the title, Outfit for explanatory copy, and the existing utility typography for
  small labels.
- **Layout:** a compact app-icon hero, one clear message, then the platform-specific action area.
- **Signature:** the real Skitza Home Screen icon sits inside a restrained amber/ink stage that
  previews the installed-app feeling before the user commits.
- **Controls:** 48px primary and secondary actions use `rounded-[var(--radius-lg)]`; icon-only
  controls may remain circular.
- **Motion:** use the existing sheet entrance and press primitives only; reduced-motion users get no
  entrance or press animation.

## UI states

| Context                              | Automatic invitation                                                         | Primary action               | Manual account entry |
| ------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------- | -------------------- |
| Mobile Chromium with captured prompt | Yes                                                                          | Native install prompt        | Yes                  |
| iPhone/iPad browser                  | Yes                                                                          | Three-step Home Screen guide | Yes                  |
| Other mobile browser                 | Yes                                                                          | Browser-menu guide           | Yes                  |
| Dismissed within 90 days             | No                                                                           | —                            | Yes                  |
| Standalone/known installed           | No                                                                           | —                            | No                   |
| Desktop browser                      | Preserve existing contextual behavior                                        | Existing native prompt       | No new entry         |
| Anonymous/auth/public route          | No                                                                           | —                            | No                   |
| Offline                              | Invitation may explain availability, but cannot claim installation succeeded | Reconnect guidance           | Yes                  |

## Accessibility and responsive rules

- Preserve the Radix sheet focus trap and return focus to the initiating control.
- Provide a real title and description; decorative icons stay hidden from assistive technology.
- Keep every action at least 44px high with visible keyboard focus and non-color status cues.
- The instruction sequence is ordered text, not an image, so zoom and screen readers preserve it.
- Respect mobile safe areas, the on-screen keyboard, 360px and 390px portrait widths, landscape,
  dark mode, and reduced motion.
- Never open over another active dialog or sheet.

## Implementation boundaries

- Extend the existing PWA install-state helper with immediate signed-in mobile eligibility, robust
  iPadOS detection, and a manual-open event.
- Redesign `NativeInstallGuidance` around invitation and instruction views while retaining the
  existing captured prompt and installed-state handling.
- Add one shared install row to the producer and artist mobile account sheets.
- Keep the existing PWA manifest, icons, service-worker cache rules, and push behavior unchanged.

## Verification

- Unit tests: eligibility, 90-day suppression, mobile/iPad detection, standalone suppression, and
  storage failure.
- Interaction tests: automatic invitation, native prompt accepted/dismissed/failed, Apple/manual
  instructions, manual re-entry after dismissal, focus return, and installed hiding.
- Required project gates: typecheck, lint, focused tests, full tests, and production build.
- Browser checks on HTTPS: 360px, 390px, desktop regression width, no horizontal overflow, no page
  errors, and screenshots for the invitation and iPhone instruction states.

### Verification record — 15 August 2026

- **PASS:** typecheck, lint, focused interaction tests, the full repository test suite, and the
  production build.
- **PARTIAL:** the in-app browser blocked the localhost preview through its local-URL security
  policy. No screenshot or visual-pass claim was made.
- **Still required before promotion:** inspect the invitation and Apple instruction states at true
  360px and 390px widths, confirm the desktop shell is unchanged, check horizontal overflow and
  console errors, and capture visual evidence.
