# SK-297 handoff — the keyboard pushes the phone import editor off screen

**Status: FIXED 2026-09-06**, measured and verified on a simulated iPhone. See the
resolved section below; the hypotheses further down are kept only as a record and two of
them are wrong.

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

## RESOLVED 2026-09-06 — measured on a simulated iPhone, then fixed

Reproduced, mechanism confirmed, fix verified on the device. Two earlier entries in this
document are **wrong** and are corrected below; read this section before either of them.

### How it was measured without Gili's phone

The native simulator MCP tool refuses (`xcode-select` gate), AppleScript needs Accessibility
permission, `simctl` has no tap, and Homebrew no longer ships `idb-companion` — so nothing
could tap the screen. A programmatic `focus()` will not raise the iOS keyboard in Safari, but
it will inside a `WKWebView` you own.

So: a ~90-line Swift app (`scratchpad/kbharness/main.swift`), built with
`xcrun -sdk iphonesimulator swiftc`, bundled by hand, `simctl install` + `launch`. It loads
the dev page, focuses a named field, and prints the viewport numbers as **text** at each step.
That last detail matters — the first reading was taken off a screenshot, the Dynamic Island
covered a digit, `478` was read as `778`, and an entire wrong theory was built on it.

Two traps: `WKWebView` caches the dev server's chunk URLs across edits, so use
`WKWebsiteDataStore.nonPersistent()` and `.reloadIgnoringLocalAndRemoteCacheData` or you will
measure the pre-fix bundle and think your fix did nothing. And a parallel session overwrote
`.claude/launch.json`, deleting the port-3297 entry mid-run.

### What iOS actually does (iPhone 17, iOS 26.2)

| state                        | innerH | vv.height | vv.offsetTop | `kbd` before fix | shell top |
| ---------------------------- | ------ | --------- | ------------ | ---------------- | --------- |
| closed                       | 778    | 778       | 0            | closed           | 0         |
| shallow field (Client name)  | 663    | 471       | 115          | closed           | −115      |
| deep field, keyboard already up | 670 | 471       | 108          | closed           | −108      |
| **deep field from closed**   | **478**| 471       | **300**      | **closed**       | **−300**  |

The last row is the reported bug, and it is a settled state — held unchanged over 15s.

**`innerHeight` does NOT stay constant across an iOS keyboard.** It collapses onto the visual
viewport (478 against a height of 471) while `position: fixed` still resolves against a layout
viewport ~771 tall. So `innerHeight - height - offsetTop` = 478 − 471 − 300 = **0** obscured,
far under the 120px threshold, and `keyboardOpen` reads false while the keyboard fills half
the screen. `globals.css:2096` then pins `.sk-native-screen { top: 0 }`, and the shell — whose
height is already the 471px strip — sits at layout rows `[0, 471]` while the visible strip is
`[300, 771]`. Header and step nav above the fold, page background below. Exactly the report.

Note `--sk-viewport-offset-top` was **already correct at 300px** throughout. Nothing needed
recomputing; the only broken thing was the boolean deciding whether to honour it.

### The fix

`keyboardOpen` also accepts a focused text-entry control, gated on the viewport having
actually moved or shrunk so a hardware keyboard cannot trip it:

```
viewportDisplaced = offsetTop > 0 || innerHeight - measuredHeight >= keyboardThreshold
keyboardOpen      = obscuredHeight >= keyboardThreshold || (textEntryFocused && viewportDisplaced)
```

`obscuredHeight` is untouched and still feeds `keyboardInset`, so the action dock's maths is
unchanged. This is not a new idea: `globals.css` already hides the bottom nav on the same
focus signal, and says why — *"some routes shrink innerHeight and visualViewport together and
therefore report no measurable keyboard inset."* That is this bug, already written down.
`NativeViewportSync` now resamples on `focusin`/`focusout` and exports
`TEXT_ENTRY_FOCUS_SELECTOR` so the CSS and the metrics read the keyboard the same way.

Verified on the device: same iOS numbers, `kbd: open`, shell top **0** instead of −300, stable
across six samples. All four previously pinned metrics cases keep their exact results.

### Corrections to the rest of this document

1. **The "leading hypothesis" below — iOS scrolling the `overflow: hidden` shell — is
   REFUTED.** `article.scrollTop` measured `0` in every sample, broken and fixed alike. The
   shell never scrolled; it was positioned wrong. The guard switch could never have helped.
2. **A "sharpened prediction" written earlier on 2026-09-06 was wrong.** It claimed iOS holds
   `innerHeight` constant so the keyboard could be detected from `innerHeight - height`, and
   quoted thresholds of 203/179. Measurement killed it: the shrink is 7px, that rule still
   reports "closed", and the fix built on it changed nothing on the device. It has been
   removed rather than left to mislead. Third wrong theory, caught before shipping.

## Leading hypothesis (untested) — REFUTED, see the resolved section above

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

|                                |                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Status                         | Fixed and verified on a simulated iPhone 17 / iOS 26.2. Not merged — waiting on Gili.               |
| Fix                            | `components/native/native-viewport.tsx` — focus fallback for `keyboardOpen`                          |
| Tests                          | 3 added in `native-viewport-and-motion.test.ts`; 2 fail without the fix, all from measured numbers    |
| Earlier live fix               | `712dfc9` (PR #417) body scroll lock — ineffective, left in place, removing it is a separate call     |
| Branch                         | `claude/keyboard-hiding-content-yy8s2u`                                                              |
| Linear                         | SK-297                                                                                               |
| Measurement rig                | `scratchpad/kbharness/` — throwaway WKWebView app, not committed                                      |
