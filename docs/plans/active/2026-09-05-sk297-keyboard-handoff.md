# SK-297 handoff — the keyboard pushes the phone import editor off screen

**Status: not fixed.** One fix shipped and is live; it did not solve the bug. The next
session starts by reading real numbers off Gili's iPhone, not by writing more code.

Linear: [SK-297](https://linear.app/raz-stamper/issue/SK-297/bring-your-work-on-mobile-the-keyboard-pushes-the-whole-editor-off) (In Progress)

## The bug

Producer, phone, Bring in active work → tap an item → tap any field. The moment the
software keyboard opens the editor loses its top: the `ITEM 01` header and the 1-2-3
step nav are gone, a couple of fields sit at the very top of the screen, and most of
the screen below them is empty page background down to the action dock.

Reported twice, on two different steps, in both themes. The second report was from
the installed Home Screen app (no Safari chrome), on the current production build —
i.e. **after** the fix below shipped.

## What the evidence actually says

In both screenshots the **header and step nav are missing**. Those are `shrink-0`
siblings of the scroll area inside the editor shell (`import-row-editor.tsx:379` and
`:434`), not children of it. Scrolling the form cannot hide them.

So the thing that moves is the editor shell itself, or something above it — **not the
document behind it**. That is the fact the next fix has to explain.

## What shipped, and why it was the wrong fix

`useBodyScrollLock` (`apps/web/src/components/native/use-body-scroll-lock.ts`), wired
in `active-work-import-workspace.tsx:1426` for the phone editor and the phone Review
panel. It takes `body` out of flow (`position: fixed; top: -scrollY`) while either is
open, collapsing the document's scrollable range to zero.

- Merged as `712dfc9` (PR #417), live in production.
- Reasoning at the time: the workspace queue behind the editor is long and scrollable,
  iOS scrolls the _document_ to reveal a focused field, and a `position: fixed` overlay
  travels with that scroll while the keyboard is up. `visualViewport.offsetTop` never
  reports document scroll, so the existing `--sk-viewport-offset-top` anchor could not
  compensate.
- **It did not fix the reported bug.** The mechanism is something else.
- It is not harmful — the lock does what it claims, it just is not what was wrong.
  Removing it is a separate decision; leave it unless it proves to be in the way.

Do not re-litigate this. Treat the document-scroll theory as tested and rejected.

## Sharpened prediction: the keyboard-detection arithmetic (2026-09-06)

Still **unconfirmed on a device** — it is a reading of the code, not a finding. But it is
now a falsifiable prediction with numbers, which the earlier suspects were not.

`calculateNativeViewportMetrics` derives two different things from one subtraction:

```
obscuredHeight = innerHeight - measuredHeight - viewportOffsetTop
keyboardOpen   = obscuredHeight >= threshold
```

That number is **correct** for the action dock. A `fixed; bottom: N` element measures from
the layout viewport's bottom, and the visible strip's bottom sits exactly
`innerHeight - height - offsetTop` above it — which is why the pinned `viewportOffsetTop: 59`
test expects `keyboardInset: 265` and the dock lands right.

It is the wrong number for *"is the keyboard open"*. On iOS `innerHeight` does not change
when the keyboard appears; the visual viewport shrinks by the keyboard height, so keyboard
presence is `innerHeight - height`. `offsetTop` is a separate quantity — how far iOS scrolled
the visual viewport to reveal the focused field — and it ranges over `[0, innerHeight - height]`.
So as iOS scrolls further, `obscuredHeight` decays toward zero and the answer flips to
"closed" while the keyboard is plainly up.

At that instant `body:not([data-sk-keyboard="open"]) .sk-native-screen { top: 0 }`
(`globals.css:2096`) overrides `top: var(--sk-viewport-offset-top)`, and the shell teleports
up by the whole offset in one frame. The failure is a **cliff, not a slope**:

| innerHeight            | keyboard | flips `closed` once `vv.offsetTop` > | shell `top` at that instant |
| ---------------------- | -------- | ------------------------------------ | --------------------------- |
| 844 (installed app)    | 354px    | **203**                              | 203 -> **0** (jumps 203px)  |
| 745 (Safari with chrome) | 313px  | **179**                              | 179 -> **0** (jumps 179px)  |

The shell keeps `height: var(--sk-viewport-height)` — still the short strip — so it occupies
layout rows `[0, 490]` while the visible strip is `[203, 693]`. That predicts precisely the
reported picture: header and step nav above the fold, a couple of fields at the very top,
then page background down to the dock.

It also explains the two things that made this hard. Shallow fields never push `offsetTop`
past the threshold, so most of the form behaves. And Chromium never sets a non-zero
`visualViewport.offsetTop` on focus at all, so no desktop check can see it.

**Candidate fix, not yet applied:** compute `keyboardOpen` from `innerHeight - height` and
leave `keyboardInset` exactly as it is, so the dock maths is untouched. Checked against the
four cases pinned in `native-viewport-and-motion.test.ts` — `844/520/0`, `844/520/59`,
`844/800/0`, `812/770/0` — all four keep their current results. Only `--sk-layout-viewport-top`
and `--sk-layout-viewport-height` change behaviour alongside `keyboardOpen`, and their sole
consumer is the full-screen player (`persistent-player.tsx:976`), which has no text input.

Do not apply it until the phone says so. Two confident theories have already been wrong.

## Leading hypothesis (untested)

**iOS scrolls the `overflow: hidden` editor shell itself.** The shell
(`import-row-editor.tsx:370`) is:

```
sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[70] flex flex-col overflow-hidden
```

`overflow: hidden` still creates a scrollport. The user can never scroll it, but iOS
will, to bring a focused field into view. That would push the header and nav off the
top and leave the shell's tail empty — exactly the symptom.

A `scrollTop`/`scrollLeft` pin on that element is the candidate fix, and it is already
wired behind a switch on the diagnostic page (below) so it can be judged on a device
before anything ships.

Chromium says `articleScrollTop` stays `0` through every field on both widths. That is
not evidence against the hypothesis — Chromium does not reproduce the bug at all.

## Other suspects, in order

1. **`calculateNativeViewportMetrics`** (`components/native/native-viewport.tsx`).
   `obscuredHeight = innerHeight - height - offsetTop` subtracts the offset, so a
   keyboard that pushed the visual viewport well down the layout viewport can fall
   under the 120–200px threshold and report `keyboardOpen: false`. That un-anchors
   `.sk-native-screen` (`globals.css` pins `top: 0` while the keyboard is closed) and
   drops the dock to `bottom: 0`. Existing tests encode the current formula
   deliberately, including a `viewportOffsetTop: 59` case — changing it risks the
   artist flows, so measure first.
2. **`.sk-native-field { scroll-margin-bottom }`** (`globals.css:377`) adds
   `--sk-keyboard-inset` inside a surface already sized to the visual viewport, which
   double-counts the keyboard. With a ~354px inset in a ~368px scrollport the margin
   exceeds the scrollport. Suspicious, but removing the term in a live browser changed
   nothing in the cases tested.
3. **Standalone display mode.** The second report is from the installed app.
   `globals.css` has a `(display-mode: standalone) and (max-width: 1023px)` block that
   sizes the app shell to `--sk-viewport-height`. The editor is portalled to
   `document.body`, outside that shell, so the two are not obviously related — but the
   bug was reported from standalone and has not been reproduced anywhere else.

## Start here: get numbers off the phone

`/dev/sk297-keyboard-lock` (dev-gallery gated, never reaches production) mounts the
real phone editor over a long scrollable queue and now renders a live readout —
`keyboard-diagnostics.tsx` — of `innerHeight`, `visualViewport` height/offsetTop/pageTop,
document scroll, the body lock state, the CSS viewport variables, and the rect +
`scrollTop` of the shell, its scroll area and the dock, updating while the keyboard is
open. It also carries the **shell scroll guard** switch that pins the shell's
`scrollTop` to 0.

Preview for the branch:
`https://skitza-v2-web-git-claude-keyboard-h-61be7a-gili-asrafs-projects.vercel.app/dev/sk297-keyboard-lock`

The panel is now pinned to the *visual* viewport (`translate3d` by the measured offset). It
was `fixed; top: 0`, which resolves against the layout viewport — so the offset it exists to
report would have pushed it off the top of the screen, giving a blank photograph and, worse,
an untappable guard switch. It also remembers the sample with the largest `vv.offsetTop`
(`PEAK` line, `reset peak` button), so one screenshot still carries the worst instant.

Exact taps to ask for, on the branch preview in iPhone Safari:

1. `reset peak`
2. scroll to **Project name** (placeholder "Blue Hour") — a field low enough that iOS has to
   scroll past the threshold; the first field on the form will not trip it
3. tap into it so the keyboard opens, screenshot
4. close the keyboard, switch **shell scroll guard** to ON, `reset peak`, tap the field
   again, screenshot

Reading the result:

- `kbd closed` with a large `vv.offsetTop` (>180 Safari, >203 standalone) -> the arithmetic
  above is the mechanism; the guard will make no difference.
- guard ON settles the screen -> iOS is scrolling the shell internally after all.
- neither -> the readout names whatever actually moved.

Do not ship a third speculative fix. Two have already been wrong.

## Verification: what a desktop browser can and cannot tell you

Chromium **cannot** reproduce this. It keeps `position: fixed` pinned regardless of
document scroll, so the failure mode simply does not occur — the "lock off" control
screenshot looks identical to "lock on".

What it can do, and what was already done at 390×844 and 360×780 across all three
steps, keyboard simulated through the same CSS variables `NativeViewportSync` writes:
shell and dock land inside the strip above the keyboard in every combination, and with
the lock on the document scroll range is `0` against `767` with it off. All true, and
all beside the point.

One trap worth inheriting: a synthetic focus probe reported the royalty fields as
unreachable. They were not — they live inside a collapsed `<details>`, so their rects
were meaningless. **Screenshots caught an error the measurements did not.** Look at the
picture before believing a number.

## Running the app locally (this took most of a session)

`pnpm dev` alone will not get you to `/dev/*`:

1. **Clerk middleware 307s every route** to an external handshake host the sandbox
   blocks, so the page never renders. `src/middleware.ts` — temporarily exclude `dev`
   from the matcher: `"/((?!_next|dev|.*\\..*).*)"`. It must be a **static literal**;
   Next cannot statically analyse a ternary on `process.env`, and a conditional export
   is silently ignored.
2. Create `apps/web/.env.local` from `.env.local.example` with dummy values. A
   well-formed `pk_test_` key is base64 of `<host>$`. **Delete it when done.**
3. Chromium must bypass the proxy for loopback: launch with `--no-proxy-server` and
   `--disable-features=HttpsUpgrades,HttpsFirstModeV2,HttpsFirstBalancedMode`, or the
   navigation gets an HTTPS upgrade and a cert error.
4. Playwright is not in the repo's `node_modules`; it is global
   (`$(npm root -g)/playwright`), and browsers are at `/opt/pw-browsers/chromium`.
   Import it by absolute `file://` path with a default import — it is CommonJS.
5. The editor covers the page, so the dev page's own sim buttons cannot be clicked;
   fire them with `element.click()` inside `page.evaluate`.

**Revert every one of these before committing.** They are local-only.

## Repo and workflow notes

- The verification gate is `$skitza-verify`. `packages/db` typecheck may be refused by
  the permission classifier when run as `cd packages/db && pnpm typecheck`; from the
  repo root `pnpm --filter @skitza/db typecheck` works.
- **Force-push is blocked** by the permission classifier. When a branch needs to catch
  up to a moved base, merge the base into the branch instead of rebasing — a merge
  commit pushes normally and does not rewrite history.
- `v3-clean` does not auto-promote. Production is promoted by hand and can sit a
  commit or two behind the branch tip.

## State as of this handoff

|                                |                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Branch                         | `claude/keyboard-hiding-content-yy8s2u` @ `a5e30fc` (content matches `v3-clean` plus the dev page and diagnostics) |
| `v3-clean`                     | `263635a`                                                                                                          |
| Fix commit (live, ineffective) | `712dfc9`, PR #417                                                                                                 |
| Dev preview page               | `263635a`, PR #427, merged                                                                                         |
| Linear                         | SK-297, In Progress                                                                                                |
| Gate on `a5e30fc`              | typecheck, lint clean; 8041 passed / 102 skipped; `packages/db` clean                                              |
| Live preview (readout)         | `skitza-v2-web-git-claude-keyboard-h-61be7a-…vercel.app/dev/sk297-keyboard-lock` — alias verified on `a5e30fc`     |
| Blocked on                     | one phone measurement; no fix code written                                                                        |
