# Skitza — Product Requirements Document

**Version:** 5.2
**Date:** 12 August 2026
**Status:** Durable product source of truth

## 1. Authority and scope

This PRD incorporates Gili's approved Linear master plan, **Approved complete plan — Clients, Projects, Music, Store & Payments**, approved on 16 July 2026, and the approved **Manual sessions and Google Calendar sync** contract, finalized on 8 August 2026.

When sources conflict, use this order:

1. Gili's latest explicit decision.
2. The approved Manual sessions and Google Calendar sync contract for its scope.
3. The approved complete Linear master plan.
4. Current code.
5. This PRD.
6. Older plans and backlog behavior.

The approved plans replace older behavior for Clients, Projects, Music, Store, sessions, sharing, agreements, Payments, payment proofs, and downloads. For Calendar scope, the August contract supersedes older manual-session rules and artist Google Calendar connection plans.

For account access, Gili's 12 August 2026 decision supersedes every older
open-Producer-signup or self-service Create-a-studio rule. The implementation
contract is Linear SK-229 and
`docs/plans/active/2026-08-12-producer-invitation-access.md`.

It does not authorize a production reset, migration, merge, deployment, or promotion. Those actions require separate exact approval from Gili.

## 2. Product vision

Skitza is a SaaS product for solo music producers. One producer link lets artists listen, sign up, book, and pay externally while Skitza keeps the work, agreement, payment, and delivery history in one place.

The approved workflow is:

**Store product or private offer → project and purchase → exact agreement and payment plan → payment proof → active project → songs and sessions → exact-version artist approval → full payment → download → completion or cancellation**

For a true ₪0 private offer, acceptance makes the purchase fully paid and activates the project without a payment proof.

### Personas

**Producer:** an independent music producer managing clients, projects, songs, sessions, agreements, and external payments.

**Artist:** the producer's client, who signs in to review work, accept terms, upload payment proof, book sessions, approve exact versions, and download entitled files.

### Guiding principles

- One clear job per surface.
- Shared product rules, not parallel commercial paths.
- Immutable accepted terms.
- Stable ownership and strict producer/artist isolation.
- Smart defaults and simple choices.
- English-only for v1.
- Web-only for v1.
- No AI dependency.
- No custom domains; the producer's permanent acquisition link remains under Skitza.
- Mobile layouts must be complete at true 390px and 360px, with desktop behavior preserved.

### Account access and roles

- Clerk remains in Public mode so Artists can create accounts through a
  Producer's join link.
- Producer access is invitation-only. Gili sends a Clerk application
  invitation, and Skitza grants Producer membership only after the server
  verifies that the invitation was accepted by the matching Clerk user.
- Ordinary signup, a button click, a URL/query value, and client-writeable
  metadata never grant Producer access.
- Artist signup remains available only through a valid Producer join flow and
  creates Artist access, never a fallback Producer.
- Artist and Producer memberships are additive. An existing Artist who accepts
  a Producer invitation keeps all Artist relationships and can switch roles on
  the same Clerk account.
- An accepted invitation is a one-time authorization. Revoking that Clerk
  invitation later does not revoke an existing Producer membership; removing
  Producer access is a separate founder action.
- Clicking **Become a Producer** while uninvited only explains that an
  invitation is required; it makes no account change.
- A signed-in Clerk user with neither a valid Artist membership nor a verified
  Producer invitation has no Skitza application role.
- Production marketing and legal pages may become public only after these
  server-side gates are implemented and verified. Dashboard, onboarding,
  settings, projects, and Google Calendar connection remain membership
  protected.

## 3. Core product model

### 3.1 Client

A client is the producer's stable relationship with one artist.

- Projects and access use a stable client ID, not an email snapshot.
- Changing a contact email must not transfer ownership or break access to old work.
- Producer-side archive must not disconnect the artist.
- A producer can never change the client on an existing project.

### 3.2 Project

A project is the main container for one client's music work.

A project may contain:

- one song or an album;
- many song versions;
- many purchases, including several unpaid purchases;
- session allowance and individual bookings;
- agreements, payments, proofs, and comments.

A song is not a mini-project.

Project lifecycle states are:

- Waiting for payment;
- Active;
- Paused;
- Archived / Completed;
- Archived / Canceled.

Completed and Canceled are different states.

### 3.3 Song

A song is music inside exactly one project. It becomes durable only when its first Version upload
succeeds. A failed or canceled first upload must not leave an empty Song.

The app must never allow a song or audio version to exist without a project. A song has versions, comments, workflow state, artist approval, public-sharing state, portfolio state, and purchase-owned download entitlement.

### 3.4 Version

A version is exactly one uploaded audio file belonging to a song.

A producer may mark an exact version final or ready. The artist may separately approve that exact version. A producer may later permanently delete a Version or its entire Song after a strong warning.

### 3.5 Purchase

A Purchase, sometimes called an Order in engineering, is one accepted:

- Store purchase;
- private offer;
- session product;
- paid add-on;
- ₪0 No charge add-on.

A project may have several purchases, including several unpaid purchases at the same time. Only an exact accidental duplicate request or checkout is blocked.

Each purchase owns immutable commercial history:

- product or offer snapshot;
- subtotal, tax, total, currency, and price breakdown;
- exact agreement and acceptance record;
- selected payment plan;
- installment schedule;
- payment and proof history;
- corrections, waivers, overpayment, and cancellation history;
- paid amount and remaining balance;
- included song spaces or session allowance;
- download entitlement and override history.

A later purchase must never overwrite an earlier purchase.

### 3.6 Store product

A Store product is a reusable template shown only inside the signed-in artist Store.

Editing changes future purchases only. It never changes an old price, agreement, schedule, tax record, or entitlement.

### 3.7 Private offer

A private offer is a one-recipient deal. It may contain:

- a positive cash price;
- royalty or master terms;
- both cash and a split;
- a true ₪0 or royalty-only deal.

Only the account whose verified email matches the invited address may view and act on it.

### 3.8 Session allowance

A session purchase owns one allowance with either:

- a fixed limit; or
- Unlimited sessions.

Each use is tracked separately. A session purchase must not depend on one booking ID.

## 4. Unified purchase and project workflow

All Store products, private offers, session products, paid extra songs, and no-charge extra songs use the same commercial model.

1. The signed-in artist chooses a product or opens a private offer.
2. Start a new project is the default.
3. Add to existing project is a deliberate same-client choice.
4. Reopening an archived project may be offered when allowed; new work still receives a new purchase.
5. Existing-project choices show project name, date, songs, and balance.
6. Before acceptance, the producer may correct the purchase target within the same client.
7. The artist chooses only a payment plan enabled by the producer.
8. The app shows the final agreement with exact quantity, prices, discount, tax, total, schedule, rights, royalties, and revision rule.
9. The artist accepts the exact agreement and selected plan together.
10. For a paid purchase, the artist follows the producer's external payment instructions and uploads proof.
11. The project remains Waiting for payment until the complete required first installment is confirmed.
12. A partial first installment is recorded, but the project remains Waiting for payment.
13. Confirmation activates the project, purchased song spaces, and eligible session booking.
14. A true ₪0 purchase becomes fully paid and active at acceptance.

Skitza records off-app money. It does not take, hold, route, split, or process card payments.

## 5. Clients

### 5.1 Edit

Expose Edit on both the client list row and client detail page.

Editable fields:

- Name
- Email
- Phone
- Private producer notes
- Tags

Block duplicate client email addresses for the same producer.

### 5.2 Archive and restore

A client cannot be archived while they have an Active or Waiting-for-payment project. Active work must first be completed or canceled.

Archiving:

- removes the client from the active list;
- places the client under Clients → Archived;
- does not disconnect the artist;
- does not remove artist access;
- does not archive projects or songs;
- does not change public song links;
- does not erase purchases, offers, agreements, payments, proofs, sessions, versions, or comments.

Archived clients can be restored.

### 5.3 Permanent deletion

Permanently delete only an empty draft client with no project, purchase, offer, agreement, payment, proof, song, session, or other history.

The server and database must prevent hard deletion of a historical client.

### 5.4 Client UX and money

- Put Edit and Archive on rows and detail pages.
- Make Find client fast and obvious.
- Show Active and Archived filters clearly.
- Never combine currencies.
- Show all purchases, payments, and proofs grouped by project.
- Do not hide every common action in a three-dot menu.

## 6. Projects

### 6.1 Creation and ownership

New paid work creates a new project by default. The producer may deliberately add a purchase to an existing project for the same client.

The client on a project can never change.

If the wrong client was chosen:

- empty project: delete it and create it again;
- project with history: cancel it and create a new project.

Before artist acceptance, the producer may correct which same-client project a purchase or offer targets. After acceptance, proof submission, or payment, the target is locked. A wrong accepted target must be canceled and recreated. Money never moves automatically.

### 6.2 Edit

Expose Edit on project rows and project pages.

Editable fields:

- Project name
- Deadline
- Workflow stage

Accepted commercial terms are not normal project-edit fields.

### 6.3 Default names

Do not force the artist to invent a name before work exists.

Examples:

- Mixing · 16 Jul 2026
- Production · 16 Jul 2026
- Untitled · 16 Jul 2026
- Song 1, Song 2, Song 3 for a multi-song purchase

Names remain editable. Add a number when the same generated name already exists on that date.

### 6.4 Singles, albums, and paid song spaces

- A project with one song behaves like a single.
- Add Another Song changes it into an album.
- A purchase may grant commercial song capacity or be linked to a Project or Song, but accepting a
  purchase does not create a Song record.
- Paid Projects remain visible before audio exists. Unused commercial capacity is not an empty Song
  and does not appear as a Library row.
- A later extra song uses a separate purchase.
- A paid extra song becomes available only after its complete first installment is confirmed.
- A free extra song receives a ₪0 No charge purchase.

### 6.5 Lifecycle

There is no separate Archive project action.

**Complete → Archived / Completed**

- Work is finished.
- Unpaid balances remain due.
- Purchase and installment history remains.
- Songs remain playable.
- Old comments remain readable.
- New comments and uploads stop until reopen.
- Public links remain live until disabled.
- Unused session allowance closes without warning.
- Reopen does not restore closed allowance.

**Cancel → Archived / Canceled**

- Work stops.
- Future installments are canceled.
- Amounts already due or overdue remain owed unless explicitly waived.
- Paid money remains in history.
- No automatic refund or credit occurs.
- Existing comments remain readable; new comments/uploads stop.
- Listening remains available.
- Public links remain live until disabled.
- One purchase may be canceled without canceling the project.

**Reopen → Active**

- Old payments and accepted agreements remain unchanged.
- Canceled purchases and schedules do not return.
- Closed session allowance does not return.
- New work requires a new purchase or private offer.
- New comments and uploads become available again.

### 6.6 Permanent deletion

Permanently delete only an empty draft project with no purchase, agreement, payment, proof, song space, version, comment, session, or public-link history.

Never hard-delete a historical project or orphan its records.

### 6.7 Producer project workspace

- `/dashboard/clients-projects/[id]` is the compact producer project workspace for both one-song and multi-song projects: project header, Songs, Payments, Studio Log, and Details.
- Do not render a second song workspace, workflow, status strip, version list, or song tabs below the project song list.
- Song rows open the existing producer player page at `/dashboard/music/[versionId]`.
- Old nested project-song URLs remain only as compatibility redirects to the existing player page, or back to the project when no player version exists.
- The project header `+` opens file-first Add Song directly with the Project already selected. Do not
  show an intermediate menu when Add Song is the only action.

## 7. Songs, versions, Library, and Artist Music

### 7.1 File-first upload and Song creation

- Library uses **Upload audio**. The producer chooses or drops the file before the app asks whether
  it is a New Song or New Version and before it asks for any missing destination details.
- Project uses **Add Song** with the Project already selected.
- Song uses **Upload new Version** with the Project and Song already selected.
- Choosing or dropping a supported audio file starts a temporary, producer-scoped storage transfer
  immediately while the producer completes the destination and metadata. This temporary upload is
  not a Song or Version. Cancel, replace, failure, expiry, and retry must clean or reconcile the
  exact staged object without exposing durable music records.
- A new Song and V1 are created together only after the exact uploaded audio object succeeds and is
  verified. Cancellation, failure, and retry must never expose an empty or ghost Song.
- A later Version is also created only when the producer explicitly finalizes the staged upload; it
  must not require an empty Version placeholder while bytes transfer.
- After a successful first or later Version upload, the producer opens that exact new Version.
  Deliberately opened playable historical Version URLs continue to open the requested Version;
  newest-by-default behavior applies to Song entry points, not to exact Version deep links.
- A purchase may remain linked internally for commercial/download entitlement, but the producer is
  never required to start from a purchase to add a Song.
- Every successful Version is automatically available to the linked artist through existing access
  guards. There is no manual Share step, private Draft Version, or separate publish action.
- Stems remain links. Stem upload and storage are outside this flow.

Do not expose Move to another project as a normal edit.

### 7.2 Song and version actions

Expose on Library rows and song pages:

- Rename song
- Edit artist credit
- Archive song
- Restore song

New versions default to V1, V2, V3, and so on. A producer can rename a version independently.

All Add Song, upload, row, and empty-state actions must work.

### 7.3 Final versions and artist approval

- Producer final/ready state and artist approval are different.
- Artist approval belongs to one exact version.
- Existing producer-set approvals become Marked final by producer only.
- Existing producer-set approvals must never become artist approval or trigger payment.
- For one-song 50/50, the final 50% becomes due after the artist approves the exact ready final version.
- For multi-song 50/50, every included song must have an exact ready final version and every exact version must be approved.
- Artist approval locks new uploads for that song.
- Reopen song keeps approval history, unlocks new work, and requires approval of the corrected final version.

### 7.4 Permanent Version and Song deletion

Released remains a separate, producer-confirmed per-song state, but deletion is not gated by Released. After a strong warning, the producer may delete approved, producer-final, newest, only, public, or unreleased audio.

**Delete Version:**

- is available from that Version's three-dot menu;
- permanently removes that Version's real R2 audio object, comments, approval, notifications, download overrides, historical artist access, and public history;
- removes any portfolio entry using that exact audio instead of retargeting it;
- keeps the Song, Project, client, purchase, agreement, payments, and bookings;
- is replaced by **Delete Song** when it is the only Version.

**Delete Song:**

- is available from the Song artwork/card three-dot menu and the main Song-page menu;
- permanently removes the Song, every Version and audio object, comments, approvals, notifications, download overrides, portfolio entry, public link, and Song/Version history;
- keeps the Project even when it becomes empty;
- keeps the client, purchase, agreement, payments, and bookings, removing only the booking's Song link.

Deletion has no trash, undo, bulk action, or artist email in beta. It must revoke playback before storage reconciliation, delete only exact producer-owned R2 identities, retain retry state across partial failure, and remove database history only after every target audio object is authoritatively absent.

### 7.5 Song archive

Song archive:

- removes it from active Library;
- places it under Library → Archived Songs;
- allows restore;
- keeps artist listening and public link available;
- blocks new uploads and comments until restore.

Client/project archive never archives songs.

### 7.6 Artist Music

Artist Music stays simple and is not a producer-style project room.

- Artist Music and producer Library are Song-first. Project is a filter, not a required
  Project → Song drill-down.
- Waiting-for-payment projects stay in Payments and do not appear as active work.
- Purchases and unused paid capacity do not appear as empty Songs.
- The Library stays visually simple: do not crowd Song rows or Version history with purchase or
  Project metadata beyond what the current design already needs.
- The Song list includes every Song the artist may hear, including archived work.
- Listening and commenting happen on private song pages.
- Completed/Canceled projects allow listening but block new comments/uploads until reopen.
- Archived songs allow listening but block new comments/uploads until restore.
- Paused projects keep listening and comments available.

## 8. Store, private offers, and invitations

### 8.1 Store visibility

- Store products appear only after artist sign-in.
- Public producer portfolio never shows Store products or prices.
- Public song sharing remains separate.

### 8.2 Product pricing and song spaces

- Every purchased song has a price.
- Artist may change song quantity before acceptance.
- Keep volume discounts.
- Save quantity, unit prices, discount, subtotal, tax, and final total.
- A multi-song purchase records that quantity in its immutable commercial snapshot; it does not
  create Song records before audio is uploaded.
- Later extra songs are a new purchase.

### 8.3 Product editor

- A normal published Store product requires a positive cash price.
- Positive-price products may include royalty terms.
- ₪0 and royalty-only deals use private offers.
- A product may offer a fixed session limit or Unlimited.
- Unlimited revisions remain supported and must appear in the accepted agreement.
- Tagline is editable.
- Capture every immutable snapshot field.
- Preview the exact real artist card and detail page before publishing.
- Permanently delete a product only when it has no purchase history.
- A product with history can only be archived.
- Editing affects future purchases only.
- Remove Store table view and unrelated unfinished controls.
- Every remaining editor action must work.

### 8.4 Private offers

Producer can Send custom offer from a client page or Store manager.

The producer sets:

- recipient email;
- new or existing same-client project target;
- service and deliverables;
- included song spaces or session allowance;
- cash price, including zero;
- currency and tax treatment;
- royalty or master terms;
- enabled payment plans;
- rights and revision rule;
- exact agreement;
- expiry, default 14 days.

Email is notification only. The offer is viewed and handled inside the signed-in app.

Only the verified invited email may view or act. New recipients use artist/client verification and create a draft client.

Offers appear in Artist Home, Store → Offers for you, and a private detail page.

Expired offers disappear for the artist and remain in producer history.

After acceptance, product/offer snapshot, project, price, currency, tax, rights, royalties, revisions, payment plan, schedule, and agreement are locked.

### 8.5 True ₪0 or royalty-only offer

- Artist accepts exact rights and royalty terms.
- No payment plan or proof is required.
- Purchase is fully paid immediately.
- Project activates at acceptance.
- Stored audio downloads owned by that purchase are unlocked.
- Accepted terms remain in history.

Royalty accounting, collection, reporting, and payout are outside scope.

### 8.6 Normal invitation

Normal Invite client remains separate from private offers. Fix its route. Do not replace it with the offer flow.

## 9. Sessions

A session is a real booking tied to one client, one project, and that project's purchase-owned bookable entitlement. Sessions never float outside a project.

### 9.1 Artist booking and allowance

- A purchase snapshots whether booking is enabled, fixed or Unlimited allowance, duration, buffer, and lead time. Each booking separately snapshots the producer's cancellation policy. Later product or policy edits do not rewrite an existing entitlement or booking.
- Paid booking opens after the required first installment is confirmed. A true free offer opens after acceptance. A paused project blocks new artist booking.
- Every booking use is separate. Automatic confirmation confirms an eligible artist-selected time when enabled; otherwise the time is held for producer approval.
- Rescheduling transfers the original allowance treatment and never consumes a second use.
- An allowed future cancellation or producer cancellation restores one consumed included use exactly once. Late cancellation and no-show consume it; completed sessions never restore it.
- Project completion closes unused allowance. Reopening the project does not restore it.
- The artist may request cancellation or rescheduling. The producer decides the request under the booking's snapshotted cancellation policy.

### 9.2 Producer-created manual session

- The producer selects an existing client and one of that client's existing projects. The project must have a real bookable product and usable duration snapshot; the form cannot create a client, project, product, or floating session.
- The form asks for client, project, date, start time, billing treatment, and an editable title that defaults from the project or product. Artist identity, product, duration, entitlement, and ownership are derived and validated on the server.
- Duration is fixed by the product entitlement. There are no manual location, note, participant, recurrence, or Google Meet fields.
- Creation immediately confirms the session, shows it in the producer Calendar and authorized artist Sessions, notifies the artist, and sends one recoverable calendar invitation.
- When an included use remains, `included` is the default and `complimentary` is the only override. When none remains, the producer must choose `complimentary` or `billable_extra`. Only `included` consumes allowance; `billable_extra` records payment due but does not create an invoice or charge.
- The manual-booking and reschedule pickers expose only 15-minute starts where the full product-derived duration fits inside working hours without a blackout, lead-time failure, daily-limit conflict, active Skitza session, required buffer, or fresh Google busy interval. Date, time, client, and project choices use the same availability model on desktop and mobile.
- Another active Skitza session, lead-time failure, or fresh Google busy interval is a hard conflict. Working-hours, blackout, buffer, and daily-limit conflicts remain explicit producer warnings for stale/race/direct-command rechecks. If Google is disconnected, stale, or unavailable, Skitza fails open to Skitza-only availability and requires a reduced-protection warning before saving.

### 9.3 Timezone display

- Availability is authored in the producer's saved IANA studio timezone and stored/submitted as UTC instants.
- Artist-facing dates, day grouping, `Today`, and time controls use the artist's saved IANA timezone.
- When the artist and studio timezones differ, Review and Session detail show artist time first and a secondary `Studio time` line. Offsets are derived for the appointment date, including daylight-saving transitions.

### 9.4 Producer Google Calendar add-on

- Skitza remains the booking source of truth. Only the producer connects Google; the artist receives an attendee invitation or `.ics` fallback and does not connect a Google account.
- The producer chooses one writable destination calendar for Skitza events and one or more calendars whose busy intervals block artist availability. Recurring and all-day busy intervals block; events marked free do not. Skitza never stores or displays unrelated event details.
- Healthy Google busy intervals appear in the producer Calendar only as privacy-safe blocked time bands. Days with no free working-time quarter are visibly unavailable; no title, attendee, location, calendar name, or other provider event data is displayed or stored.
- Confirmed sessions create linked events containing only the approved title, time, Producer and Artist attendees, artist-safe Skitza link, and private linkage metadata. Pending approval or payment creates a private opaque hold without attendees; confirmation promotes the same event, while rejection or expiry removes it. First connection creates events only for future confirmed sessions.
- Linked title, date, and start time sync both ways. Duration remains product-derived: resizing is corrected, a deliberate Google move outside normal availability or over unrelated busy time is accepted, and a move that overlaps another active Skitza session is rejected and restored.
- Cancelling in Skitza cancels or removes the linked Google event and notifies the artist.
- Deleting a linked Google event never cancels Skitza. It creates a missing-event state with Restore event and Cancel session choices.
- The booked artist's RSVP is shown in producer and artist session views without changing booking status. Existing Google-only guests on a linked event may be read temporarily so an update can preserve them, but they remain only in Google and are never imported into Skitza.
- Google failure, disconnection, stale data, or renewed-permission needs never roll back or close Skitza booking. Skitza marks the session Not synced, retries, and uses one idempotent `.ics` invitation fallback when needed.
- Disconnecting leaves existing Google events in place. Same-account reconnect reuses links without duplicates; connecting a different Google account is an explicit switch and never reuses the old account's event IDs. Concurrent Skitza and Google edits resolve in favor of Skitza, and healthy sync normally converges within one minute.
- Connection controls remain hidden until connect, calendar selection, delivery, failure recovery, reconnect, and disconnect work end to end.

## 10. Agreements, tax, and immutable snapshots

The only payment plans are:

- Full
- 50/50
- Monthly

Milestone plans do not exist.

The artist chooses an enabled plan and accepts it together with the final agreement.

Every accepted purchase saves relevant:

- product or offer name and tagline;
- service and deliverables;
- song quantity and unit prices;
- volume discount and subtotal;
- currency;
- tax type, rate, and final total;
- song spaces;
- session limit or Unlimited rule;
- session duration, location, buffer, and lead time;
- revision rule, including Unlimited;
- royalty/master terms and rights;
- selected plan;
- installment amounts and dates/triggers;
- exact agreement text.

Tax choices are:

- No tax
- Tax included
- Tax added

Monthly dates are based on the first confirmed payment date and stay fixed. For 50/50, the agreement records the exact artist-approval trigger.

Acceptance saves the exact content, verified accepting account/client, time, purchase, project, plan, and commercial snapshot.

A changeable external contract link is not an immutable agreement. Skitza must store the exact accepted terms.

## 11. Payments

### 11.1 External payments only

Remove:

- Stripe checkout and Connect requirements;
- per-song direct Stripe;
- Stripe schedules and saved charges;
- Tranzila;
- replacement direct-card flows;
- dead Invoice actions.

Official tax invoices and invoice uploads are outside scope.

### 11.2 Waiting for first payment

After an approved request or accepted offer:

- create or keep the project and purchase references;
- show Waiting for payment to producer;
- show the purchase under Artist Payments;
- keep it out of active Artist Music;
- send proof to Payments → Needs review, never Requests.

A partial first installment does not activate the project. A later downward correction does not deactivate a project that already activated.

### 11.3 Payment locations

**Project page:** every purchase, agreement, installment, payment, correction, proof, waiver, cancellation, and download override for that project.

**Client page:** all purchases, payments, and proofs grouped by project.

**Producer Payments:**

- Needs review
- Due and overdue
- Upcoming
- History

**Dashboard / Home:** separate actions for purchase approval, proof review/overdue money, and sessions.

Requests is for new work. Proof review belongs in Payments.

### 11.4 Ledger structure

Group money by project, then purchase.

Show Due now and Total remaining separately for every currency. Never combine USD, EUR, GBP, ILS, or any other currencies.

Use Active and History. Fully paid and canceled purchases move to History without hiding agreements, proofs, corrections, or amounts.

Each purchase shows:

- product/offer;
- frozen subtotal, tax, total, and currency;
- agreement and acceptance date;
- plan and schedule;
- paid and remaining amounts;
- next amount/date/trigger;
- current producer payment instructions;
- proof history/status;
- Pay next payment;
- cancellation, waiver, correction, and override history.

Old unpaid purchases use current payment instructions while their accepted terms remain unchanged.

Archived projects never hide unpaid balances.

### 11.5 Payment plans

**Full**

- 100% is the required first installment.
- Work activates after the complete amount is confirmed.
- Full payment unlocks downloads.

**50/50**

- Complete first 50% is required before activation.
- Final 50% is due only after exact artist approval of every required ready version.
- Producer final state is not artist approval.
- Downloads remain locked until fully paid unless an explicit version override is active.

**Monthly**

- Producer chooses installment count.
- Complete first installment is required before activation.
- Later installments use the same calendar day as the first confirmed payment.
- If absent in a month, use that month's last day.
- Dates do not change based on delivery.
- Downloads remain locked until fully paid unless overridden.

### 11.6 Proofs

Every installment has private proof history linked to the correct client, project, purchase, and installment.

Only artist and producer can view proof files. Use private storage and short-lived authorized viewing.

Installment/payment states include:

- Not paid
- Awaiting review
- Partially paid
- Confirmed
- Overdue
- Waived
- Canceled

Proof evidence states include:

- Awaiting review
- Confirmed
- Rejected

A rejected proof stays in history, shows the reason, and permits replacement.

Artist records the real represented amount. Producer may accept or decline a partial amount.

Confirmation creates one immutable payment record. Rejecting/replacing never rewrites history.

### 11.7 Partial, extra, and manual payments

- Accepted partial payment saves the real amount and leaves the rest due.
- Confirmed money stays inside the same purchase.
- Overpayment marks that purchase Overpaid.
- Excess never moves automatically.
- Return/correction is recorded on the same purchase.
- Producer may record external cash/manual payment with amount, date, and optional private proof.

### 11.8 Corrections and waivers

Never silently edit/delete confirmed history.

A correction records old amount, new amount, reason, actor, and time.

Reducing confirmed payment:

- does not deactivate an active project;
- relocks downloads if no longer fully paid.

Waiving debt:

- is explicit and audited;
- removes debt from amount owed;
- is not payment;
- does not unlock downloads.

### 11.9 Late payments and reminders

When late:

- mark Overdue;
- keep listening/comments;
- keep downloads locked;
- allow manual pause;
- block new session booking while paused;
- never delete, complete, cancel, or archive automatically.

Automatic reminders default on and may be disabled globally or per payment.

Schedule:

- 3 days before due;
- due date;
- 3 days late;
- weekly until paid, waived, or canceled.

Manual Send reminder may remain only when it sends and logs.

## 12. Downloads and extra deliverables

Download authorization is purchase- and version-aware.

When a purchase is fully paid:

- every still-stored audio version owned by that purchase becomes downloadable;
- old drafts are included;
- later unpaid work in the same project does not relock those versions.

A ₪0 purchase is fully paid immediately. Deleted audio is never playable/downloadable.

Before full payment, producer may Allow download now for one selected song version.

The override:

- warns with unpaid amount;
- unlocks only the selected version;
- keeps debt owed;
- records enable/disable actor and time;
- may be disabled until full payment;
- keeps full history.

Canceling or waiving money is separate from download access.

Stems and extra deliverables use Google Drive links only. Show them only after the related purchase is fully paid. Early audio override does not reveal them.

Artist downloads use a separate authorized route checking exact purchase, version, full-payment state, and active override.

## 13. Public song links and portfolio

### 13.1 Public song link

There is one public link per song.

Producer alone controls publishing, copying, resetting, and disabling. Artist may copy an already-live link only.

Reset invalidates the old page URL immediately and creates a new URL.

Newest available version opens first. Visitors may switch between available stored versions.

For a published song, new versions appear publicly after a producer warning. Deleted audio disappears.

Completed/Canceled project and song archive do not disable a link.

The link stops only when producer disables it or last stored audio is deleted.

Public pages:

- are noindex;
- allow guest listening without an account;
- do not allow guest comments;
- never show Download;
- never show private comments;
- carry Skitza and producer branding;
- never show Store products/prices.

Do not restore magic-link sharing or Project Share.

### 13.2 Portfolio

- Only producer-marked-public songs appear.
- Private/disabled songs never appear.
- Portfolio plays newest available audio.
- Portfolio has no version switcher.
- New versions become portfolio playback after warning.
- Completed/Canceled project and song archive do not remove a public song.
- Deleting a Version removes any portfolio entry using that exact audio; it does not retarget the entry.
- Deleting a Song removes its portfolio entry.
- Portfolio follows song/audio state and never serves stale copied audio.

## 14. Audio and file protection

- Do not expose permanent public storage URLs for private or publicly shared music.
- Listening uses protected streaming or short-lived delivery.
- Artist downloads use a separate authorized route.
- Public pages never receive download permission.
- Reset/disable stops access through that page URL.
- Deleting audio removes the real storage object.

No browser can completely prevent recording playable audio. The goal is to block normal download and permanent direct-file access.

Audio formats remain WAV, FLAC, MP3, and AAC, with a 100 MB per-file limit. Version comments remain timestamped and private to artist/producer.

### 14.1 Beta producer audio storage

- The beta limit is 1 GB (1,000,000,000 bytes) of audio per producer.
- Warn at 800 MB (800,000,000 bytes).
- Every separately uploaded completed Version counts once. Active upload reservations also hold capacity so concurrent uploads cannot pass the limit.
- Portfolio references to the same audio do not count again. Artwork, payment proofs, documents, and generated waveform data do not count.
- Block an upload before it starts when the selected file would exceed 100 MB or the producer total would exceed 1 GB. Landing exactly on either limit is allowed.
- A producer already at or above the limit may still play, download, and delete existing work, but may not upload more.
- Settings and the upload flow show real usage. Beta full-storage copy tells the producer to delete an old Version or Song; it does not mention upgrading.
- Archive does not free storage. Only confirmed R2 deletion frees storage.
- This is one global beta policy with no per-producer override and can change when paid plans launch.

## 15. Navigation, archives, and action surfaces

### Artist mobile

- Home
- Music
- Sessions
- Store
- Payments

Settings stays in profile. Artist desktop/main navigation also includes Payments.

### Producer mobile

- Today
- Clients
- Music
- Calendar
- Payments

Store and Settings stay in profile.

### Producer desktop

Keep Store and add global Payments.

### Archive locations

Producer:

- Clients → Archived
- Projects → Archived with Completed/Canceled labels
- Library → Archived Songs

Artist:

- Music is Song-first with Project as a filter
- The Song list includes every song the artist may hear
- Payments → History contains paid and canceled purchases

Projects are reopened. Songs and clients are restored. Client/project archive never archives songs.

### Visible-control rules

Make every remaining button, link, tab, menu, row action, empty-state action, filter, and warning work, or remove it.

Remove without replacement:

- Favorites
- fake play counts and sorting
- Project Share
- Store table view
- unrelated Coming soon controls
- Invoice
- card checkout controls
- automatic project archive controls
- artist public-sharing permission controls

Keep and make real:

- Library Upload audio
- producer New session and artist cancellation/reschedule request actions
- producer decisions for artist cancellation/reschedule requests
- automatic session confirmation according to setting
- normal Invite client and its route
- Store editor actions
- logged manual Send reminder

## 16. Existing data and reset decision

There are no real users. Current commercial, project, payment, proof, and Milestone data is mock data.

Therefore:

- remove Milestone plans completely;
- do not grandfather Milestone products/requests;
- remove Stripe, schedules, Tranzila, and other card paths;
- reset mock project and commercial history instead of legacy backfill;
- do not create synthetic purchases;
- do not infer Completed/Canceled states for old mock archived projects;
- do not migrate mock invoices/payments into the new ledger.

The reset inventory must include dependent mock records and storage objects so no broken references or orphaned files remain.

Do not reset producer accounts, settings, clients, or unrelated data unless a separately approved inventory names them.

Before any production reset:

- prepare dry-run counts;
- verify again that there are no real users or external payments;
- verify no live card schedules/charges;
- stop if false;
- test on a non-production database;
- never print credentials or database URLs.

This PRD does not authorize running a reset or migration.

## 17. Durable engineering boundaries

- Fetch server data through the established tRPC server caller pattern.
- Scope every producer query by producer identity and preserve producer/artist guards.
- New business rules belong in focused domain services with focused tests.
- Routers, server actions, cron routes, and React components stay limited to authentication, validation, authorization, orchestration, and response mapping.
- When replacing old business logic, migrate only that responsibility and remove the replaced path after all callers use the domain service.
- Preserve security and behavior tests for approved behavior.
- Replace tests that enforce removed behavior.
- Add focused regression and concurrency tests.
- Use private R2 presigned upload/delivery patterns.
- Use the approved migration runner and never migrate/reset production without exact approval.

## 18. Unchanged platform decisions

- Framework: Next.js App Router, React, tRPC, Drizzle, Neon, Clerk, Tailwind, Vitest.
- Storage: Cloudflare R2.
- Email: Resend + React Email.
- English-only v1; no IP locale detection.
- Web-only; no native iOS/Android app.
- No AI/LLM requirement.
- No custom domains.
- No Framer Motion or new animation library.
- No Tauri, Documenso/PDF signing, waitlist, or removed magic-link share flow.
- The public producer acquisition route remains under Skitza.

## 19. Explicit non-goals

- In-app card processing or a replacement processor.
- Holding, routing, or splitting money.
- Automatic financial refunds or account credits.
- Official tax invoice generation/upload.
- Royalty calculation, statements, collection, or payout.
- Guest comments or public downloads.
- Producer-style project management for artists.
- Store products/prices on public portfolio or before sign-in.
- Artist Google OAuth, Google Appointment Schedule, or any second artist booking entry point.
- Importing ordinary external-calendar events as Skitza sessions, clients, or projects.
- Outlook, Apple Calendar, generic CalDAV, or other calendar providers in this scope.
- Creating a client, project, or product from the producer manual-session form, or adding manual location, notes, participants, recurrence, or Google Meet.
- Letting Google resize product-derived duration or syncing Google-only guests into Skitza.
- Automatic invoice creation, charge, refund, or payment movement for a manual session.
- Normal song moves across projects with financial history.
- Permanent deletion of historical clients, projects, purchases, agreements, payments, or proofs.
- Restoring magic-link sharing or Project Share.
- Requiring Spotify/Apple Music links before Released-audio deletion.
- Complete prevention of technical audio recording.
- Legacy commercial backfill, synthetic purchases, Milestone grandfathering, or old archive classification.
- Production reset/migration, merge, deployment, or promotion without separate exact approval.
