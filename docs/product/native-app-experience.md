# Skitza Native App Experience

**Status:** Confirmed

**Decision date:** 2026-07-24

**Decider:** Gili Asraf

## Product intent

Skitza should not feel like a website with PWA features. The Home Screen version should feel like the primary Skitza iPhone app.

Spotify is the benchmark for continuity, immediacy, navigation, and uninterrupted audio—not for visual design. Skitza keeps its own identity.

## North star

Once installed, Skitza should never feel like Safari hiding its address bar:

- No browser chrome.
- No page-reload feeling.
- No blank waiting.
- No lost context.
- No interrupted music.
- No delayed taps.
- No forms resetting.
- No obvious distinction between screens and web pages.

This applies across the producer app, artist app, and public listening and booking experience.

## Opening Skitza

When someone taps the Home Screen icon:

- Skitza opens standalone, without an address or search bar.
- The iPhone status bar remains visible and blends naturally into Skitza.
- Signed-in users enter immediately without repeated login.
- The exact previous screen, scroll position, player state, filters, and unfinished work return.
- Cached content appears immediately.
- Fresh data loads silently in the background.
- Updates apply on a safe reopen, never during a form, payment, booking, or upload.

Desktop installation should provide the same standalone experience, but phone quality comes first.

## Zero perceived loading

“Zero loading” means users should almost never have to wait before seeing useful context.

- The app shell always remains visible.
- Previously viewed content appears immediately, even if briefly stale.
- Existing content is never replaced by a spinner while refreshing.
- Skeletons appear only for genuinely unseen content: a new device, cleared storage, or a screen never opened.
- No blank pages or full-screen loading circles.
- Navigation preloads likely destinations.
- Returning to Skitza or reconnecting refreshes quietly.

Normal edits should update immediately and roll back with a clear explanation if they fail. Payments, bookings, availability, and other important transactions must wait for real confirmation.

## Navigation and screen behavior

Signed-in mobile users get one persistent, role-aware app shell:

- Fixed bottom navigation that never disappears or reloads.
- Producer and artist navigation tailored to their different jobs.
- Opening an item feels like pushing into a new iPhone screen.
- Back returns to the exact previous position and state.
- Swipe-back works where practical.
- Transitions are fast, subtle, and directional.
- Motion explains what happened but never delays the user.

The tab names discussed during discovery were examples, not final decisions.

Anonymous public visitors get a focused, app-like listening and booking journey—not signed-in tabs or installation interruptions.

## Native UI details

These details are a definition of done for every screen, not a final cosmetic pass:

- Immediate pressed feedback on every tappable element.
- Comfortable iPhone-sized touch targets.
- Correct notch, status-bar, and Home Indicator spacing.
- Keyboards never cover inputs or primary actions.
- Appropriate phone keyboards for email, numbers, dates, and money.
- Short actions use bottom sheets.
- Longer tasks use full-screen flows.
- Progress, success, and errors appear beside the relevant action.
- Sharing opens the phone’s system share menu.
- Light and dark mode follow the device, with a manual override.
- Larger system text works without breaking layouts.
- Reduced-motion preferences are respected.
- No fake haptics; reliable vibration is unavailable in an iPhone PWA.

This native standard should be built into shared components and then checked screen by screen.

## Music

Audio is central to the Spotify comparison:

- Music continues uninterrupted between screens.
- A persistent mini-player is always available while something is playing.
- Lock-screen artwork and playback controls work.
- Reopening restores the player and listening context.
- Recently played, unlocked music can be cached for instant replay and best-effort offline listening.
- This is not a permanent download library.
- Storage is capped, locked music is excluded, and cached audio clears on sign-out.

## Offline behavior

Previously viewed screens should remain useful without internet.

- Cached content remains readable.
- Recent unlocked music may continue playing if available.
- Booking, payments, edits, and other live actions clearly require internet.
- Skitza never pretends an online action succeeded.
- Reconnecting refreshes without removing the user’s current context.

## Drafts and uploads

- Forms, comments, and text drafts save automatically.
- Closing and reopening restores them.
- Uploads continue while users move around Skitza.
- Upload progress remains visible across screens.
- Skitza warns before leaving with an unfinished upload.
- Skitza does not promise that iPhone will continue uploading after iOS fully closes the PWA.

## Notifications and installation guidance

Producers and artists should receive useful notifications while Skitza is closed.

- Relevant events include real bookings, payments, comments or messages, and important status changes.
- Tapping a notification opens the exact related item, not the homepage.
- Permission is requested only when the user enables something useful.
- Permission is never requested on first launch.
- Installation is encouraged after a meaningful successful action for signed-in producers and artists.
- Anonymous visitors are never interrupted with installation prompts.

## Accepted constraints

- No App Store for now.
- No reliable vibration.
- No guaranteed permanent offline audio.
- Do not copy Apple’s or Spotify’s appearance.
- Do not promise that network work literally takes zero time.

## Definition of done

If someone uses installed Skitza for a full day, none of these should reveal that it is a website:

- Browser bars.
- Blank transitions.
- Loading flashes.
- Lost scroll position or screen state.
- Stopped audio.
- Delayed taps.
- Covered forms.
- Vanished upload progress.
- Forgotten drafts.
- Disruptive updates.

## Decisions still to resolve

The following details do not change the core experience, but require separate decisions before their affected behavior is implemented:

- Exact producer and artist navigation tabs.
- The exact meaningful action that triggers installation guidance.
- Exact notification categories and defaults, limited to features that actually exist.
