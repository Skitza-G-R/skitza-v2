# Artist platform professional UI/UX — approved plan

**Date:** 2026-07-30  
**Status:** Product and UI/UX direction approved by Gili; this rebuild has not
started, while legacy versions of several covered surfaces remain live  
**Decider:** Gili Asraf  
**Related issue:** [SK-65](https://linear.app/raz-stamper/issue/SK-65/artist-platform-handoff-4-wave-mobile-first-rebuild-be-2be-3-producer)  
**Surface:** Signed-in artist platform  
**Development base and PR target:** `v3-clean`

## Goal

Bring the artist platform up to the same product-quality standard as the
producer platform while keeping the artist experience simpler and
role-specific.

The result should feel like a professional studio workspace:

- calm, precise, and easy to understand;
- mobile-first without looking like a compressed desktop page;
- visually related to the producer app without copying producer workflows;
- focused on the next useful artist action;
- free of childish decoration, fake controls, and crowded one-page flows.

## Scope

This plan covers:

- artist shell, navigation, top bar, sidebar, and focused-process behavior;
- Studio Switcher and artist Home decisions already approved on SK-65;
- artist Music context behavior, excluding the separate Song Page redesign;
- Store browse and product-detail presentation;
- the transition from product detail into the existing request/agreement flow;
- avatar menu and Artist Settings;
- off-app payment instructions, proof upload, and proof-verification states;
- Sessions, booking, rescheduling, and cancellation;
- the minimal product data and producer-authoring control needed to mark a
  product as bookable;
- artist notification center and notification preferences;
- loading, empty, error, responsive, accessibility, and continuity rules for
  these surfaces.

This plan does not cover:

- processing, moving, or holding money inside Skitza;
- card checkout, Stripe checkout, Tranzila checkout, or a payment provider;
- producer-platform redesigns, except reuse of shared UI primitives and the
  minimal `bookingEnabled` product control required by this plan;
- public `/join` or anonymous storefront screens;
- the individual Song Page, which has its own approved plan;
- request fields, agreement rules, and the purchase-request backend lifecycle;
- Messages or any route that does not exist;
- new purchasing rules for product types that are not already supported
  end-to-end;
- production migration, merge, or deployment approval.

## Source precedence

This plan consolidates:

1. Gili's approved Studio Switcher and Artist Home decisions recorded on SK-65
   on 2026-07-30.
2. Gili's artist-platform UI/UX grilling decisions from 2026-07-30.
3. The confirmed native-app experience contract.
4. Current code, used only to describe actual behavior and known gaps.

The latest decisions in this plan override conflicting older material,
including:

- Artist Home designs that combine studios or always make the last upload the
  hero.
- The decorative Boutique and record-shop Shelf treatments previously proposed
  for Artist Store.
- The earlier global interpretation of the single-active-purchase guard. The
  guard is now studio-scoped.
- Artist flows that expose card checkout or a disabled “Pay by card — coming
  soon” control.
- Artist Book designs that ask the artist to select a studio after the global
  Studio Switcher already selected it.
- Plans that treat a full month calendar, service list, credit list, notes, and
  confirmation as one long mobile page.

When an older plan, PRD section, prototype, or current implementation disagrees
with this file, this file is the approved UI/UX direction.

## Core product rule

Artist and producer use the same product system, not the same screens.

Share by default:

- visual tokens and typography roles;
- button, menu, dialog, sheet, toast, and form behavior;
- navigation feedback and active states;
- notification-center behavior;
- loading, empty, error, and offline patterns;
- touch targets, focus states, reduced motion, and safe-area handling;
- desktop/mobile breakpoints and native continuity behavior.

Keep role-specific:

- information architecture;
- labels and copy;
- content priority;
- workflows and permissions;
- artist versus producer actions.

## Standing screens and focused processes

A **standing screen** is a normal app destination. It keeps the artist shell:

- Home;
- Music;
- Sessions;
- Store;
- product detail before the artist starts a request;
- Settings;
- proof-record detail and history reached from its real context;
- session detail.

A **focused process** begins only after the artist deliberately starts a
multi-step action. It hides normal navigation and shows Back, progress when
useful, and one primary action:

- request and agreement;
- payment instructions and proof submission;
- booking a session;
- rescheduling;
- cancelling;
- account deletion.

Opening a normal page is not enough to hide navigation. Navigation returns when
the process completes or the artist exits it.

Focused chrome removes:

- desktop sidebar;
- mobile bottom tabs;
- normal app header, bell, avatar, and breadcrumbs;
- the visible mini-player.

It replaces them with one process header containing Back, a short title, and
progress only when the process has multiple meaningful steps.

Audio continues at the app level while moving through these screens. A focused
process hides the visible mini-player, but it must not create an accidental
playback reset.

Successful proof submission ends the focused process. Awaiting, rejected,
and verified proof records—and aggregate partially verified purchase
progress—are standing detail states on later visits and retain normal
navigation.

### Surface and chrome matrix

| Surface                                                                | Type     | Chrome behavior                                                   |
| ---------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| Home, Music, Sessions, Store, Settings                                 | Standing | Full role-aware artist shell                                      |
| Product detail                                                         | Standing | Full shell until **Request to book** is pressed                   |
| Existing request/agreement flow                                        | Focused  | Process header only; detailed flow rules remain separately scoped |
| Payment instructions                                                   | Focused  | Process header only                                               |
| New proof upload                                                       | Focused  | Process header only                                               |
| Awaiting/rejected/verified proof and aggregate partial-purchase detail | Standing | Full shell                                                        |
| Session detail                                                         | Standing | Full shell                                                        |
| New booking                                                            | Focused  | Process header only                                               |
| Reschedule or cancel                                                   | Focused  | Process header only                                               |

Before implementation, the issue must map each row to canonical routes and
define every entry, Back, success, and exit destination. Product detail must no
longer be hidden merely because its pathname begins with `/artist/purchase/`.

## Information architecture

### Mobile

Use four persistent tabs:

1. Home
2. Music
3. Sessions
4. Store

Settings lives in the avatar menu. “Sessions” replaces “Book” because it covers
both existing sessions and starting a new booking.

The normal mobile header contains:

- selected studio identity / Studio Switcher on the leading side;
- notification bell;
- artist avatar.

### Desktop

Use the producer platform's professional shell grammar:

- dark collapsible sidebar;
- shared active-state and focus behavior;
- artist-specific links: Home, Music, Sessions, Store;
- account area at the bottom;
- shared top-bar and breadcrumb behavior where useful.

Do not display the current artist search control until artist search is real.
A visible search control must search actual artist music, sessions, and studios.

## Studio context

The Studio Switcher behaves like a workspace switcher.

For this release, one studio maps to one producer account and `producerId` is
the studio-scope key. If Skitza later allows one producer account to own
multiple studios, that requires a separate scope-key decision and migration.

- The selected studio scopes Home, Sessions, Store, proof/payment records, and
  the default Music view.
- Settings is global and shows every connected studio.
- Remember the selected studio between visits for the same signed-in browser
  profile. Cross-device synchronization is not required by this plan.
- A studio-specific link automatically selects its studio.
- Switching studios keeps the artist in the same section where possible.
- From a studio-specific detail page, switch to the equivalent section root for
  the new studio.
- One connected studio shows its name and logo without an arrow or menu.
- The control becomes a switcher only when a second studio is connected.
- New studios are added only through a producer's link. Do not add studio search
  or an “Add studio” action.
- If the selected studio disconnects, select another connected studio. With no
  studios remaining, show the producer-link connection state. The shell remains
  available so the artist can reach Settings and Past studios, but it has no
  active Studio Switcher value.
- Skitza's colors and layout remain stable. Only studio identity and content
  change.
- Show the studio name once on studio-scoped screens instead of repeating it on
  every item.

Book must not contain another studio picker.

The following precedence applies only to active-studio routes. Past-studio
history routes keep local read-only context and never select a disconnected
studio.

Context precedence is deterministic:

1. Ownership of a studio-specific detail route
2. Valid studio context in an incoming link
3. Last valid saved studio
4. Most recently connected active studio

Ignore an invalid or disconnected studio ID. Saved state must be isolated by
signed-in user so one account never inherits another account's studio.

Before Phase 1 code, the implementation issue must select the smallest
server-compatible persistence mechanism—cookie, Clerk metadata, or database
state—and record it in a short technical decision. Do not assume a new database
column without that decision.

## Music exception

- Music defaults to the selected studio.
- Music also has a local **All music** view.
- All music is one combined list, newest first.
- Every All music row shows its studio.
- Playing an All music song does not change the selected studio.
- Opening the full song or project changes context to that song's studio.
- Choosing a studio in the global switcher exits All music and shows that
  studio's library.
- Back navigation preserves the local Music view.

When an artist opens a song from All music and then goes Back, return to All
music at the previous scroll position. The selected studio remains the song's
studio because opening the full item deliberately changed context.

The individual Song Page follows its separate approved professional-redesign
plan.

## Artist Home

Home is studio-scoped and shows one contextual main action.

Priority:

1. Session happening today
2. Proof/payment action needed
3. Approved package ready to schedule
4. New song
5. View services or book something new

Rules:

- Passive states such as pending review or proof verification remain compact.
- The main card has one clearly dominant action.
- Within one priority level, choose the item with the nearest upcoming
  time/deadline. If no time applies, choose the newest activity; use stable ID
  order only as the final tie-breaker.
- Supporting links are visually smaller.
- Quiet rows below the main card show only other meaningful information.
- Do not duplicate the main item below it.
- Do not render empty sections.
- A new artist sees one welcome card:
  `Welcome to {Studio}. Everything you make together will appear here.`
  The action is **View services**.
- Use a short greeting such as `Good morning, Yael.`
- Remove the large date eyebrow and judgmental copy such as `Working late`.
- Do not show multi-studio booking tiles on Home.
- Use a studio-scoped action such as **Book with Gili** when booking is useful.
- Show detailed purchase progress only when it is the main card.
- Use real song artwork when available. Otherwise use honest studio identity
  artwork, logo, or a restrained gradient.
- Only an explicit Play control starts audio. Opening the title or card goes to
  details.
- Keep `NEW` until the artist plays or opens the song.
- Session copy uses local labels such as `Today, 16:00–18:00` and
  **View session**.
- Show timezone only when it prevents confusion.
- Emphasize the amount due now; make full package price secondary.
- Use labels such as `First payment`, `Remaining balance`, or
  `Payment 2 of 4`, not only `50-50`.
- Do not show `Pay all` unless one real combined action exists.
- Use plain language, not dashboard terms such as `OPEN`, `roster`, or
  `heartbeat`.
- Only the main action receives strong card treatment.
- Reserve amber for the main action or a real warning.
- Important load failures show Retry instead of silently removing content.

## Avatar menu

The avatar menu contains:

- artist name and email;
- Settings;
- **Switch to Producer** for a dual-role user;
- Sign out.

Switching roles goes directly to the other role and preserves the last screen
used on each side.

Profile editing belongs in Settings. The avatar menu links to it rather than
opening a second profile editor.

## Artist Settings

Settings is global and is not filtered by the selected studio.

These are the approved Settings destinations:

- Profile
- Notifications
- Calendar and timezone
- Appearance
- Connected studios
- Account

Do not add a payment-method section. Skitza does not process money.

Render a destination only when it contains at least one functional control.
Profile, Connected studios, and Account may be grouped on one smaller screen
until the other destinations are functional. Omit Push, calendar sync, and
reminder controls until their delivery, permission, and failure behavior works
end-to-end.

Rules:

- Use the producer Settings interaction pattern when a section has real editable
  fields: clear section navigation, dirty-state feedback, and an explicit
  save/discard action.
- Hide unavailable integrations instead of filling the page with
  `Coming soon` rows.
- Name and profile-photo editing live under Profile.
- Appearance owns the theme override.
- Calendar and timezone appear only to the extent that their controls work.
- Connected studios lists every studio regardless of the selected context.
- Disconnected studios with preserved history appear under a read-only
  **Past studios** group. They do not re-enter the Studio Switcher.
- Opening a Past studio row shows one standing, read-only studio-history screen
  with Music, Proof records, and Sessions sections. It has no Home, Store,
  booking, proof-upload, or collaboration action.
- A Past studio screen keeps the normal artist shell and labels the historical
  studio in its own header. It does not change the currently selected active
  studio. Opening a preserved song, proof, or session keeps this read-only
  historical context; Back returns to the same Past studio screen.
- With zero active studios, the same Past studio screen remains reachable from
  Settings. The global header says **No active studio**; the Past studio label
  remains local to the history screen and never becomes a switcher selection.
- Disconnecting a studio requires a clear consequence summary and
  confirmation.
- Disconnecting stops future activity with that studio but preserves purchased
  music, proof/payment records, and session history.
- Disconnect creates an immutable historical-access grant keyed by
  `clerkUserId`, `producerId`, resource type, and resource ID. Past-studio reads
  use these grants; matching an artist email alone is not authorization.
- For purchases linked to projects, grant the exact projects, songs, and
  versions already visible at `disconnectedAt`. Preserve downloads only where
  download access was already unlocked by full producer-verified coverage.
- For a legacy project without a purchase link, grant the exact project, song,
  and version IDs the signed-in artist was authorized to open immediately
  before disconnect. This is a compatibility rule, not a declaration of legal
  ownership.
- Grant the artist's existing proof records and session records for that studio
  at `disconnectedAt`.
- Versions, comments, proofs, sessions, or other resources created after
  `disconnectedAt` are not added to the grant and do not appear in Past studios.
- Disconnect marks the relationship with `disconnectedAt`; it does not delete
  the identity/contact row that anchors history.
- Disconnect is unavailable while that studio has an active purchase, pending
  proof, pending booking decision, unused package entitlement, or future
  session.
- The blocking state clears only through its normal lifecycle:
  - an active purchase is declined or completed under the approved
    active-purchase rule;
  - a pending proof is decided and its purchase then reaches a non-active
    outcome;
  - a pending booking is confirmed and later completed/cancelled, or declined;
  - an unused entitlement is used, expires under its existing terms, or is
    cancelled by the producer;
  - a future session completes or is cancelled under its real policy.
- Disconnect does not add a shortcut for cancelling purchases, abandoning
  credits, cancelling sessions, or deciding proofs. If a state has no valid end
  path, keep Disconnect unavailable rather than inventing one.
- If the disconnected studio was selected, apply the approved Studio Switcher
  fallback.
- Account deletion belongs under Account and requires a focused destructive
  confirmation.
- Do not expose Delete account until the backend deletion and retention rules
  are fully implemented and tested.

## Professional Artist Store

### Direction

Use a professional studio catalog, not a playful boutique, record-shop shelf,
or generic marketplace.

Remove:

- large decorative gradients;
- floating oversized circular logos;
- `Signature` labels;
- fake cover bands;
- strong floating shadows;
- childish or cute illustration;
- excessive uppercase micro-labels;
- decorative pills and badges;
- card layers that do not add information.

Use:

- a compact, restrained studio header;
- real logo or photo when available;
- precise service information;
- neutral elevated surfaces and thin borders;
- restrained 8–16px corner radii based on control size;
- amber only for the primary action or a real warning;
- clear price, duration, session count, and short description;
- one professional **View service** action.

Example:

> Mixing & Mastering  
> 2 songs · 2 revisions · 7–10 days  
> From ₪1,200  
> **View service**

### Catalog behavior

- The selected studio owns the Store context.
- Do not mix products from several studios.
- List only active, positive-price products in the three supported models.
- Do not add search or filters while catalogs remain small.
- The producer controls product order.
- Use one compact studio header followed by a single-column service catalog on
  mobile and a restrained one- or two-column catalog on desktop.
- The first live product may use a wider card and stronger type, but the same
  information and interaction structure as every other product. It must not
  use a decorative cover band or floating artwork.
- Additional products use compact bordered cards on mobile and may use a
  two-column grid on desktop when space allows.
- Each browse card shows, in order: service name, one short description,
  price, duration/session count when relevant, and **View service**.
- Every supported pricing model uses the same product-detail structure. Pricing
  controls change; visual hierarchy and the request transition do not.
- This plan supports:
  - `flat`, using its locked flat price;
  - `bundle`, using its locked bundle price and session count;
  - `per_song`, using an artist-selected song quantity and locked tier price.
- Hide `hourly` products from the signed-in Artist Store for this release. A
  rate alone is not an agreed total, so hourly requires a separate duration,
  total-price, agreement, and proof-lifecycle decision.
- A direct link to an unsupported or non-positive-price product returns to the
  selected studio's Store with a neutral
  `This service is not available to request yet.` message.
- Once separate product-visibility support exists, unlisted products open
  through their direct links but remain absent from the normal catalog.
- The current schema has no unlisted visibility state. Do not fake this
  behavior. Add it only through separately issue-covered product visibility and
  producer-authoring support.
- Artists may browse while a purchase is active.

### Product detail

Use one professional information order:

1. Back/navigation context; rely on the shell for studio identity instead of
   repeating it
2. Service name
3. Price or quantity-aware price summary
4. Short description
5. What is included
6. Duration/session count and the studio cancellation policy when relevant
7. Plain explanation:
   `After your request is approved, the studio will send Bank or Bit instructions. Skitza does not process the payment.`
8. One **Request to book** action

Product detail is a standing screen. Pressing **Request to book** starts the
existing focused request/agreement flow. This plan does not change agreement
fields or approval rules.

### Active-purchase guard

- One studio may have only one active purchase at a time.
- The guard starts when the artist submits a purchase request.
- It ends when the request is declined, when producer-verified proof records
  cover the agreed total, or—only if a separately supported
  request-cancellation lifecycle exists—when that lifecycle records the request
  as cancelled.
- The current release has no purchase-cancellation status or action, and this
  plan does not add one. Therefore decline and full producer-verified coverage
  are the two release paths implemented by this plan.
- An active purchase with one studio does not block a purchase request with a
  different studio.
- Show the current status and next action instead of a generic disabled button.
- Skitza never independently determines whether money moved.
- Enforcement resolves every `clientContactId` for the signed-in
  `clerkUserId` and selected `producerId`, serializes on that user/studio pair,
  and checks blocking requests across all of those contact rows. Selecting one
  arbitrary contact row is not sufficient.

This supersedes the older global interpretation of the purchase guard.

## Off-app payment and proof verification

### Product contract

- Skitza does not process, move, or hold money.
- The artist pays the producer outside Skitza.
- Skitza may display producer-provided Bank or Bit instructions.
- Skitza stores the artist's submitted proof.
- Each proof is attached to one purchase installment and uses that
  installment's locked amount; the artist does not type a different amount.
- The producer verifies that full proof amount or rejects the proof.
- Skitza displays the resulting record and status.
- Do not display card checkout or `Pay by card — coming soon`.
- Do not describe Skitza as confirming the transfer itself. Skitza records the
  producer's verification.

### Three-state proof experience

#### 1. Instructions

Show only:

- amount to send;
- producer;
- Bank or Bit;
- copyable payment details;
- one short note when provided by the producer;
- **I've paid — upload proof**.

If both Bank and Bit exist, show two compact choices and expand only the chosen
method. Do not stack multiple large payment-detail cards.

Enter Instructions only when at least one producer-provided method exists.
Otherwise show:

> Payment instructions have not been provided yet.

Do not show a dead proof-upload action or invent contact details.

#### 2. Upload proof

Show only:

- amount this proof covers;
- take a photo or choose a file;
- selected-file preview;
- local upload error when needed;
- **Send proof**.

Previous proofs and installment progress live in a collapsed
**Payment history** section. They must not push the current action below a long
page.

Preserve current supported proof constraints unless a separate issue changes
them:

- JPG, PNG, WEBP, HEIC, or PDF;
- maximum 15 MB;
- one explicit file selection and preview before submission.

Submitting a proof must be idempotent. A retry after an interrupted upload must
not create duplicate proof records.

#### 3. Verification status

After sending, replace the upload form with a calm status:

> Proof sent to Gili  
> Waiting for verification  
> You can safely leave this screen.

If rejected:

- show the producer's note;
- when no note exists, use neutral copy such as
  `The producer could not verify this proof. Upload a clearer copy.`;
- show one **Upload a clearer proof** action;
- do not retain the full awaiting or upload layout around the error.
- keep the rejected proof in history and append the replacement as a new
  record.

If the purchase is partially verified:

- treat this as aggregate purchase progress, not a third status for one proof;
- show the total producer-verified amount across accepted proof records;
- show the remaining agreed balance;
- show the next real installment/proof action;
- do not label the purchase paid in full.

An individual proof is Awaiting, Rejected, or Verified. Its amount comes from
the locked installment. The purchase is **Partially verified** while the sum of
its verified installments is greater than zero but lower than the agreed total.
The current database proof value `confirmed` maps to the artist label
**Verified**. Do not add a per-proof partial status or an editable verified
amount.

If verified:

- show the producer-verified amount and the remaining agreed balance supplied by
  the purchase record;
- show the correct next action, such as **Book a session** or
  **Back to Home**;
- keep detailed history collapsed.

Awaiting detail refreshes quietly when the app regains focus and when a related
notification arrives. The artist never needs to keep the focused upload screen
open.

### Layout

- Each state has one clear purpose and one primary action.
- Use a compact context summary rather than several stacked hero cards.
- Keep the primary action above the safe-area inset.
- Avoid repeated reassurance copy.
- Avoid showing the same amount in several competing cards.
- Proof history remains accessible but visually secondary.
- A standing proof record is reachable from the current purchase, a related
  Home action, an exact notification, and the relevant Past studio. This does
  not require a new bottom tab or a separate Payments hub.
- Instructions and new upload use focused chrome. Every later proof-record
  visit uses standing-screen chrome.

## Sessions and booking

### Sessions hub

The Sessions tab opens a standing workspace, not the calendar.

Show:

- next session;
- pending requests;
- upcoming sessions;
- past sessions;
- **Book a session** when the selected studio has a real bookable entitlement;
- otherwise **View services**.

Use real data. Do not ship mock sessions or a fake detail view.

### Booking eligibility

- A booking belongs to an approved product or active package whose product
  contract explicitly has `bookingEnabled = true`.
- Add `bookingEnabled` to the product contract. Do not infer it from
  `durationMin`, `sessionCount`, product kind, or price. Deliverable-only
  products may carry those legacy values without creating a session credit.
- A one-off or intro session is represented by a studio product with
  `bookingEnabled = true`.
- Do not ask for the studio again.
- A producer-verified initial payment or required current installment unlocks
  its bookable entitlement. Full producer-verified payment is still required
  for download access.
- New purchases snapshot three separate values:
  - `bookingEnabledSnapshot`;
  - `bookableSessionCountSnapshot`, positive for a finite package and zero only
    when booking is disabled;
  - `unlimitedSessionsSnapshot`, true for an unlimited package.
- A real bookable entitlement means `bookingEnabledSnapshot` is true, payment
  has unlocked booking, and either `unlimitedSessionsSnapshot` is true or at
  least one finite credit remains.
- During legacy migration, current `sessionCount = 0` maps to
  `unlimitedSessionsSnapshot = true` only for products or legacy projects that
  pass the explicit booking-eligibility rule. It never means booking disabled.
- Existing products and entitlements remain non-bookable until the producer
  explicitly confirms `bookingEnabled`. The only automatic legacy exception is
  a project with a prior Confirmed booking; it keeps the established
  `project.sessionCount` credit behavior. Do not infer eligibility from a
  template such as Remote feedback.
- New purchases snapshot the product's per-session `durationMin` when the
  request is submitted. Every booking from that entitlement uses the snapshot,
  even if the live product changes or is archived.
- Existing legacy entitlements without a duration snapshot use the linked
  product duration when it still exists; otherwise use the studio's
  `defaultSessionMin`. Always show this duration before confirmation.
- Existing booking history uses the booking row's own `durationMin`.
- Cancellation uses the studio-level `cancellationPolicyHours`, snapshotted
  onto the booking when it is created. Later studio-setting changes do not
  rewrite an existing booking's policy.
- Before the new UI ships, backfill existing bookings that lack the snapshot
  with their producer's current `cancellationPolicyHours`; record the backfill
  time. After backfill, all cancellation checks use the booking snapshot.

### Timezone contract

- Producer availability is authored in the studio's saved IANA timezone.
- The server resolves available slots to UTC instants.
- The artist's global Settings timezone is authoritative for artist-facing
  dates, day grouping, `Today`, and time controls.
- On first use when no artist timezone is saved, detect the browser's IANA
  timezone and persist it as the artist default. If detection fails, use UTC
  and let the artist change it in Settings.
- Convert UTC slots into the artist timezone before grouping them into
  available days. Never send a date label plus an unconverted studio-local
  minute value.
- Submit the selected UTC instant, not a browser-local date string.
- When artist and studio timezones differ, Review and Session detail show the
  artist time first and a secondary `Studio time: …` line with both timezone
  abbreviations.
- Use IANA timezone rules for daylight-saving transitions. Do not store a fixed
  numeric offset as the timezone.

### Package selection

- One active package: select it automatically.
- Entry from a package: preserve that package.
- Several active packages from the general Sessions screen: show one compact
  package-selection step.

Example:

> Vocal Production · 2 sessions left  
> Mixing Consultation · 1 session left

### Entitlement reservation

- A manual-approval booking atomically reserves one package credit when it
  enters Held.
- Automatic approval atomically consumes one credit when it enters Confirmed.
- Producer approval converts the Held reservation into one consumed credit
  without decrementing a second time.
- Decline, approval timeout, or cancellation before confirmation releases the
  reservation.
- Cancelling a Confirmed future session through an allowed cancellation path
  restores that credit. A Completed session never restores it.
- Rescheduling transfers the original reservation or consumed credit. The
  replacement time never reserves or consumes a second credit.
- Unlimited-session packages still use the same booking states but have no
  numeric credit mutation.

Every slot and credit change occurs in the same server transaction. Money and
proof status are unaffected by session-credit restoration.

### Short booking process

1. Choose package, only when needed.
2. Choose from the next available days.
3. Choose an available time.
4. Review and request or confirm.

On mobile:

- show the next useful available days first;
- show large time controls after choosing a day;
- place the full calendar behind **More dates**;
- do not stack a month calendar, time list, services, credits, notes, and
  confirmation on one page.

The duration comes from the selected product or package. Never use a hard-coded
two-hour duration.

### Approval language

- Automatic approval on:
  - button: **Book this time**
  - result: immediately Confirmed
- Automatic approval off:
  - button: **Request this time**
  - result: Held while the producer reviews it

If the producer declines, release the held time and show **Declined** with a
clear return to Sessions.

### Session statuses

Use the same artist-facing lifecycle words everywhere:

- Held — the slot is temporarily reserved while producer approval is pending
- Confirmed — approved future session
- Declined — producer declined the held request and the slot was released
- Completed — a confirmed session whose end time has passed
- Cancelled — cancelled before completion

`Rescheduled` is an audit event and temporary confirmation message, not a
durable lifecycle status. Existing database statuses may map to these display
labels; the implementation issue must document the mapping before UI work.

A new Held request expires at the earlier of 24 hours after submission or its
scheduled start time. Expiry atomically releases the slot and reserved package
credit, records a cancellation reason of `approval_timeout`, and displays
**Cancelled** with the explanation `The studio did not confirm this request in time.`

Legacy `pending_payment` bookings are a retirement prerequisite, not a new
artist status:

- new artist flows stop creating `pending_payment`;
- on artist screens, an existing row maps to **Held** with
  `This booking uses an older payment flow. The studio needs to resolve it.`;
- `/artist/payment/[bookingId]` redirects to that standing session detail and
  never opens Tranzila or another checkout;
- before rollout, inventory every live `pending_payment` row;
- the producer must resolve each inventoried row by confirming it only after
  off-app verification, or cancelling it and releasing its slot/credit;
- if the producer lacks those audited transitions, add them under separate
  migration issue coverage before removing the legacy route;
- do not auto-confirm, auto-cancel, or rewrite live rows without explicit
  approval for that migration.

### Session detail

Show:

- producer;
- product or package;
- local date and time;
- timezone when needed;
- duration;
- status;
- participants;
- applicable cancellation policy;
- Reschedule when the current status and policy allow it;
- Cancel when the current status and policy allow it.

Terminal or policy-blocked sessions show the policy explanation instead of
disabled fake actions. Show a contact action only when a real configured contact
method exists.

Action availability is exact:

| State                                                | Reschedule                                                   | Cancel                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| Held new request, before its start                   | No                                                           | Yes; withdraw and release slot/credit                     |
| Confirmed, before cancellation cutoff                | Yes                                                          | Yes                                                       |
| Confirmed, at/after cutoff or already started        | No                                                           | No                                                        |
| Declined, Completed, or Cancelled                    | No                                                           | No                                                        |
| Legacy `pending_payment` shown as Held, before start | No                                                           | Yes; cancel and release slot/credit                       |
| Confirmed original with a Held replacement request   | No second reschedule; **Withdraw change** keeps the original | Cancels both only when the original remains before cutoff |

The cancellation cutoff is
`booking.startsAt UTC − booking.cancellationPolicyHoursSnapshot`. Compare it
with server time. At the exact cutoff, self-service Cancel and Reschedule are no
longer allowed. Timezone display never changes this calculation.

### Reschedule

- Enter a focused process.
- Choose a new available time.
- Review the change.
- Keep the original session until the new time is confirmed successfully.
- For manual approval, keep the original session until the producer approves
  the held replacement. A decline leaves the original session unchanged.
- Show a local failure and Retry if the change fails.

### Cancel

- Enter a focused confirmation.
- Allow self-service only inside the booking's snapshotted studio cancellation
  window.
- Outside the window, show the policy explanation. Offer contact only when a
  real configured contact method exists.
- Never show a success state until the server confirms the cancellation.
- Cancellation does not imply a refund or money movement. Financial outcomes
  remain governed by the off-app agreement.

### Participants and calendar

- The artist may add participant name and email.
- A participant receives the calendar invitation but does not need a Skitza
  account.
- Do not display participant entry until its storage, invitation delivery, and
  failure behavior work end-to-end.
- Show Add to Calendar, calendar sync, and reminder controls only when their
  delivery and failure behavior genuinely work.

## Artist notifications

### Notification center

Use the producer notification center's interaction model:

- desktop popover;
- mobile bottom sheet;
- All and Unread views;
- true read state;
- Mark as read;
- Mark all read;
- empty, loading, failure, and retry states;
- keyboard and focus management;
- exact-item navigation.

### Bell badge

The bell shows genuinely unread notifications only.

Do not use the bell count as a proxy for:

- upcoming sessions;
- outstanding proof/payment actions;
- recent songs that have already been read.

Those action states belong on Home and their relevant standing screens.

### Events

Create artist notifications only for real events:

- purchase approved or declined;
- proof verified or rejected;
- booking confirmed, declined, changed, or cancelled;
- session reminders;
- new song or version;
- producer reply or comment;

Tapping a notification opens the exact song, proof record, booking, comment, or
project item.

Emit a notification only when its exact destination exists and the artist is
authorized to open it. Do not create a comment or reply notification that points
to a missing Messages route.

### Channels and preferences

- In-app: on by default.
- Transactional email: on by default.
- Activity email: off by default.
- Push: off until the artist deliberately enables it.
- Preferences are configurable by category and channel once that channel works
  end-to-end. Transactional and activity email defaults may be changed by the
  artist.
- Do not request push permission on first launch.
- Omit Push controls until subscription storage, permission handling, delivery,
  cleanup, and exact-item opening are functional.

Artist delivery matrix:

| Event                                               | In-app | Transactional email | Activity email        | Switcher dot for another studio  |
| --------------------------------------------------- | ------ | ------------------- | --------------------- | -------------------------------- |
| Purchase approved or declined                       | Yes    | Yes                 | —                     | When an artist action is needed  |
| Proof verified or rejected                          | Yes    | Yes                 | —                     | When an artist action is needed  |
| Booking confirmed, declined, changed, or cancelled  | Yes    | Yes                 | —                     | Confirmed, changed, or cancelled |
| Session reminder                                    | Yes    | Yes                 | —                     | No                               |
| New song or version                                 | Yes    | —                   | Optional, default off | Yes                              |
| Producer comment or reply with an exact destination | Yes    | —                   | Optional, default off | Yes                              |

The recipient is the authorized artist attached to that studio purchase,
proof, booking, song, or project. Do not notify an artist that they submitted
their own booking request; the Held result is shown immediately in the process
success state. The producer's notification for a new request remains a
producer-side concern.

Confirmed sessions schedule one reminder 24 hours before start and one reminder
1 hour before start. If a session is created after a reminder threshold has
passed, skip that old reminder rather than sending it immediately. Each
reminder is idempotent. Do not add a generic “important project status” event;
new event kinds need an exact artist-facing label, destination, channel
behavior, and separate approval.

### Relationship to Studio Switcher dots

The notification center does not replace the approved switcher dots.

- Bell: complete notification history across studios.
- Switcher dot: another studio has a relevant unseen update.
- Use dots, not counts, in the switcher.
- Dot-worthy switcher events:
  - new song or producer comment;
  - proof/payment action required;
  - booking approved, changed, or cancelled.
- Opening the switcher does not clear the dot.
- Clear it only after opening the related item.
- The closed switcher shows a dot while any non-selected studio has at least one
  unseen dot-worthy item.
- Each affected studio row keeps its dot until all dot-worthy items for that
  studio have been opened.
- Opening the related item also marks its matching notification read.
- Notification read state and switcher-dot item-open state are stored
  separately. Marking a notification read from the center does not clear a
  studio dot; only opening the related item does.

### Required notification technical design

The current notification model is producer-owned and cannot simply be reused by
passing artist data into the component. Before implementation, the issue must
define:

- artist recipient ownership;
- artist read-state storage;
- producer/studio association for filtering and switcher dots;
- supported event kinds and emitters;
- preference storage;
- email and optional push delivery semantics;
- exact same-origin destination validation;
- account switching and sign-out cleanup;
- any schema migration and its safe rollout.

Do not begin notification UI implementation until this contract exists.

## Current implementation gaps

These are facts to fix during implementation, not open product questions.

| Area                  | Current gap                                                                                                                                                                        | Evidence                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Artist top bar        | Uses the older translucent treatment; search is a no-op and the bell is passive.                                                                                                   | `apps/web/src/components/shell/artist-topbar.tsx`, `app-topbar.tsx`                                                                        |
| Studio context        | `?studio=` is not carried across normal artist navigation.                                                                                                                         | `studio-switcher.tsx`, `artist-bottom-nav.tsx`, `artist-desktop-sidebar.tsx`                                                               |
| Home scope            | Home assembles activity across connected studios instead of using one selected-studio context.                                                                                     | `apps/web/src/app/(artist)/artist/page.tsx`, `apps/web/src/server/trpc/routers/artist.ts`                                                  |
| Home → Book           | A Home link uses `producerId` while Book reads `studio`, so it can open the wrong studio.                                                                                          | `book-session-tiles.tsx`, `artist/book/page.tsx`                                                                                           |
| Music scope           | The default Music query is not selected-studio scoped, and its normal route does not carry a studio identifier.                                                                    | `apps/web/src/server/trpc/routers/artist.ts`, `apps/web/src/app/(artist)/artist/music/page.tsx`                                            |
| Song `NEW` state      | Recency is inferred from connection-level `lastSeenAt`; there is no explicit per-song open/play acknowledgement.                                                                   | `apps/web/src/server/trpc/routers/artist.ts`, `packages/db/src/schema.ts`                                                                  |
| Avatar and profile    | Raw Clerk UI is used, the fetched dual-role state is discarded, and profile editing is delegated to Clerk rather than Artist Settings.                                             | `artist-app-shell.tsx`, `artist-mobile-top-bar.tsx`, `apps/web/src/app/(artist)/artist/settings/page.tsx`                                  |
| Artist navigation     | The current shell still treats Book as a destination and does not map Sessions into the approved tab/sidebar structure.                                                            | `artist-bottom-nav.tsx`, `artist-desktop-sidebar.tsx`, `apps/web/src/components/artist/artist-shell-route.ts`                              |
| Focused chrome        | Every `/artist/purchase/*` route is currently treated as focused, including product detail.                                                                                        | `apps/web/src/components/artist/artist-shell-route.ts`                                                                                     |
| Notifications         | Artist has a proxy count, no item feed, no artist read state, and no mobile bell. The existing inbox model is producer-owned.                                                      | `server/artist/shell-data.ts`, `artist-topbar.tsx`, `apps/web/src/server/trpc/routers/inbox.ts`, `packages/db/src/schema.ts`               |
| Store                 | Decorative gradients, floating logo, `Signature` tag, strong shadows, and split product journeys conflict with this plan.                                                          | `components/artist/store/*`, `lib/store/product-href.ts`                                                                                   |
| Store guard           | Current enforcement locks and checks one `clientContactId`, not every contact row belonging to the same signed-in artist and producer. Strengthen it to the approved studio scope. | `apps/web/src/server/trpc/routers/purchase.ts`, `packages/db/src/schema.ts`                                                                |
| Unlisted products     | Product visibility for direct-link-only Store items is not represented in the current schema.                                                                                      | `packages/db/src/schema.ts`                                                                                                                |
| Legacy payment routes | A legacy booking payment route and card-oriented Store branches remain reachable.                                                                                                  | `apps/web/src/app/(artist)/artist/payment/[bookingId]/page.tsx`, `apps/web/src/lib/store/product-href.ts`                                  |
| Settings              | Most preference rows are inert `Coming soon` content.                                                                                                                              | `artist/settings/page.tsx`                                                                                                                 |
| Disconnect            | Disconnect currently removes the artist-studio relationship used for authorization; historical-access preservation is not implemented.                                             | `apps/web/src/components/artist/disconnect-producer-button.tsx`, `apps/web/src/server/trpc/routers/artist.ts`, `packages/db/src/schema.ts` |
| Instructions          | Bank, Bit, disabled card, reassurance, and CTA are stacked into a long page.                                                                                                       | `payment-instructions-screen.tsx`                                                                                                          |
| Proof upload          | Current action, status, proof history, progress, and next actions compete on one long page.                                                                                        | `upload-proof-screen.tsx`                                                                                                                  |
| Proof history entry   | The current implementation has no standing proof-record entry path across current purchase, Home, notification, and preserved studio history.                                      | `apps/web/src/app/(artist)/artist/payment/[bookingId]/page.tsx`, `apps/web/src/components/artist/home/payment-requests-section.tsx`        |
| Book                  | Contains a second studio picker and stacks calendar, time, services, credits, notes, and CTA.                                                                                      | `artist/book/booking-client.tsx`                                                                                                           |
| Duration              | Booking submits a hard-coded 120-minute duration.                                                                                                                                  | `artist/book/booking-client.tsx`                                                                                                           |
| Bookable entitlement  | Product data has no explicit booking-enabled contract, so legacy duration/session-count values can make deliverable-only products look bookable.                                   | `packages/db/src/schema.ts`, `apps/web/src/server/trpc/routers/artist.ts`                                                                  |
| Sessions              | Sessions list and detail currently use mock data.                                                                                                                                  | `artist/sessions/page.tsx`, `artist/sessions/[sessionId]/page.tsx`                                                                         |
| Reschedule/cancel     | Reschedule does not restore the intended booking context; Cancel is a placeholder.                                                                                                 | `session-detail-screen.tsx`, `reschedule-confirm-sheet.tsx`                                                                                |
| Payment requests      | `Pay all` currently routes to Book instead of a real combined action.                                                                                                              | `home/payment-requests-section.tsx`                                                                                                        |

## Required technical decisions

These decisions are implementation gates, not invitations to change the
approved experience.

### Route and chrome contract

Record one route matrix covering:

- the canonical standing route for every tab and detail;
- the canonical focused route for request/agreement, proof upload, booking,
  reschedule, cancel, and account deletion;
- each process entry, Back, cancel, success, and error destination;
- which legacy routes redirect, and their exact destinations;
- when selected-studio context is read, written, or replaced;
- how audio survives route and chrome changes.

The product destinations are already fixed:

| Process              | Entry                              | Back or exit                                    | Success                                                             |
| -------------------- | ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Request/agreement    | Product detail                     | Product detail with its prior state             | Use the separately approved request/agreement result                |
| Payment instructions | Standing purchase/proof summary    | The same standing summary                       | New proof upload                                                    |
| New proof upload     | Payment instructions               | Payment instructions                            | Standing proof record in Awaiting                                   |
| New booking          | Sessions or a specific entitlement | Previous step; from step one, the source screen | Exact new session detail in Held or Confirmed                       |
| Reschedule           | Existing session detail            | Existing session detail, unchanged              | The same session detail with Held replacement or confirmed new time |
| Cancel session       | Existing session detail            | Existing session detail, unchanged              | The same session detail in Cancelled                                |
| Delete account       | Settings → Account                 | Settings → Account                              | Signed-out landing after server-confirmed deletion                  |

Validation and recoverable server errors stay on the current step, preserve safe
input, and show Retry. Missing or unauthorized records go to the owning section
root without revealing the record. They do not jump to Home by default.

Legacy card-payment routes must redirect to the relevant standing Store,
purchase, or proof record. Removing a visible link while leaving a reachable
legacy checkout is not complete.

Specifically:

- `/artist/payment/[bookingId]` redirects to that booking's standing session
  detail;
- a supported legacy Store product URL redirects to its unified standing
  product detail;
- an unsupported legacy Store product URL returns to the selected studio's
  Store with the approved unavailable message;
- an old proof link redirects to the canonical standing proof record.

### Studio-context persistence

Choose cookie, Clerk metadata, or database storage using the precedence rules
in this plan. Document server-render behavior, invalid-ID fallback, user
isolation, role switching, sign-out cleanup, and test coverage before changing
the shell.

### Historical access after disconnect

Implement the immutable historical-grant model above so active studio
connection and read-only historical access are separate. It must preserve only
the granted music, proof records, and past sessions without allowing new Store,
booking, proof, version, comment, or collaboration activity. Do not enable
Disconnect until the data model, APIs, transaction, and fallback behavior
support this boundary.

### Session state and mutations

Document and implement the mappings above from current database values to Held,
Confirmed, Declined, Completed, and Cancelled, including the legacy
`pending_payment` exception. Use the approved entitlement reservation,
automatic/manual approval, cancellation snapshot, expiry, and atomic reschedule
rules. Participant storage and invitation delivery require their own end-to-end
contract before their UI appears.

### Artist notification model

Complete the notification design listed above before building its shell UI.
Destination features may emit events only after their exact standing routes and
authorization checks exist.

### Song acknowledgement

Define the source of `NEW` and an idempotent acknowledgement written when the
artist opens or explicitly plays the song. A connection-level timestamp is not
precise enough.

### Conditional product visibility

Unlisted direct-link behavior remains conditional on separate product
visibility and producer-authoring support. Until that exists, the Artist Store
must not display a fake visibility state or promise direct-link-only behavior.

## Implementation sequence

Implementation must use new active Linear issue coverage because SK-65 is
already Done. Before changing files under `apps/`, read the full issue, move it
to In Progress, and use Linear's exact branch name.

### Phase 0 — Issue and contract setup

- Create or select active Skitza v3 issue coverage for each implementation
  slice.
- Map each phase to its exact routes, data owner, files, acceptance criteria,
  and migration needs.
- Record the required technical decisions above.
- Resolve conflicts between a new issue, this plan, the PRD, and current code
  with Gili before implementing the disputed behavior.

### Phase 1 — Shared artist shell and studio context

- Implement the selected-studio persistence decision.
- Carry context across artist tabs and route transitions.
- Apply studio-specific deep-link selection.
- Replace mobile tabs with Home, Music, Sessions, Store.
- Update desktop sidebar and account footer.
- Build the approved mobile header.
- Remove the no-op artist search control.
- Implement standing-screen versus focused-process chrome rules.
- Preserve audio continuity.

### Phase 2 — Avatar, Settings, and notification foundations

- Build the approved avatar menu and dual-role switch.
- Restructure Settings around functional sections.
- Implement the saved global IANA timezone control required by Sessions.
- Remove unavailable placeholder rows.
- Implement read-only historical authorization before enabling Disconnect.
- Add the artist notification data model, read state, exact-link contract, and
  functional preference storage.
- Reuse the producer center's interaction pattern without reusing its
  producer-owned records.
- Render the notification center only when its item feed and destinations are
  functional.
- Keep switcher dots as a separate cross-studio signal.

### Phase 3 — Studio-scoped Home and Music

- Implement the approved workspace-scoped Home hierarchy.
- Remove duplicate multi-studio Home sections.
- Implement Music's selected-studio default and local All music view.
- Add explicit song open/play acknowledgement for `NEW`.
- Correct Home-to-Book context links.
- Preserve local view and back state.

### Phase 4 — Professional Store

- Replace decorative Store presentation with the approved professional catalog.
- Keep the selected studio as the sole Store context.
- Use one shared product-detail structure across pricing models.
- Strengthen and regression-test studio-scoped active-purchase blocking across
  every contact row bound to the same signed-in artist and producer.
- Add the minimal producer `bookingEnabled` control and snapshot
  `bookingEnabled`, finite bookable session count or unlimited-session state,
  and per-session duration on every new request.
- Add unlisted direct links only when the conditional visibility dependency is
  separately implemented.
- Remove legacy card-checkout and card-coming-soon presentation from the artist
  UI covered by this plan.
- Redirect legacy card-payment routes to the exact approved standing
  destination.

### Phase 5 — Compact proof-verification flow

- Rebuild instructions, upload, and verification as three compact states.
- End focused chrome after successful proof submission; render later proof
  status visits as standing detail.
- Use compact Bank/Bit disclosure.
- Keep history secondary and collapsed.
- Replace the upload form with the correct post-submit state.
- Add stable standing proof-record routes and authorized historical access.
- Make proof submission retry-safe and idempotent.
- Cover empty, attached, uploading, awaiting, rejected, verified, aggregate
  partial-purchase, and failure states.
- Preserve the off-app-money boundary in copy and behavior.

### Phase 6 — Real Sessions and short booking flow

- Make Sessions the standing tab destination.
- Replace mock session list/detail data.
- Remove the duplicate studio picker.
- Gate booking only with the explicit bookable-entitlement snapshot and legacy
  confirmed-booking exception.
- Add conditional package selection.
- Replace the stacked booking page with package → day → time → review.
- Use the approved duration and cancellation-policy snapshots with their
  legacy fallbacks.
- Implement exact automatic/manual approval language.
- Stop creating legacy `pending_payment` rows and complete their inventoried
  retirement before removing the legacy route.
- Implement real reschedule and cancellation behavior.
- Add participant handling only with real backend support.
- Hide calendar/reminder controls until functional.
- Emit session notifications only after their exact destination and artist
  authorization exist.

### Phase 7 — Integrated visual and behavior pass

- Remove remaining no-op and placeholder controls.
- Unify empty, loading, error, and retry behavior.
- Verify focused-process entry and exit behavior.
- Verify artist/producer shared primitives remain visually consistent.
- Verify studio isolation, role guards, and notification ownership.
- Verify no legacy card route or no-op control remains reachable.
- Run the full project verification workflow and browser-based visual QA.

## Verification

Before any implementation handoff or PR:

- use `$skitza-verify`;
- add focused regression tests for every behavior change;
- prove each new regression test fails before the fix when practical;
- report baseline failures without hiding them;
- visually verify true 360px and 390px phone layouts;
- verify desktop separately at `lg+`;
- check large text, dark mode, reduced motion, keyboard focus, and safe areas;
- confirm no horizontal overflow;
- confirm no full-page spinner replaces useful existing content;
- confirm audio does not restart during navigation;
- confirm each focused process has one primary action;
- confirm standing screens retain navigation;
- confirm payment/proof copy never implies Skitza handles money.

Use a fixture matrix that covers:

| Dimension         | Required fixtures                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Studio connection | 0, 1, and 2 active studios; selected studio disconnected; Past studio                                                                                        |
| Roles             | artist only; dual-role account with a remembered destination on each side                                                                                    |
| Purchase          | none; requested; approved; active in one studio; active independently in two studios; declined; complete                                                     |
| Proof             | no instructions; ready to upload; upload failure; awaiting; rejected with and without note; aggregate partial; verified                                      |
| Store             | flat, bundle, per-song; hidden hourly; small and multi-item catalogs; conditional unlisted item only when implemented                                        |
| Booking           | deliverable-only product; no entitlement; finite and unlimited entitlements; several entitlements; automatic approval; manual approval; declined replacement |
| Sessions          | future, held, confirmed, declined, completed, cancelled; legacy pending-payment; inside and outside cancellation window                                      |
| Timezone          | same artist/studio zone; different IANA zones; daylight-saving boundary; browser detection failure                                                           |
| Notifications     | none; one unread; several unread in one studio; unread across studios; invalid or unauthorized destination                                                   |

## Acceptance checklist

### Shell and context

- Four approved mobile tabs are present.
- Sessions replaces Book as the standing destination.
- Settings is reachable from the avatar menu.
- Studio context persists across visits and normal navigation.
- Deep links select the correct studio.
- Book has no studio picker.
- One-studio accounts do not show a fake switcher.
- Focused-process chrome appears only after a process starts.
- Product detail keeps standing chrome until **Request to book** is pressed.
- Switching roles restores the last valid destination for each role.
- A disconnected selected studio falls back deterministically.

### Home and Music

- Home is studio-scoped with one main action.
- Passive states are compact.
- Empty and duplicated sections are absent.
- Home priority is deterministic when several actions exist, including ties.
- The no-activity state uses the approved welcome card.
- Music defaults to the selected studio.
- All music is a combined newest-first list with studio labels.
- Playing from All music does not change studio context.
- Opening an item's full page does.
- `NEW` clears only after explicit open or play and remains cleared after
  refresh.

### Store

- Store reads as a professional studio catalog.
- No decorative cover bands, `Signature` tag, or oversized floating logo.
- Product information is clear and comparable.
- Browse cards and product detail follow the approved content order.
- Pricing models share one visual structure.
- Flat, bundle, and per-song are available; incomplete hourly and
  non-positive-price products are absent.
- No Store search/filter controls appear without a real need.
- Active purchase blocks only another purchase with the same studio.
- A request in one studio never blocks a request in another.
- Multiple contact rows for the same artist/studio cannot bypass the guard.
- Legacy card routes no longer expose checkout or “coming soon” card UI.

### Settings and account

- Avatar menu contains the approved items.
- Dual-role switching works.
- Settings is global.
- No fake payment-method or unavailable integration rows are shown.
- Disconnect explains consequences and preserves historical access.
- Past studios remain read-only and do not appear in the switcher.
- Past studios show only resources granted at disconnect; later versions and
  activity remain unavailable.
- Destructive account actions are never exposed before they work safely.

### Proof verification

- No in-app card-payment UI is present.
- Instructions, upload, and verification are separate states.
- Only instructions and a new upload use focused chrome; later status visits
  use standing chrome.
- Bank/Bit details do not create a long stack.
- Proof history is accessible but secondary.
- Awaiting state replaces the upload form.
- Rejection has one clear re-upload action.
- Aggregate partial-purchase progress shows the verified amount, remaining
  balance, and next real action.
- Upload retries do not create duplicate proof records.
- Verification status reflects the producer's action.

### Sessions and booking

- Sessions list and detail use real data.
- Booking asks only for decisions that are actually needed.
- Deliverable-only products never create a Book action or session credit.
- Unlimited-session packages remain bookable without being confused with
  booking-disabled products.
- One package is selected automatically.
- Multiple packages use a compact selection step.
- Mobile shows available days and times before the full calendar.
- Duration and cancellation policy use the approved snapshots and legacy
  fallbacks.
- Booking days and times use the saved artist timezone, submit UTC, and show
  Studio time when the zones differ.
- Automatic versus manual approval uses the approved language.
- Reschedule and cancellation are real and failure-safe.
- Held, Confirmed, terminal, cutoff, and Held-replacement actions match the
  approved matrix.
- A failed or declined reschedule leaves the original session unchanged.
- Cancellation is offered only inside the real policy window and never implies
  a refund.
- No new `pending_payment` booking or legacy checkout route is created.

### Notifications

- Artist bell opens a functional notification center on mobile and desktop.
- Badge count means unread items only.
- Notifications deep-link to exact items.
- Channel defaults follow the approved rules.
- Confirmed-session reminders are idempotent at the approved 24-hour and 1-hour
  thresholds.
- Push permission is not requested on first launch.
- Studio Switcher dots remain separate and clear only after the related item is
  opened.
- A studio row dot clears only after every dot-worthy item for that studio has
  been opened.
- Invalid or unauthorized destinations never produce a notification.

## Completion boundary

This plan is complete when the approved artist UI/UX is implemented, tested,
and visually verified across the named surfaces.

It does not authorize merging, production migration, or promotion to
`skitza.app`. Those retain their normal approval requirements.
