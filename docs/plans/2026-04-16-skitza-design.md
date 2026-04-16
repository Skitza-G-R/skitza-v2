# Skitza — Founding Design Doc (v1)

> **Status:** Approved 2026-04-16. Mirror of `~/.claude/plans/sorted-sniffing-hanrahan.md`.
> **Implementation plan for Phase 1 Weeks 1–2:** see `2026-04-16-skitza-phase-1-weeks-1-2.md`.

> Greenfield SaaS for **independent (solo) music producers**. Web-first, with a Tauri desktop shell. Global from day 1. English-only at launch.

---

## 1. Context

**The problem.** A solo producer's business today is held together with Calendly + Samply + Notion + DocuSign + Stripe + Google Drive + WhatsApp. The #1 pain in 2026 isn't tools or talent — it's **coordination**: files, feedback, contracts, payments and decisions losing context as they bounce between five apps.

**The market gap (validated by research).** Three camps and **nobody bridges them**:
- **Studio-room booking** (Sonido, StudioTime, Jammed, AcaStudio, AllBooked, Spacebring) — built for *facilities with rooms*, ugly, no audio.
- **Audio collaboration** (Samply, Aliada, Filepass, Feedtracks, Pibox, Boombox, Opusonix) — beautiful waveform feedback, zero business management.
- **Generic creative-services CRM** (HoneyBook, Dubsado, Plutio) — full CRM/contracts/invoicing, *zero audio understanding*.

Skitza unifies all three for the **solo producer**, with a Spotify×Notion×Samply visual identity, a desktop install, and a single magic link that turns a cold lead into a paying signed booking.

**Outcome.** A producer can: send one URL → lead browses portfolio → books and pays a deposit → contract auto-signed → Project Room auto-provisioned → audio reviewed with timestamped feedback → final invoice paid → CRM updates itself.

---

## 2. Scope — v1 Feature Set

**Confirmed in brief:**
1. Smart Booking — Calendly-style self-serve with availability, buffers, travel rules.
2. Automated CRM — leads/active artists/sessions/balances derived from events.
3. Audio Collaboration — large WAV/FLAC/MP3 + stems, waveform player, timestamped comments, version stacking + A/B compare.
4. E-commerce — high-ticket services with deposits + milestone payments + payment plans. **No beat licensing in v1.**
5. In-app e-signatures — eIDAS + E-SIGN audit trail.
6. Portfolio — public dark-mode showcase with waveform players.
7. Smart Lead Links — single magic URL: portfolio + onboarding + booking + purchase.

**Added from research:**
8. **Project Room** (Notion-style) — one URL per engagement.
9. **White-label-lite** — strong app brand on chrome; producer brand inside workspace and lead link.
10. **Magic-link analytics** — view tracking.
11. **Mobile-first responsive web**.

**Deferred (Phase 2/3):** royalty splits, AI assist, automated nurture, beat licensing, native iOS/Android, multi-engineer team.

---

## 3. Architecture & Stack

| Concern | Choice |
|---|---|
| Frontend framework | **Next.js 15 (App Router)** |
| API layer | **tRPC v11 + TanStack Query** + Hono worker on Fly.io for uploads/websockets |
| Database + ORM | **Neon Postgres + Drizzle** (`numeric(19,4)` + ISO 4217 for money) |
| Auth | **Clerk** for producers; signed-JWT magic links (Resend) for clients |
| Media storage | **Cloudflare R2** + Trigger.dev v3 worker (`audiowaveform` + ffmpeg) |
| Payments | **Stripe Connect Express** + **Stripe Tax** |
| E-signatures | **Documenso (self-hosted on Fly)** |
| Real-time | **Liveblocks** |
| Booking engine | **Cal.com Atoms** (embedded React) |
| Hosting | **Vercel** + **Fly.io** + **Neon** + **R2** |
| Design system | **shadcn/ui + Tailwind v4 + Radix**; CSS variables for white-label-lite. Themes: `chrome-dark` (Spotify) + `room-paper` (Notion). |
| Audio waveform | **wavesurfer.js v7** + Regions + Timeline |
| Desktop shell | **Tauri 2.x** (~30 MB RAM, native menu, OS notifications, drag-from-Finder) |

### Data model — 12 core entities
`Producer`, `Client`, `Lead`, `Service`, `Availability`, `Booking`, `Project`, `AudioVersion`, `Comment`, `Contract`, `Invoice`, `MagicLink` (+ `MagicLinkView`, `PortfolioTrack`, `Notification`, `WebhookEvent`).

---

## 4. Phased Build Sequence

**Phase 1 — MVP (weeks 1–14)**
- Weeks 1–2: Repo, Next + Tauri shell, Clerk, Neon + Drizzle, design tokens, shadcn baseline, CI/CD. ← **THIS IS WHAT WE'RE BUILDING NOW**
- Weeks 3–5: Producer onboarding, Portfolio, Magic Lead Links + analytics, public booking page (Cal.com Atoms).
- Weeks 6–8: Project Room shell, R2 multipart upload, wavesurfer player, timestamped comments via Liveblocks, peaks worker on Trigger.dev.
- Weeks 9–10: Stripe Connect Express, Services catalog, milestone invoices, deposit checkout.
- Weeks 11–12: Documenso integration, contract templates, signed-PDF storage.
- Weeks 13–14: CRM auto-aggregation, mobile polish, Tauri OS notifications, beta with 5 producers.

**Phase 2 (months 4–6)** — Custom domains, version stacking + A/B, payment plans, advanced availability, notification digests, offline read cache, referral program.

**Phase 3 (months 7–12)** — Voice-memo → Whisper → notes, draft-reply LLM, automated nurture, royalty splits, multi-engineer rooms, Tauri iOS/Android, beat licensing.

---

## 5. Top 3 Technical Risks

1. **Large WAV uploads dropping on mobile** — R2 multipart + tus resumable + Service Worker queue.
2. **Global tax compliance** — Stripe Tax per Connect account; money as `numeric(19,4)` + ISO 4217.
3. **eIDAS/E-SIGN audit trail validity** — Documenso advanced sigs + immutable audit JSON in R2 with object-lock.

---

## 6. Verification — Launch Acceptance Scenarios

1. **Booking** — magic link → mobile → book → ICS + Stripe deposit → calendar sync.
2. **Audio collab** — drag 200 MB WAV → real-time progress → waveform in 30 s → comment at 1:42 → OS notification → reply → resolve.
3. **E-commerce + e-sign** — $4,500 link → in-browser sign → 30% deposit → Project Room auto-provisioned with contract + invoice + audio bay.
4. **CRM** — dashboard auto-shows leads/active/outstanding/sessions with zero manual entry.
5. **White-label-lite** — producer logo + accent on lead link & Project Room; Skitza brand stays on app chrome.
6. **Magic-link analytics** — opens, dwell, track replay counts within 60 s.
7. **Tauri parity** — every flow works installed; bundle < 15 MB; cold start < 1 s.

---

## 7. Open Items (resolved 2026-04-16)

- **Name:** Skitza ✅ locked.
- **Domain:** TBD — check `skitza.com`, `skitza.app`, `getskitza.com` before public launch.
- **Accounts:** Vercel exists. Cloudflare, Stripe, Neon need creation before week 1 deploy targets.
- **Pricing tiers:** suggested Free / Pro $29 / Studio $79 — validate with beta cohort.
- **Beta cohort:** recruit 5 producers in week 13.
- **Legal review:** contract templates and Documenso audit trail in US, UK, EU, IL.
