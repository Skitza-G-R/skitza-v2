# Bring in Active Work — Audited Product and UX Plan

- **Original date:** 2026-08-17
- **Audit date:** 2026-08-17
- **Decision owner:** Gili Asraf
- **Status:** Audited draft. Current product and repository facts are verified;
  the remaining product choice is isolated in Section 13. No implementation has
  started.
- **Verified development baseline:** fetched `origin/v3-clean` at
  `06e7427b877301e1a50e181f00453adf7fdc7cbc`
- **PRD:** `docs/product/PRD.md`, version 5.2 dated 2026-08-13
- **Linear:** [SK-255 — Bring existing clients and active work into Skitza](https://linear.app/raz-stamper/issue/SK-255/bring-existing-clients-and-active-work-into-skitza),
  Backlog. This is the durable implementation source of truth.
- **Primary surface:** `/dashboard/clients-projects`
- **Working feature name:** **Bring in active work**

## 1. Audit verdict

The original draft was not safe to implement. It mixed the current v3 model
with older Project-level money, payment, and invitation behavior. This version
keeps the intended producer experience while removing those old assumptions.

The most important correction is:

```text
Client
└── Project
    ├── Song
    └── Purchase
        ├── frozen commercial snapshot
        ├── agreement provenance or acceptance
        ├── Installments
        └── Payments
```

An imported existing agreement must become a first-class **Purchase** inside a
Project. Price, tax, agreement, plan, schedule, and payment history do not
belong directly on the Project.

### 1.1 Drift removed from the original draft

| Original draft claim                                                            | Verified truth on `origin/v3-clean`                                                                                                       | Audit action                                                                                                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The commercial record is effectively part of a Project                          | A Project can contain many Purchases; each Purchase owns its frozen commercial and payment state                                          | Replaced every Project-level money assumption with Project → Purchase                                                                                       |
| Supported plans include Milestones                                              | The only plans are Full, 50/50, and Monthly; the PRD explicitly says Milestone plans do not exist                                         | Removed Milestones from scope, fields, mockups, validation, and acceptance                                                                                  |
| The final 50% may be due “On delivery”                                          | The final 50% is due only after the Artist approves every required ready Version                                                          | Removed “On delivery”; historical terms that do not match current triggers cannot be approximated                                                           |
| Imported payments must never exceed the agreed total                            | The ledger supports Overpaid; excess stays inside the same Purchase                                                                       | Replaced rejection with an Overpaid warning and current ledger behavior                                                                                     |
| One lump payment can be allocated automatically across installments             | Every current payment belongs to exactly one installment                                                                                  | Removed automatic oldest-first allocation; a cross-installment amount must be split into separate payment records unless the model is deliberately extended |
| A historical payment date may be unknown                                        | `purchase_payments.paid_at` is required today                                                                                             | V1 requires the actual date; “date unknown” is not claimed as supported                                                                                     |
| Song quantity is needed only for per-song pricing                               | Every commercial snapshot carries `includedSongSpaces`                                                                                    | V1 captures or derives song capacity for every music Purchase while creating zero Song rows                                                                 |
| The manual New Project flow accepts a service, price, deposit, and product UUID | Current `project.create` accepts a stable client, title, and optional deadline only                                                       | Removed the obsolete modal and cross-producer product-UUID audit                                                                                            |
| The current invite UI points to a broken `/invite/...` route                    | The current invite URL is `/sign-up/join/<producer-slug>/home`                                                                            | Replaced the obsolete route analysis with the current verified-email join flow                                                                              |
| Join relies on unverified primary-email matching and a cross-producer webhook   | Join is producer-scoped and requires verified Clerk email hashes before stable ownership is assigned                                      | Removed the old identity claims                                                                                                                             |
| Skitza still has two competing purchase implementations                         | The canonical model is now `purchases`, `purchase_acceptances`, `purchase_installments`, and `purchase_payments`                          | The feature must extend the canonical model, not choose an old path                                                                                         |
| CSV import is a current durable PRD requirement                                 | PRD v5.2 and the approved Linear payment/client plan do not require CSV import                                                            | Removed spreadsheet import from v1                                                                                                                          |
| Skitza has no automatic payment-reminder rule                                   | The durable rule says reminders default on, although the automatic cron is not scheduled by the repository's current Vercel configuration | Marked this as a real product conflict because silent import must not contact a client                                                                      |

### 1.2 Implementation stop line

Do not begin implementation until:

1. Gili confirms the decisions in Section 13.
2. Those decisions and the retained feature contract are recorded in a Linear
   issue.
3. Any decision that changes a durable rule is also reflected in the PRD.

This stop line exists because current canonical Purchase creation and read
paths model an Artist acceptance, while the schema has no imported-existing-
work source. Code cannot honestly create this record today without either
impersonating the Artist or first adding an approved provenance model.

## 2. Sources and authority

This audit used, in order:

1. Gili's latest explicit decisions.
2. The approved Linear document
   [Approved complete plan — Clients, Projects, Music, Store & Payments](https://linear.app/raz-stamper/document/approved-complete-plan-clients-projects-music-store-and-payments-3ef9d974416c).
3. Completed issues `SK-89`, `SK-90`, `SK-91`, `SK-96`, and `SK-97`.
4. The fetched `origin/v3-clean` code at the exact commit in the header.
5. PRD v5.2.

The checked-out workspace is an older feature branch with unrelated local
changes, so it was not treated as the current product baseline.

The original draft described Section 4 as decisions made by Gili during a
grilling session. Those requirements are retained below as the **captured
feature contract**, but there is no recording or Linear issue attached to this
plan with which to independently prove that session. They must be copied into
and confirmed in the feature issue before coding.

External competitor research has been removed from the governing plan. It may
inspire later design work, but it cannot define Skitza's data model or override
the PRD, Linear, or current code.

## 3. Outcome

Give a producer a fast, quiet way to bring approximately ten existing clients
and their active work into Skitza without repeating the normal one-client and
one-project flow and without contacting anyone by accident.

For each row, the producer can:

- select or create one Client;
- create one Project for that client;
- record one existing outside agreement as one imported Purchase;
- freeze the exact commercial snapshot;
- record the supported payment plan and schedule;
- record historical manual payments against their installments; and
- leave the Client unconnected until the producer intentionally shares access.

Valid rows can be created together. Incomplete or unsupported rows remain
drafts with an exact explanation. One bad row never rolls back a valid row.

No Songs or files are created during import. Songs remain children of the
Project and are created and named through the normal first-upload flow.

If the Artist later joins with a verified matching email, the account binds to
the existing stable Client record. The imported Purchase must then appear in
the normal purchase ledger and obey the normal payment, project-access, and
download rules. It must never ask the Artist to buy the same work again.

## 4. Captured feature contract

The following requirements are carried forward because the original plan
records them as Gili's decisions. They are not descriptions of current
implementation:

- The target scenario is roughly ten clients with one active Project each.
- The experience must work efficiently for one row or ten rows.
- A Project remains above its Songs. An album with five Songs is one Project,
  not five Projects.
- Files are not uploaded and Song rows are not created during this setup.
- The producer records the exact price already agreed with the client.
- That frozen agreed price cannot be silently changed mid-project.
- The payment plan, payment progress, and due information are part of setup.
- Historical outside payments may be recorded by the producer.
- Producer-entered money is visibly attributed as **Confirmed by producer**.
- Imported outside terms are visibly attributed as **By producer** and never
  presented as an Artist signature or Artist acceptance.
- Private payment proof is optional.
- Creating Clients, Projects, and Purchases contacts nobody.
- Inviting Clients is a separate optional action that may happen later.
- The producer needs one reviewed bulk-email action for eligible Clients.
- The producer needs to retrieve and share access later, including through
  WhatsApp.
- Ready and incomplete rows are visibly different.
- One incomplete row does not invalidate or erase successful rows.
- Imported work must use normal Skitza project, purchase, payment, access, and
  download rules rather than creating a parallel mini-system.
- Skitza does not add or display a platform fee.

Imported reminders are off by default. During the invitation step in this same
setup, the producer may explicitly enable reminders for selected unpaid
installments. Section 13.3 records the exact approved rule.

## 5. Verified current product model

### 5.1 Client and Project ownership

- A producer owns Clients through producer-scoped `client_contacts`.
- A Project belongs to one stable `clientContactId`.
- Email is required when creating a Client and is used for verified join
  discovery.
- After connection, ownership is stable through the Client ID and
  `clerkUserId`; changing a mutable email does not transfer the Project.
- The join continuation accepts verified Clerk email hashes, is scoped to the
  exact producer slug, and refuses an ownership conflict.

### 5.2 Purchases

A Purchase, not a Project, owns:

- the exact product or offer snapshot;
- subtotal, tax, total, and currency;
- song capacity;
- agreement text, rights, royalties, and deliverables;
- the chosen payment plan;
- installments and due triggers;
- acceptance and provenance;
- payments, proof, corrections, waivers, and cancellation history; and
- lifecycle state and download consequences.

The current Purchase sources are:

- Store product;
- private offer;
- session product;
- paid add-on; and
- no-charge add-on.

There is no source for imported existing work.

Current canonical Purchase creation writes `purchases.acceptedAt` and a
`purchase_acceptances` row whose accepting Clerk user ID is non-null. Current
ledger readers also consume that acceptance record. A producer cannot
truthfully fill those Artist fields for an agreement made outside Skitza.

### 5.3 Payment rules

The only current plans are:

- **Full:** 100% is the required first installment.
- **50/50:** the first complete 50% activates the Purchase; the final 50% is
  due only after exact Artist approval of every required ready Version.
- **Monthly:** the first complete installment activates the Purchase; later
  dates use the first confirmed payment date as their fixed anchor.

The only current due triggers are:

- acceptance;
- monthly anniversary; and
- Artist approval.

Current ledger rules also require:

- each payment to belong to one Purchase and one installment;
- a real `paidAt` date;
- payment currency to match the Purchase/installment currency;
- partial payments to preserve the remaining debt;
- overpayment to stay in the same Purchase and display as Overpaid;
- corrections and waivers to be explicit audit history; and
- totals to remain separated by currency.

### 5.4 Tax and song capacity

Every Purchase snapshot requires:

- subtotal;
- one tax mode: No tax, Tax included, or Tax added;
- tax rate and tax amount;
- exact final total;
- currency; and
- `includedSongSpaces`.

Import cannot save only an untyped final price or silently assume USD. It must
capture or derive the complete frozen snapshot.

Import creates zero Song rows. The normal first-upload flow creates and names
Songs later.

### 5.5 Current invitation behavior

- The working access URL is the producer-scoped
  `/sign-up/join/<producer-slug>/home` URL built by
  `buildClientInviteUrl`.
- Connection requires at least one verified Clerk email and claims only a
  matching Client for that producer.
- The normal **New Client** action creates the Client and immediately attempts
  an email invitation, so the batch feature must not reuse that convenience
  action.
- The lower-level Client creation domain is silent and can be used as part of
  an approved batch transaction.
- Current `invitedAt` is committed for both email intent and link-copy intent,
  before email delivery. A failed email can therefore still have invitation
  intent recorded, and copying a link currently appears as Invited.

The last item does not meet the captured feature requirement that link copying
must not claim an invitation was sent. The import feature needs an approved
delivery-state rule rather than pretending the current timestamp proves send
or delivery.

## 6. V1 scope

### 6.1 Included

- Optional entry after onboarding and a durable entry inside **Clients &
  Projects**.
- A manual batch workspace for approximately ten rows.
- Existing-client selection and silent new-client creation.
- One Project and one imported Purchase per Ready row.
- Reuse of one Client across multiple Project rows.
- Exact frozen agreement, tax, price, currency, song capacity, and current
  payment-plan shape.
- Historical manual payments with real dates and optional private proof.
- Ready / Needs info validation per row.
- Resumable drafts and idempotent creation per row.
- Partial batch success.
- A success state that explicitly confirms nobody was contacted.
- Optional reviewed bulk email after creation.
- Optional reminder selection in the same invitation step, off by default,
  including eligible unpaid Full, Monthly, and 50/50 installments.
- Later individual sharing through email, WhatsApp, or copy link.
- Desktop plus true 390px and 360px mobile layouts.

### 6.2 Excluded

- CSV or spreadsheet import.
- Milestone plans.
- Arbitrary custom payment plans or arbitrary due triggers unless Gili adds
  them through the decision in Section 13.
- Historical payments without a real received date.
- Automatic cross-installment allocation of one payment.
- Uploading files or creating/naming Songs during import.
- Mass WhatsApp automation.
- Phone-only identity.
- A new platform fee or payment processor.
- Reintroducing magic-link share tokens, `/share/[token]`, or `/invite/...`.
- Analytics work not explicitly added to the future Linear issue.
- Refactoring unrelated Clients & Projects, Store, Music, Payments, or
  Calendar code.

## 7. End-to-end experience

```text
Finish onboarding
    → optional Bring in active work card
    → manual batch workspace
    → complete each Client / Project / Purchase row
    → review Ready and Needs info rows
    → create every Ready row
    → success: nobody contacted
    → optional reviewed email invitation
    → optional reminders for selected unpaid installments
    → individual Share access remains available later
```

### 7.1 Entry

After normal onboarding, show one optional card:

```text
Bring in your active work
Add the clients and projects you already started.
Nothing will be sent to anyone.

[ Add active work ]        I'll do this later
```

Do not make this another mandatory onboarding step. Keep the action available
from `/dashboard/clients-projects`, whose current default view is Projects with
Clients as the secondary view.

### 7.2 Batch workspace

Each compact row represents one existing agreement being added as:

```text
Client + Project + imported Purchase
```

The list summary shows only:

| Client     | Project     | Purchase                   | Payment              | State      |
| ---------- | ----------- | -------------------------- | -------------------- | ---------- |
| Noya Levi  | Blue Hour   | Album production · ₪10,000 | 50/50 · ₪5,000 paid  | Ready      |
| Amir Cohen | Night Drive | Mixing · ₪3,000            | Missing plan mapping | Needs info |

Desktop uses a list/detail layout. Mobile uses stacked cards and a full-screen
row editor. Both keep a visible Ready / Needs info count.

Manual actions are limited to:

- Add row;
- select an existing Client or enter a new Client;
- add another Project for the selected Client;
- remove an uncreated draft row; and
- save and move to the next row.

Removing a draft never deletes a created Project or Purchase.

### 7.3 Row editor

Use this order:

1. Client
2. Project
3. Existing agreement
4. Payment plan and progress

#### Client

Required:

- name;
- valid email.

Optional:

- phone.

If the producer already has a Client with the same normalized email, reuse it
and show the match. Do not create a duplicate or overwrite existing notes,
tags, phone, connection state, or name without a separate explicit edit.

#### Project

Required:

- Project name.

Optional:

- delivery deadline, using the current Project deadline field.

A Project is the work container. Do not write price, deposit, payment plan, or
agreement fields directly onto it.

#### Existing agreement / imported Purchase

Required:

- service or offer label;
- exact agreement text and applicable rights/royalty/deliverable terms;
- subtotal;
- tax mode, rate, and amount;
- final agreed total;
- currency;
- included Song capacity;
- one current payment-plan shape; and
- explicit **By producer** provenance.

A current Store service may be used only as an editable starting template.
The imported Purchase freezes the actual outside agreement; later Store edits
cannot change it. The import must not publish or mutate a Store service.

The recommended domain direction is a distinct imported-existing-work source
with optional reference to a Store product used as a template. The exact enum,
schema, and audit fields require approval in Section 13. Do not disguise an
import as an accepted private offer.

#### Payment progress

For every historical payment, require:

- one target installment;
- amount;
- matching currency;
- real received date;
- actor/source shown as **Confirmed by producer**;
- optional note; and
- optional private proof.

If one outside transfer covered more than one installment, the producer must
split it into one payment record per installment. Do not silently allocate it.

Allow partial payments. Allow an amount above the Purchase total and show the
current **Overpaid** result; never move the excess to another Purchase.

Rows whose historical payment plan or due condition cannot map exactly to an
approved imported-Purchase shape remain **Needs info**. The UI must explain
that Skitza cannot represent the agreement yet; it must not convert “On
delivery,” a custom milestone, or a fixed outside schedule into a different
current trigger.

### 7.4 Review and validation

Use only two draft states:

- **Ready**
- **Needs info**

A row is Ready only when:

- the Client is valid or safely matched;
- the Project name is present;
- the complete imported Purchase snapshot is valid;
- subtotal, tax, total, and currency reconcile;
- song capacity is present;
- the plan and installment schedule follow the approved imported-work model;
- every historical payment has a target installment and real date;
- the ledger can derive paid, remaining, Overpaid, and lifecycle state without
  approximation;
- producer provenance is recorded without Artist acceptance; and
- no unresolved duplicate or ownership conflict exists.

Each Needs info row shows one or more exact reasons, for example:

- Missing Client email
- Missing tax treatment
- Missing Song capacity
- Payment date required
- Payment must be assigned to one installment
- Existing agreement does not match a supported payment plan
- Client is already connected to another verified account

The create action says:

```text
The imported agreement and payment history will be frozen.
Nothing will be sent to clients.

[ Create 8 ready items ]    [ Review 2 incomplete ]
```

Creation is atomic per row and idempotent by stable draft-row operation key.
A successful row remains successful if another row fails. Failed and
incomplete rows preserve their entered values.

### 7.5 Success

```text
8 projects and purchases created for 6 clients
No clients were contacted.

2 items remain as drafts

[ Done ]
[ Review and invite clients ]
```

**Done** is primary. Invitation remains optional.

## 8. Lifecycle, money, and access behavior

### 8.1 Purchase lifecycle

“Active work” is the feature name, not permission to force
`purchase.lifecycleStatus = active`.

Imported Purchases follow the current payment lifecycle unless Gili approves a
different imported-work rule:

- unpaid or partially paid first installment: Waiting for payment;
- complete first required installment: Active;
- later downward correction: does not deactivate an already active Purchase;
- canceled: remains visible in history.

The Project may still exist for producer management while its Purchase waits
for payment. Artist Music, Payments, listening, and download visibility follow
the current durable rules rather than the producer's informal description of
the work as already active.

### 8.2 Money projection

Every producer and Artist surface must read imported money from the canonical
Purchase ledger:

- Project page groups by Purchase;
- Client page groups Purchases by Project;
- Producer Payments uses the same installments, payments, proof, and audit
  records;
- Artist Payments shows the same Purchase after the approved imported-work
  visibility rule is implemented; and
- totals remain separate for each currency.

The current Clients & Projects list deliberately has no complete commercial
projection. This feature must add its read model from Purchase data; it must
not revive old Project totals or invoice fallbacks.

### 8.3 Access and downloads

Imported work uses the normal rules:

- a partial first installment does not activate the Purchase;
- the 50/50 final amount is triggered only by exact Artist approval if that
  current plan is used;
- downloads stay locked until the owning Purchase is fully paid unless an
  explicit Version override applies;
- later unpaid work in the same Project does not relock Versions owned by a
  fully paid Purchase; and
- canceled, corrected, waived, and overpaid history remains visible.

## 9. Invitation and later connection

### 9.1 Silent creation

Opening, autosaving, reviewing, or creating the batch must not:

- send email;
- open WhatsApp;
- stamp a state that claims a send happened;
- configure a reminder; or
- notify an Artist account.

Do not call the current `createClientAction`, because it intentionally attempts
an invitation email. Use an approved silent domain transaction.

### 9.2 Reviewed bulk email

After creation, deduplicate eligible rows by stable Client ID. The review shows
distinct Client count separately from Project/Purchase count.

The explicit action is:

```text
Send 6 email invitations
```

Eligibility:

- valid Client email;
- not connected;
- not already successfully sent through this action; and
- no unresolved ownership conflict.

Bulk delivery needs a stable operation key per bulk action and recipient.
Retrying after a double-click or timeout must not send a second copy.

The UI must distinguish:

- link copied or share sheet opened;
- email send requested;
- email provider accepted the send request;
- email send failed; and
- Artist connected.

It must not claim inbox delivery unless a provider supplies that evidence.
Current `invitedAt` alone is not enough to express these states.

The same reviewed step also offers **Turn on payment reminders**, off by
default. The producer chooses the Purchase/installments to include. The option
supports:

- an unpaid Full installment;
- unpaid Monthly installments;
- the first 50/50 installment when unpaid; and
- the final 50/50 installment, with reminder delivery waiting until exact
  Artist approval makes that installment due.

This is installment-level reminder behavior within the existing Full, 50/50,
and Monthly plans. It does not add a fourth **Milestones** payment plan.
Nothing is scheduled unless the producer explicitly turns reminders on.

### 9.3 Individual sharing

The Client page exposes **Share access** with:

- WhatsApp;
- Email; and
- Copy link.

All channels use the current producer-scoped
`/sign-up/join/<producer-slug>/home` URL. The link contains no client ID and is
not a secret access token; verified account identity performs the claim.

Opening WhatsApp or copying the link does not mark the Client as invited or
sent. Email changes send state only according to the approved delivery model.

### 9.4 Artist connection

The current verified flow is:

1. The Artist opens the producer's join URL.
2. Clerk provides at least one verified email hash.
3. Within that producer only, Skitza finds a Client whose current email hash or
   eligible frozen private-offer recipient hash matches.
4. Skitza binds that stable Client to the Clerk user if no conflicting owner
   exists.
5. Projects remain attached to the same Client ID.

Imported Purchases must become visible through that existing Client and
Project after the imported-provenance decision is implemented. The join flow
must not create a second Project or fake acceptance of imported terms.

If the Artist uses an email that does not match the imported Client, do not
silently merge or expose work. The recovery path remains an explicit decision.

## 10. Drafts, failure, and safety

- Autosave the batch after meaningful edits.
- Show one quiet saved state rather than a toast per field.
- Preserve the draft across reload and navigation.
- Keep successful row IDs in the draft response so retries return the existing
  Client, Project, Purchase, installments, and payments.
- Create each Ready row in one domain transaction.
- Scope every query and mutation by `ctx.producerId`.
- Verify every referenced Client, Project, and Store product belongs to that
  producer.
- Never trust totals, tax, currency, plan, or source IDs supplied by the UI
  without server validation.
- Never delete a created Client, Project, Purchase, payment, or proof when the
  producer removes an uncreated draft row.
- Never silently edit or delete confirmed payment history.
- Do not use the old database project or the out-of-sync Drizzle migration
  path. Any approved schema work must use `$skitza-migrate` with an explicit
  target and must not touch production without Gili's approval for that run.

## 11. Responsive and visual direction

- Preserve the current combined **Clients & Projects** information
  architecture.
- Use the current warm cream, near-black, and restrained amber system.
- Use a compact list/detail workspace on desktop.
- Use stacked cards and a full-screen row editor on mobile.
- Verify true 390px and 360px widths; do not judge phone layout from a desktop
  window clamped below 500px.
- Use current button-radius rules; reserve pills for approved pill-shaped
  controls.
- Keep visible labels and associated field errors.
- Do not use color as the only Ready / Needs info signal.
- Keep sticky actions clear of the keyboard and safe area.
- Use existing motion primitives and honor `prefers-reduced-motion: reduce`.
- Financial amounts use tabular numerals and always display their currency.

## 12. Mockup audit

The four existing images are **superseded exploration**, not implementation
specifications. Do not build from them until they are regenerated after
Section 13 is decided.

| Mockup                           | What remains useful                                   | What is stale                                                                                         |
| -------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `01-desktop-batch-workspace.png` | Compact batch list and selected-row detail            | Spreadsheet action, separate old sidebar IA, Project-level commercial framing, and “due on delivery”  |
| `02-desktop-review.png`          | Ready / Needs info review and partial creation        | Separate Projects navigation, due-date assumptions, and absence of Purchase/provenance validation     |
| `03-mobile-payment-editor.png`   | Mobile hierarchy and sticky Save & next               | “Due on delivery,” incomplete tax/song-capacity snapshot, and unapproved imported-Purchase provenance |
| `04-mobile-success-share.png`    | Silent-success message and later Share access concept | Invitation-state and imported-Purchase connection behavior are not yet resolved                       |

The image files are retained so the useful layout intent is not lost, but the
stale labels and business rules have no authority.

## 13. Product decisions before implementation

These are real product/data conflicts. Gili approved Sections 13.2–13.5 on
2026-08-20. Section 13.1 remains open. Do not answer the open decision silently
inside a pull request.

### 13.1 Imported Purchase provenance and acceptance

**Current conflict:** canonical Purchase creation and ledger reads model an
Artist acceptance and Clerk accepting user, but this feature records an
outside agreement **By producer**.

**Recommendation:** add a distinct imported-existing-work source and immutable
producer attestation that never puts producer data into an Artist acceptance
record or claims the Artist accepted in Skitza. Preserve who imported it,
when, and the exact frozen snapshot. The exact table/read-model shape remains
part of this decision.

**Gili must decide:** whether the Artist later sees only the provenance notice
or must explicitly acknowledge the imported terms, and whether acknowledgement
changes access.

### 13.2 Historical payment-plan compatibility

**Current conflict:** current plans and triggers are only Full, 50/50, Monthly,
acceptance, monthly anniversary, and exact Artist approval. Real outside
agreements may use a fixed date, delivery, or milestones.

**Recommendation for v1:** only create rows that can be represented exactly by
the approved imported versions of current plans. Keep every other row as Needs
info; never translate it to a different promise.

**Decision — approved by Gili on 2026-08-20:** v1 imports only agreements that
can be represented exactly by the approved imported versions of Full, 50/50,
or Monthly. Agreements with custom schedules remain Needs info and are not
silently translated.

The 50/50 plan includes its existing approval-triggered final installment. In
casual product discussion this may be described as a milestone, but this
decision does not reintroduce a separate Milestones payment plan.

### 13.3 Reminder policy for silently imported work

**Current conflict:** the captured feature contract says import must contact
nobody, while PRD v5.2 says automatic payment reminders default on. The
automatic reminder service exists, although the repository's current Vercel
configuration does not schedule it.

**Decision — approved by Gili on 2026-08-20:** imported Purchases start with
reminders disabled. In the invitation step of the same setup, the producer may
explicitly enable reminders for selected unpaid installments. This includes
Full, Monthly, the first 50/50 installment, and the final 50/50 installment.
For the final 50%, reminder delivery waits until exact Artist approval makes
that installment due. Import creation itself never sends or schedules a
reminder.

This is an approved imported-work exception to the PRD's global default-on
rule. It does not create a separate Milestones payment plan.

### 13.4 Invitation delivery state

**Current conflict:** current `invitedAt` records intent before delivery and is
also stamped for link copying. The captured UX requires link copying not to
claim an invitation was sent.

**Recommendation:** retain intent if it is needed for deletion safety, but add
or use a separate idempotent delivery record for successful Skitza email sends.
Display **Invited** only from the approved send-state definition; display
**Connected** only from stable Clerk ownership.

**Decision — approved by Gili on 2026-08-20:** **Invited** means Skitza
successfully sent the invitation email. Copying a link or opening WhatsApp does
not mark the Client as Invited.

### 13.5 Wrong-email recovery

**Current conflict:** verified matching is intentionally strict. A non-matching
account must not receive another Client's work.

**Recommendation:** fail closed and let the producer correct the unconnected
Client email through an explicit audited recovery flow.

**Decision — approved by Gili on 2026-08-20:** v1 stops the connection and asks
the producer to correct the unconnected Client email before the Artist retries.
It never merges accounts automatically.

## 14. Acceptance criteria after Section 13 approval

- [ ] `SK-255` contains the captured feature contract and every Section 13
      decision before implementation starts.
- [ ] The feature is optional after onboarding and reachable from the current
      combined Clients & Projects surface.
- [ ] Opening, editing, autosaving, reviewing, or creating a batch sends no
      client communication.
- [ ] One workspace supports at least ten rows and reuse of one Client across
      multiple Projects.
- [ ] Each created row produces one stable Client, one Project, and one
      first-class imported Purchase through a producer-scoped idempotent
      transaction.
- [ ] Imported terms have honest producer provenance and never fabricate an
      Artist signature, acceptance time, or accepting Clerk user.
- [ ] The frozen snapshot contains exact agreement text, rights/royalties,
      deliverables, subtotal, tax, total, currency, Song capacity, plan, and
      schedule.
- [ ] Only Full, 50/50, and Monthly appear unless Gili explicitly expands the
      model and PRD.
- [ ] Current 50/50 and Monthly trigger rules are preserved unless an approved
      imported-work rule replaces them.
- [ ] Historical payments require a real date, target one installment, show
      **Confirmed by producer**, and allow optional private proof.
- [ ] Partial, correction, waiver, canceled, and Overpaid behavior matches the
      canonical Purchase ledger.
- [ ] Money is read from Purchases and remains separated by currency on every
      surface.
- [ ] One incomplete or failed row never rolls back successful rows.
- [ ] Retrying the same row cannot duplicate a Client, Project, Purchase,
      installment, payment, or proof.
- [ ] An album with five Songs creates one Project and zero Song rows during
      import; Songs are created and named on first upload.
- [ ] The success screen states that nobody was contacted.
- [ ] Bulk email is a separate reviewed action, is idempotent per Client, and
      shows Project/Purchase count separately from distinct Client count.
- [ ] Imported reminders are off by default and can be enabled explicitly in
      the same invitation step for selected unpaid Full, Monthly, and 50/50
      installments.
- [ ] A selected final 50/50 installment sends no reminder until exact Artist
      approval makes that installment due.
- [ ] Copy link and WhatsApp do not claim an email was sent.
- [ ] The current producer-scoped join URL and verified-email ownership checks
      connect the existing Client without duplicating the Project.
- [ ] Artist visibility and downloads follow the approved imported-provenance
      and normal Purchase rules.
- [ ] Every server operation verifies producer ownership.
- [ ] The flow is visually verified on desktop, true 390px, and true 360px.
- [ ] Focused regression tests cover no-contact creation, provenance,
      ownership, idempotency, ledger totals, overpayment, partial batch
      success, and later connection.
- [ ] `$skitza-verify` passes before handoff.

## 15. Implementation sequence after approval

1. Create the Linear issue, record Section 13 decisions, move it to In
   Progress, and use Linear's exact generated branch name from `v3-clean`.
2. Update the PRD first if an approved decision changes Purchase plans,
   provenance, reminder defaults, or Artist access.
3. Add the approved imported-Purchase provenance and acceptance model.
4. Add exact schedule/lifecycle construction and canonical ledger/read-model
   support for imported Purchases.
5. Add resumable batch drafts, per-row validation, and stable operation keys.
6. Add the silent atomic Client → Project → Purchase creation service.
7. Build the desktop, 390px, and 360px manual batch experience.
8. Add reviewed idempotent bulk email and later individual sharing using the
   current join URL.
9. Add focused domain, integration, and interaction regression tests.
10. Run `$skitza-verify` and complete browser-based visual verification before
    handoff.
