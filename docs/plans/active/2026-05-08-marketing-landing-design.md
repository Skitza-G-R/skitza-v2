# Marketing Landing Page — Design Doc

> **Status:** Pending approval (2026-05-08).
> **Track:** Standard. Standalone surface, ~10 files, schema delta.
> **Audience:** Producers clicking Instagram / TikTok / Google ads.
> **Branch:** `claude/gifted-curie-4aa2d8` (off `v3-clean`).

---

## 1. Goal

Build a dedicated **ad-conversion landing page** at `/get-started` (English) and `/get-started/he` (Hebrew) that:

1. Identifies the producer in 0.5 seconds ("scroll-stopper" headline)
2. Validates the pain in 2 seconds (split-screen chaos↔Skitza animation)
3. Proves the product in 15 seconds (demo video loop)
4. Captures their email by POSTing to a Make.com webhook (which routes to Airtable, optionally fans out to Resend / Mailchimp / Slack — all configured by the founder visually, no code)
5. Returns a personalized "you're in" state with their position in line

**Not** a replacement for the existing homepage at `/` — that page stays as the brand/SEO surface. The new page is a focused ad-traffic destination with a single CTA: get on the waitlist.

### Non-goals (out of scope for v1)

- ❌ Referral leaderboard ("share to skip 10 spots") — defer to v2
- ❌ UTM-aware copy variants (different headline per ad source) — defer to v2
- ❌ Mini playable demo (clickable 3-screen walkthrough) — replaced by 15-sec auto-playing screen recording (cheaper, same emotional payload)
- ❌ Manifesto / "read while you wait" page — defer to v2 (post-signup state will not link out)
- ❌ A/B testing infrastructure — ship v1, measure, then iterate
- ❌ Dynamic Hebrew gender variant (`?g=f`) — ship masculine for v1, fix in v2

---

## 2. Routes

| Route | Locale | Direction | Audience |
|---|---|---|---|
| `/get-started` | English | LTR | International producers |
| `/get-started/he` | Hebrew | RTL | Israeli producers |
| `/get-started/thanks` | English | LTR | Post-signup confirmation |
| `/get-started/he/thanks` | Hebrew | RTL | Post-signup confirmation |

### Why two physical pages, not one with a locale switch

Per `CLAUDE.md` mistake log 2026-04-20: **the root `<html dir>` is pinned LTR**. Mixing RTL into root layout broke the homepage in the past (next-themes + Clerk UserButton hydration mismatch). The Hebrew page is wrapped in `<div lang="he" dir="rtl">` AT THE PAGE COMPONENT LEVEL, not at root. Two separate routes makes that boundary explicit and keeps each page self-contained.

### Auth-gated redirect (both routes)

Signed-in producers are not the audience for this page. Both routes redirect signed-in users to `/dashboard` (matches the existing `apps/web/src/app/page.tsx` pattern).

---

## 3. Page structure

```
1. Hero                "You're a producer. Not an assistant."
                       [split-screen chaos↔Skitza animation]
                       [email field + "Get early access"]

2. Demo video          [15-sec auto-playing screen recording
                        in a phone-frame mockup, loops]
                       No copy.

3. Pain cascade        "How much time goes to waste on…"
                       [cascade copy + stack-reveal animation:
                        5 logos → 1 Skitza icon]

4. Founder note        [Gili's photo + 80 words]

5. CTA repeat          [email field, "Beta opens [date]"]

POST-SIGNUP STATE      "You're in, [Yuval]. #247 in line."
(replaces hero on the  [No outbound link in v1]
 /thanks route)
```

Reading time: ~90 seconds. Decision time: ~10 seconds. Page weight target: <300 KB on first paint.

---

## 3.5 Isolation from the rest of Skitza

**The ad landing page is a dead-end funnel.** Visitors either sign up or leave. There are **NO outbound navigation links** to the rest of Skitza.

This is deliberate. Every off-page link is a conversion leak. Industry data: adding a "Home / Pricing / Login" nav bar to a cold-ad landing page cuts conversion by 20-40%.

### ❌ Hard "do not include" list

| Element | Why not |
|---|---|
| Header navigation bar | No "Home", "Pricing", "Login", "Sign up" links |
| Footer with site links | No "About", "Blog", "Help", "Terms" navigation |
| Logo that links to `/` | Logo *displays* but is not clickable. Brand recognition without escape hatch. |
| "Sign in" / "Create account" button | Not the funnel — they get an email when beta opens |
| Links to `/pricing`, `/about`, `/features`, `/blog` | None |
| "Learn more about Skitza" CTAs | None |
| Embedding `landing.css` (homepage's stylesheet) | Use a fresh `get-started.css` only |
| Inheriting any nav/footer from a shared layout | Page uses its own layout that excludes them |
| Sitemap inclusion | Excluded from `sitemap.ts` |
| SEO indexing | Set `robots: { index: false, follow: false }` in metadata |

### ✅ Allowed

| Element | Notes |
|---|---|
| The waitlist submit button | The ONLY CTA — fires the Make.com webhook |
| Logo as static brand element | Display only, not a link |
| Skitza brand colors and typography | Visual continuity is style, not navigation — fine |
| Internal navigation between `/get-started` ↔ `/get-started/thanks` | Stays inside the ad funnel |
| Internal navigation between `/get-started/he` ↔ `/get-started/he/thanks` | Same |

### Post-signup `/thanks` page — also isolated

Same rules apply. The `/thanks` page does NOT show:
- ❌ "Back to homepage" link
- ❌ "Explore Skitza" CTA
- ❌ "Follow us on Instagram / Twitter" (defer to v2 if conversion data shows interest)
- ❌ Footer links

It shows ONLY: greeting + position confirmation + "we'll email you" copy.

### Signed-in user behavior

If an already-signed-in producer lands on `/get-started`, they are **silently redirected to `/dashboard`** (the existing pattern in `apps/web/src/app/page.tsx`).

**This is NOT a leak from the ad page** — it's an auth guard that runs *before* the page renders. The signed-in producer is not the ad target. They're a producer with an account who happened to type or click the URL. Sending them to their dashboard is correct UX.

If you want to drop this redirect entirely (let signed-in users also see the ad page), tell me — it's a 1-line change. Default behavior: redirect.

### Architectural enforcement

- **Route placement:** `apps/web/src/app/get-started/...` — at root level, NOT inside `(public)` route group. This avoids inheriting any group-level layout that might add nav.
- **Custom layout:** `apps/web/src/app/get-started/layout.tsx` is a minimal layout that wraps children only. No header, no footer, no logo-link. No global nav.
- **Metadata:** Each page sets `robots: { index: false, follow: false }` to prevent search engines from indexing the ad funnel (paid traffic destination, not organic).
- **Sitemap:** `apps/web/src/app/sitemap.ts` explicitly excludes `/get-started*` routes.
- **Service worker:** Existing SW (per CLAUDE.md) is configured to skip cache for `/get-started/*` paths so ad visitors always see fresh UI on each visit.
- **Analytics:** Page-view events for `/get-started*` should be tagged with a separate property so analytics dashboards don't mix ad-funnel traffic with organic homepage traffic.

---

## 4. Section specs

### 4.1 Hero

**Copy (English):**
```
You're a producer. Not an assistant.

Booking a session shouldn't take longer than the session.
Skitza replaces WhatsApp, Drive, Notion, DocuSign, and Stripe
— with one link.

[ your@email.com ]  [ Get early access ]
No spam. We email you when your spot opens.
```

**Copy (Hebrew):**
```
אתה מפיק. לא מזכירה.

תיאום סשן לא אמור להיות ארוך יותר מהסשן עצמו.
סקיצה מחליפה את WhatsApp, Drive, Notion, DocuSign ו-Stripe — בלינק אחד.

[ your@email.com ]  [ גישה מוקדמת ]
בלי ספאם. נשלח לך מייל ברגע שהמקום שלך מתפנה.
```

**Animation: split-screen chaos ↔ Skitza calm.**

- **Left half (chaos panel)** — pure CSS animation loop, ~8 sec
  - WhatsApp message bubbles fade in stacked: "u up to record Tuesday?", "yo did u get the stems?", "FINAL_v7.wav", "where's the Stripe link?"
  - Calendar invites slide in showing "DECLINED" stamps
  - Effect: a feeling of overwhelm. Not chaos for chaos's sake — staged like a wave that crests, then resets.
- **Right half (Skitza panel)** — pure CSS animation loop, ~8 sec
  - Clean Skitza session card. "Book session" button pulses. Card flips to show "Confirmed ✓ Aug 14, 2:00 PM"
  - Slow, calm. Glide easings (`cubic-bezier(0.16, 1, 0.3, 1)`).
- Both panels run on the same 8-sec loop, perfectly synced.
- **Hover state** — when the user hovers either panel, that panel scales 1.02 and the opposite panel dims to 50%. Reactive but subtle.

**CSS conventions to follow:**
- All colors via `var(--bg-base)`, `var(--fg-primary)`, etc. — no hex codes
- All animations gated by `@media (prefers-reduced-motion: reduce)` (existing CI test enforces)
- Use `cubic-bezier(0.16, 1, 0.3, 1)` for "Skitza calm" (existing easing in `globals.css`)

**Mobile (≤768px):**
- Split-screen stacks vertically: chaos panel on top, Skitza panel below
- Animation duration shortens to 6 sec (smaller screens, faster perception)
- Hover state disabled (touch-only)
- Both panels at 100% opacity always

**Email form:**
- Single `<input type="email">` + submit button
- Inline error display (no toast — toast is for in-app feedback)
- Submit button shows spinner while pending
- After successful signup: client-side redirect to `/get-started/thanks?n=<firstName>` (English) or `/get-started/he/thanks?n=<firstName>` (Hebrew). Drop `?n=` if no name was provided.
- Honeypot anti-spam field: hidden `<input name="company">` — bots fill it, humans don't. Server rejects any signup where `company` is non-empty.

**File:** `apps/web/src/app/get-started/_components/hero-section.tsx`

---

### 4.2 Demo video

**Content:** A 15-second screen recording of the actual Skitza dashboard:
- 0–3 sec: Producer creates a session product, sets a price
- 3–6 sec: Producer copies the share link, pastes it (the receiving artist's app shows on the right)
- 6–9 sec: Artist clicks "Book", picks a slot, pays
- 9–12 sec: Producer's dashboard shows new "Confirmed" booking + paid invoice
- 12–15 sec: Camera zooms out to show all 4 surfaces unified

The video is the **proof** for the hero's "Booking shouldn't take longer than the session" claim.

**Encoding:**
- WebM (VP9), 720×1280 (portrait phone aspect), <800 KB
- MP4 (H.264) fallback, <1 MB
- No audio track (saves weight; landing pages mute by default anyway)
- 30 fps

**Markup:**
```tsx
<video
  src="/landing/demo.webm"
  poster="/landing/demo-poster.jpg"
  autoPlay
  muted
  loop
  playsInline
  preload="metadata"
  className="..."
>
  <source src="/landing/demo.webm" type="video/webm" />
  <source src="/landing/demo.mp4" type="video/mp4" />
</video>
```

**Phone-frame mockup:**
- Pure CSS — a rounded `<div>` with a notch pseudo-element. No PNG asset.
- Shadow: `var(--shadow-elevated)` (existing token)
- Frame width 320px on mobile, 380px on desktop (centered)

**Lazy-load:**
- `IntersectionObserver` triggers video load when within 200px of viewport
- Until loaded, show poster image (`<img>` with same dimensions)
- Prevents 1MB download on first paint for users who never scroll

**`prefers-reduced-motion` fallback:**
- If user prefers reduced motion: video doesn't auto-play, only poster image displays with a small "▶ Play demo" button
- Tap to play (and unmutes is NOT enabled — stays muted)

**Asset placement:**
- `apps/web/public/landing/demo.webm`
- `apps/web/public/landing/demo.mp4`
- `apps/web/public/landing/demo-poster.jpg`

**File:** `apps/web/src/app/get-started/_components/demo-video-section.tsx`

**TODO before merge:** Demo video and poster image need to be created. Capture from a staged Skitza demo account. Coordinate with Gili.

---

### 4.3 Pain cascade

**Copy (English):**
```
How much time goes to waste on…

Booking sessions. Searching WhatsApp for the right version.
Chasing payments. Tracking what's due Friday and re-typing
the same to-do list, every. single. time.

Who's got time for this?

You used to need a part-time assistant just to keep up.
Now you have Skitza.

One app. For everything. Forever.
```

**Copy (Hebrew):**
```
כמה זמן הולך לך על?

לקבוע סשנים. לזכור מי חייב לך. לרדוף אחרי תשלומים.
לחפש גרסאות בוואטסאפ. לעקוב מי לקוח פעיל ומה דחוף
ואז עוד לתעד את הכל מחדש — בכל פעם.

למי יש זמן לזה?

פעם היה צריך לזה מזכירה.
היום, יש סקיצה.

אפליקציה אחת שסוגרת לך את כל הפינות.
```

**Stack-reveal animation:**
- Triggered when section enters viewport (`IntersectionObserver`)
- 5 brand logos render in a row: WhatsApp, Drive, Notion, DocuSign, Stripe
- Stage 1 (0–1.5 sec): Logos pulse with a "stress" animation — slight wobble + red-tinted glow
- Stage 2 (1.5–3 sec): Logos shrink and slide toward center, merging into one Skitza icon
- Stage 3 (3–4 sec): Skitza icon settles, gentle pulse
- Loops every 8 seconds (fade out, restart)

**Logo treatment:**
- Use SVG icons, not PNG (sharp at any zoom)
- Skip official brand colors — render in `var(--fg-secondary)` (monochrome) to avoid trademark concerns AND look more cohesive
- Each logo is wrapped in a hover-tilted card

**Mobile:** Logos stack 2-3-1 vertically instead of 5 across. Animation timing unchanged.

**File:** `apps/web/src/app/get-started/_components/pain-cascade-section.tsx`
**Sub-component:** `apps/web/src/app/get-started/_components/stack-reveal.tsx`

---

### 4.4 Founder note

**Copy (English, ~80 words):**
```
I'm Gili, and I built Skitza after watching my producer
friends spend more time on WhatsApp than in the studio.

Bookings in one app. Drive in another. Contracts in a
third. Payments in a fourth. None of them talked to
each other. None of them were built for music.

Skitza is what I wish they had — one link that handles
the whole stack so you can get back to making music.

— Gili Asraf, founder
```

**Copy (Hebrew, matched register):**
```
אני גילי. בניתי את סקיצה אחרי שצפיתי בחברים מפיקים
מבזבזים יותר זמן בוואטסאפ מאשר בסטודיו.

הזמנות באפליקציה אחת. דרייב באחרת. חוזים בשלישית.
תשלומים ברביעית. אף אחד מהם לא דיבר עם השני, ואף
אחד לא נבנה למוזיקה.

סקיצה היא הכלי שתמיד רציתי שיהיה להם — לינק אחד
שמטפל בכל הסטאק, כדי שתוכל לחזור לעשות מוזיקה.

— גילי אסרף, מייסד
```

**Layout:**
- Two-column on desktop: photo (left) + text (right). 1:2 ratio.
- Stacks vertically on mobile (photo on top, ~120px circular).
- Photo is a circular crop, ~280px desktop / 120px mobile.
- Subtle border: `var(--border-subtle)` 1px.

**Asset:**
- `apps/web/public/landing/founder.jpg` (square, ~600×600, <80KB after Next/Image optimization)

**TODO before merge:** Gili needs to provide a photo. Acceptable: phone selfie in good light, neutral background. Until provided, use a placeholder gradient avatar with initials "GA".

**File:** `apps/web/src/app/get-started/_components/founder-section.tsx`

---

### 4.5 CTA repeat

**Copy (English):**
```
Get on the waitlist.

[ your@email.com ]  [ Get early access ]

Beta opens [DATE]. Spots are limited.
```

**Copy (Hebrew):**
```
הצטרף לרשימת ההמתנה.

[ your@email.com ]  [ גישה מוקדמת ]

הביטא נפתחת ב-[DATE]. המקומות מוגבלים.
```

**Behavior:**
- Same form component as the hero CTA (one shared `WaitlistForm` component)
- Visually larger: input height 56px (vs hero's 48px), button has `.sk-cta-shine` class for hover animation
- Subtle background: `var(--bg-elevated)` to differentiate from the rest of the page

**Date placeholder:**
- `[DATE]` is hardcoded for v1 — change in code when beta date locks (likely May/June 2026 per `30_day_launch_plan` memory)
- A future v2 enhancement: load from a `launch_settings` config table

**File:** `apps/web/src/app/get-started/_components/cta-section.tsx`

---

### 4.6 Post-signup state (`/get-started/thanks`)

This is a **separate route**, not a state on the hero page. After form submit succeeds, the client navigates to `/get-started/thanks?n=Yuval` (English) or `/get-started/he/thanks?n=Yuval` (Hebrew). The `?n=` param is dropped when no name was captured.

**Why a separate route, not in-place state?**
- Clean URL = the producer can share/bookmark "I'm on the Skitza waitlist!"
- Analytics: clean conversion funnel (`/get-started` → `/get-started/thanks`)
- No client-state hydration headaches

**Copy (English):**
```
You're in, [Yuval].

Beta opens [DATE].
We'll email you when your spot opens.
```

**Copy (Hebrew):**
```
אתה בפנים, [יובל].

הביטא נפתחת ב-[DATE].
נשלח לך מייל ברגע שהמקום שלך מתפנה.
```

**Without name (when form didn't capture one):**
- "You're in." / "אתה בפנים." (drop the name + comma)

**Animation:** A subtle confetti burst on page load (CSS-only, ~2 sec, gated by `prefers-reduced-motion`). Particles fade and clear. Don't loop.

**Name:**
- Read from query param `?n=Yuval` (URL-encoded)
- Validate: max 60 chars, strip HTML/special chars. If invalid, drop the name.
- Privacy: query-param names are visible in browser history. We're OK with this since the producer just submitted it themselves.

**Position counter:** **Removed for v1** (no DB to query — see §5 for the rationale). Returning to this in v2 once we either move signups into a real DB or have Make.com return the count in the webhook response.

**File:** `apps/web/src/app/get-started/thanks/page.tsx` + `apps/web/src/app/get-started/he/thanks/page.tsx`

---

## 5. Email capture flow

**Architecture decision (2026-05-08):** No new DB table, no Resend audience sync from app code. Skitza app **proxies** signups to a Make.com webhook. Make.com handles all downstream routing (Airtable as primary store, Resend / Mailchimp / Slack as optional fan-outs). This keeps app code minimal and lets the founder reconfigure downstream routing visually without code changes.

```
┌──────────────────────────────────────────────────────────────┐
│  1. User submits form                                        │
│     │                                                        │
│     ▼                                                        │
│  2. Client validates (HTML5 + Zod)                           │
│     │                                                        │
│     ▼                                                        │
│  3. tRPC `waitlist.signup` mutation                          │
│     │                                                        │
│     ├─ a. Rate limit: 5/IP/hour (rejects on overrun)         │
│     ├─ b. Honeypot check: reject if `company` field non-empty│
│     ├─ c. POST to Make.com webhook (10s timeout)             │
│     │     Make.com receives → routes to Airtable + Resend +  │
│     │     anything else the founder configures               │
│     └─ d. On webhook success, return                         │
│     │                                                        │
│     ▼                                                        │
│  4. Client redirects to `/thanks?n=…`                        │
└──────────────────────────────────────────────────────────────┘
```

**Source of truth:** Airtable (managed via Make.com).

**Why Make.com instead of writing to DB + Resend ourselves:**
- ✅ Founder can manage signups in a spreadsheet (Airtable) without SQL knowledge
- ✅ Add/remove/swap downstream destinations (Resend → Mailchimp, add Slack alerts, etc.) without code deploys
- ✅ Make.com handles reliability (99.99% SLA) — we don't need cron retries
- ✅ Drops 1 DB table, 1 migration, 1 Resend integration file from our codebase
- ✅ Easier to A/B-route different ad sources (UTMs) to different email sequences in v2

**Failure mode:** If Make.com webhook is unreachable or returns ≥500, the form shows an inline error: "Something went wrong, try again in a moment." We don't queue or retry locally — Make.com's uptime is our uptime. Worst case, producers retry; we lose <0.01% of signups during outage windows.

**No idempotency in app code.** If the same email submits twice, the webhook fires twice. Make.com (or Airtable filter) deduplicates downstream — that's their job, not ours.

**No position counter in v1.** The `/thanks` page used to show "You're #247 in line" — that required a DB query. With no DB, there's no source for the count. Three options were considered:
1. ❌ Make.com returns Airtable row count in webhook response — adds Make.com complexity
2. ❌ Hardcoded vanity counter — insecure, fake-feeling
3. ✅ **Drop the position counter for v1** — `/thanks` page just says "You're in. We'll email you when your spot opens."

Decision: option 3. The position counter was a nice-to-have. It's a v2 enhancement once we either move to a real DB or set up Make.com to return the count.

---

## 6. Data model

**No new tables in our database.** Signups live in Airtable (managed via Make.com).

The Make.com webhook receives a JSON payload from Skitza app and creates a row in an Airtable base named (suggested) `Skitza Waitlist`. The founder configures the Airtable schema directly in Airtable's UI — not in code.

### Recommended Airtable columns

| Column | Type | Source | Notes |
|---|---|---|---|
| `Email` | Email | webhook | primary identifier |
| `First name` | Single line text | webhook (optional) | from form |
| `Locale` | Single select (`en`, `he`) | webhook | which page they signed up on |
| `Signed up at` | Created time | Airtable auto | use built-in field |
| `UTM source` | Single line text | webhook | e.g. `instagram`, `tiktok` |
| `UTM medium` | Single line text | webhook | e.g. `cpc`, `social` |
| `UTM campaign` | Single line text | webhook | e.g. `producer-launch-q2` |
| `Referrer` | URL | webhook | from `document.referrer` |
| `User agent` | Long text | webhook | for fraud / device analytics |
| `IP address` | Single line text | webhook | for fraud / geolocation |
| `Status` | Single select (`waitlist`, `invited`, `joined`, `unsubscribed`) | manual + Make.com | founder updates manually or via Make.com when beta opens |
| `Notes` | Long text | manual | founder's own annotations |

### Webhook payload (sent from Skitza to Make.com)

```json
{
  "email": "user@example.com",
  "firstName": "Yuval",
  "locale": "he",
  "utmSource": "instagram",
  "utmMedium": "social",
  "utmCampaign": "producer-launch-q2",
  "referrer": "https://www.instagram.com/",
  "userAgent": "Mozilla/5.0 …",
  "ipAddress": "203.0.113.42",
  "signedUpAt": "2026-05-08T14:32:11.482Z"
}
```

### Field semantics

- `firstName` is **optional** (form may not collect it in v1; payload key still present, value `null`)
- `email` is always **lowercased + trimmed** by the server before sending
- All UTMs and `referrer` are **optional** (`null` if not present in URL)
- `ipAddress` comes from `x-forwarded-for` header (Vercel sets this)
- `signedUpAt` is **always** ISO 8601 in UTC

---

## 7. tRPC procedure

### New router: `waitlist`

```ts
// apps/web/src/server/trpc/routers/waitlist.ts

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../init";
import { rateLimitByIp } from "~/server/rate-limit";

const SignupInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    firstName: z.string().trim().min(1).max(60).optional(),
    locale: z.enum(["en", "he"]),
    utm: z
      .object({
        source: z.string().max(50).optional(),
        medium: z.string().max(50).optional(),
        campaign: z.string().max(100).optional(),
      })
      .optional(),
    referrer: z.string().url().max(2048).optional(),
    // honeypot — must be empty for the signup to be accepted
    company: z.string().max(0).optional(),
  })
  .strict();

const WEBHOOK_TIMEOUT_MS = 10_000;

export const waitlistRouter = router({
  signup: publicProcedure.input(SignupInput).mutation(async ({ ctx, input }) => {
    // Honeypot — silent success so bots don't learn they were detected
    if (input.company && input.company.length > 0) {
      return { status: "ok" as const };
    }

    await rateLimitByIp(ctx.ip, "waitlist:signup", 5, 3600);

    const webhookUrl = process.env.MAKE_WAITLIST_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error("[waitlist] MAKE_WAITLIST_WEBHOOK_URL not configured");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Signup is temporarily unavailable",
      });
    }

    const payload = {
      email: input.email,
      firstName: input.firstName ?? null,
      locale: input.locale,
      utmSource: input.utm?.source ?? null,
      utmMedium: input.utm?.medium ?? null,
      utmCampaign: input.utm?.campaign ?? null,
      referrer: input.referrer ?? null,
      userAgent: ctx.userAgent ?? null,
      ipAddress: ctx.ip ?? null,
      signedUpAt: new Date().toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error(
          `[waitlist] Webhook returned ${String(response.status)}`,
          await response.text().catch(() => "<no body>"),
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not save your signup. Please try again.",
        });
      }
    } catch (err: unknown) {
      if (err instanceof TRPCError) throw err;
      console.error("[waitlist] Webhook fetch failed", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not save your signup. Please try again.",
      });
    } finally {
      clearTimeout(timer);
    }

    return { status: "ok" as const };
  }),
});
```

### Wire-up

Add `waitlistRouter` to `apps/web/src/server/trpc/root.ts` under the key `waitlist`.

### Rate limiting

Existing infra at `apps/web/src/server/rate-limit/`. Pattern: 5 signups per IP per hour. After exceeding, throw `TRPCError({ code: "TOO_MANY_REQUESTS" })`. Form catches that and shows: "Slow down — try again in an hour."

### Environment variable

`MAKE_WAITLIST_WEBHOOK_URL` — the webhook URL that Make.com gives you when you set up a "Webhooks > Custom webhook" trigger in your scenario. Set in Vercel env vars (Production + Preview + Development — all three).

**Format example:** `https://hook.us2.make.com/abc123def456ghi789…`

**Important:** Treat this URL as semi-secret. Anyone with it can POST junk into your Airtable. Do NOT commit it to git, do NOT expose it in `NEXT_PUBLIC_*` vars (it stays server-side only — that's why the procedure runs on the server, not in the browser).

---

## 8. Make.com + Airtable setup (one-time, by Gili)

This is configuration the founder does in Make.com and Airtable — **no Skitza code needed for any of this**.

### Step 1 — Airtable base

1. Create a new Airtable base named **"Skitza Waitlist"**
2. Rename the default table to **"Signups"**
3. Add columns per the schema in §6 above (Email, First name, Locale, etc.)
4. Note: Airtable's built-in `Created time` field handles `Signed up at` automatically — you don't need to add it manually

### Step 2 — Make.com scenario

1. Create a new Make.com scenario
2. Add a **"Webhooks > Custom webhook"** trigger as the first module
3. Make.com generates a unique URL like `https://hook.us2.make.com/abc123…` — copy it
4. Add a **"Airtable > Create a record"** module after the webhook
5. Map the webhook payload fields onto Airtable columns:
   - `email` → Email column
   - `firstName` → First name column (handle `null` gracefully — Airtable lets you skip empty)
   - `locale` → Locale column
   - `utmSource` → UTM source column
   - … (see §6 for the full list)
6. Turn on the scenario

### Step 3 — Vercel env var

1. Paste the Make.com webhook URL into Vercel as `MAKE_WAITLIST_WEBHOOK_URL`
2. Set in **all three environments**: Production, Preview, Development
3. Vercel auto-redeploys when env vars change (~2 min)

### Step 4 — Smoke test

After redeploy, submit a signup on the Vercel preview URL. Check:
1. Make.com scenario log shows "1 operation" within seconds
2. Airtable "Signups" table has the new row with all fields populated
3. If anything fails, Make.com's scenario history shows the exact error

### Optional — fan-out to Resend / Mailchimp / Slack

After the Airtable row is created, add more modules to the same Make.com scenario:
- **Resend > Add contact to audience** — for marketing emails
- **Mailchimp > Add subscriber** — alternative to Resend
- **Slack > Send message** — alert in `#signups` channel: `"New waitlist signup: yuval@…"`

Founder configures these visually. Skitza app code never changes.

---

## 9. Hebrew RTL handling

### The constraint

Per `CLAUDE.md` § Documentation rules — i18n: "the public homepage and `/p/<slug>` are English-only LTR. The root `<html>` element is ALWAYS `lang="en" dir="ltr"`."

### The pattern

```tsx
// apps/web/src/app/get-started/he/page.tsx
export default async function HebrewLandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div lang="he" dir="rtl" className="get-started-root get-started-root--he">
      <HeroSection locale="he" />
      <DemoVideoSection />
      <PainCascadeSection locale="he" />
      <FounderSection locale="he" />
      <CtaSection locale="he" />
    </div>
  );
}
```

The `<div>` carries `dir="rtl"`. The `<html>` element stays LTR. CSS that needs to flip uses logical properties (`padding-inline-start` not `padding-left`) or the `[dir="rtl"]` selector for cases where logical properties don't help.

### Tailwind RTL approach

Tailwind's `rtl:` modifier works only when the framework can detect direction. Since our `<html>` is always LTR, `rtl:` won't fire automatically. Two options:

1. **Manual `[dir="rtl"]` selectors in `landing.css`** — explicit, predictable, no framework magic.
2. **A `dir`-aware `clsx` helper** — `cn("text-left", isRtl && "text-right")`.

**Recommendation: option 1 (manual `[dir="rtl"]`).** All landing-specific styles live in one CSS file (`landing.css`), so it's easy to grep, easy to audit, and doesn't introduce a new abstraction.

### Localization data flow

- No `next-intl` for these pages. Two physical components, two physical pages, copy hardcoded.
- Why: keeps the page weight tiny (no i18n bundle), no risk of accidentally inheriting a locale cookie that flips the homepage.

---

## 10. File structure

```
apps/web/src/app/
├── get-started/
│   ├── layout.tsx                          # ⭐ NEW — isolated minimal layout
│   │                                       #    NO header, NO footer, NO nav.
│   │                                       #    Children only. Sets noindex meta.
│   ├── page.tsx                            # English landing
│   ├── thanks/
│   │   └── page.tsx                        # English post-signup
│   ├── he/
│   │   ├── page.tsx                        # Hebrew landing
│   │   └── thanks/
│   │       └── page.tsx                    # Hebrew post-signup
│   └── _components/
│       ├── hero-section.tsx
│       ├── demo-video-section.tsx
│       ├── pain-cascade-section.tsx
│       ├── stack-reveal.tsx
│       ├── founder-section.tsx
│       ├── cta-section.tsx
│       ├── waitlist-form.tsx               # shared form
│       ├── post-signup-confetti.tsx        # confetti animation
│       └── static-logo.tsx                 # ⭐ NEW — non-clickable logo (no <a> href)
└── sitemap.ts                              # MODIFIED: exclude /get-started* routes

apps/web/src/styles/
└── get-started.css                         # all landing-specific CSS

apps/web/public/landing/
├── demo.webm
├── demo.mp4
├── demo-poster.jpg
└── founder.jpg

apps/web/src/server/
├── trpc/routers/waitlist.ts                # NEW
└── trpc/routers/__tests__/waitlist.test.ts # NEW
```

**No DB changes.** No new migration. No `packages/db/` edits. Signups go to Make.com → Airtable.

**File count: ~12 new + 1 modified (`trpc/root.ts` to register the new router).**

---

## 11. Animations + reduced-motion

Every animation MUST be gated by:

```css
@media (prefers-reduced-motion: reduce) {
  .my-animation {
    animation: none !important;
    transition: none !important;
  }
}
```

Existing CI test: `apps/web/src/app/__tests__/motion-primitives.test.ts` fails if a new animation primitive lacks this gate. Test will pick up new keyframes in `get-started.css`.

### Animation inventory

| Primitive | Section | Behavior | Reduced-motion fallback |
|---|---|---|---|
| `gs-chaos-loop` | Hero | 8s loop, message bubbles + decline stamps | Static composition (last frame) |
| `gs-skitza-loop` | Hero | 8s loop, calm card flip | Static "Confirmed" card |
| `gs-hero-tilt` | Hero | hover scale 1.02 | No-op |
| `gs-stack-reveal` | Pain cascade | 8s loop, 5 logos → 1 | Static end-state (Skitza icon) |
| `gs-confetti` | Post-signup | 2s burst, fade out | No-op (skip confetti entirely) |
| `gs-cta-shine` | CTA repeat | hover-only diagonal shimmer | No-op |

All animations use existing easing tokens from `globals.css` (`cubic-bezier(0.16, 1, 0.3, 1)` for "calm", `cubic-bezier(0.4, 0, 0.2, 1)` for "snap").

---

## 12. Accessibility

- All form inputs have visible `<label>` (sr-only when not visually shown)
- `:focus-visible` rings on all interactive elements (existing convention; not `:focus`)
- `aria-live="polite"` region for form error/success messages
- Demo video has `aria-label="Skitza app demo: producer creates session, artist books, payment confirmed"`
- All images have `alt` attributes (founder photo: "Gili Asraf, Skitza founder")
- Color contrast: tokens already meet WCAG AA per existing audit
- Keyboard: Tab order follows visual order. Email form submits on Enter.
- Touch targets: ≥44×44 on mobile (existing `.sk-tap` utility)

---

## 13. Mobile responsiveness

- **Mobile-first.** All sections work at 360px width before any desktop refinement.
- **iOS safe-area** respected via `.sk-safe-top`, `.sk-safe-bottom` (existing utilities).
- **Hero animation** stacks vertically on ≤768px.
- **Stack reveal** wraps logos 2-3-1 instead of 5 across.
- **Founder note** stacks photo above text on ≤768px.
- **Forms:** input height 48px on desktop / 56px on mobile (bigger touch targets).
- **Video:** phone-frame mockup is the same width as the viewport minus 32px padding on mobile, ~380px on desktop.

---

## 14. Testing

### Unit tests

- `apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts` — uses `vi.fn()` to mock `fetch`
  - Happy path: webhook returns 200 → mutation returns `status: "ok"`
  - Webhook URL not configured: missing `MAKE_WAITLIST_WEBHOOK_URL` → `INTERNAL_SERVER_ERROR` with safe user-facing message
  - Webhook returns 500: mutation throws `INTERNAL_SERVER_ERROR` with safe user-facing message
  - Webhook times out (>10s): `AbortController` fires, mutation throws `INTERNAL_SERVER_ERROR`
  - Rate limit: 6th request in an hour throws `TOO_MANY_REQUESTS` (webhook NOT called)
  - Honeypot: signup with `company: "anything"` returns silent `ok` without firing webhook
  - Validation: invalid email throws `BAD_REQUEST`
  - Payload shape: webhook receives the exact JSON specified in §6 (assert via mock call args)

**No DB integration tests** — no DB changes in this feature.

### Manual smoke test (one-time, post-deploy)

After Make.com setup (§8) and first deploy:
1. Submit a real signup on the Vercel preview URL
2. Verify Airtable "Signups" table has the new row within 5 seconds
3. Verify all webhook payload fields are mapped correctly
4. Submit a second signup with UTM params (`?utm_source=test&utm_campaign=smoketest`) — verify they land in Airtable

### Visual regression

- Manual: open `/get-started` and `/get-started/he` in Vercel preview, screenshot at 360px / 768px / 1280px
- Automated visual regression deferred (not part of v1 scope)

### CI gates

- `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` must pass
- The existing motion-primitives test must continue to pass (no animations missing `prefers-reduced-motion` gates)
- New tests above must pass

---

## 15. Open questions for Gili

1. **Beta launch date** — what goes in the `[DATE]` placeholder? Need a real date for the CTA repeat + post-signup state. (My guess: late May or early June 2026 per the launch plan memory.)
2. **Founder photo** — phone selfie is fine, just needs a clean background. Until provided, ship with a gradient placeholder.
3. **Demo recording** — needs a 15-second clean screen recording from a staged demo account. Can be captured ahead of merge or after; v1 can ship with a placeholder GIF.
4. **Hebrew gender variant** — confirmed deferred to v2; ship masculine `אתה` for v1.
5. **Manifesto / "read while you wait" link** — confirmed deferred to v2; post-signup state has no outbound links.
6. **Make.com webhook URL** — Gili sets up the Make.com scenario per §8 and pastes the webhook URL into Vercel as `MAKE_WAITLIST_WEBHOOK_URL`. **Cannot deploy without this** — the form will return 500 if the env var is missing. ✅ Confirmed done by Gili on 2026-05-08.
7. **Signed-in user redirect** — by default, signed-in producers landing on `/get-started` are silently redirected to `/dashboard` (per §3.5). Confirm: keep this redirect (default), or drop it for total isolation? **Default decision: keep redirect.** Tell me if you want it removed.

---

## 16. Out of scope for v1

- Referral leaderboard
- UTM-aware copy variants
- Mini playable demo (clickable walkthrough)
- Manifesto page
- A/B testing infra
- Hebrew gender variant
- DB-stored signups (signups live in Airtable via Make.com — see §5–§8)
- Position counter on `/thanks` (was DB-derived; now needs Make.com response wiring or a v2 DB move)
- Confirmation email from app code (Make.com → Resend handles broadcasts; transactional "you're in" email is v2)

---

## 17. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Demo video assets not ready by merge | High | Medium | Ship with a placeholder GIF; swap when video is ready (no code change) |
| Hebrew copy needs more polish from a native speaker | Medium | Low | Founder is Israeli — can self-review. Mistake log in CLAUDE.md prevents repeat translation tells. |
| Make.com webhook URL not configured before deploy | High | High | Form returns 500 with clear error message. Deploy gate: smoke-test on Vercel preview before merging to v3-clean. §15 lists this as an open question Gili must resolve. |
| Make.com scenario disabled / quota exceeded | Low | Medium | Make.com free tier is 1,000 ops/month. Beta target is <500 signups. Above 800/month signups, upgrade to Core ($9/mo). |
| Airtable schema changes break webhook routing | Low | Low | Schema lives in Airtable UI, not code. Founder controls it. If a column is renamed in Airtable, the Make.com module needs re-mapping (visual, no code). |
| Hebrew RTL leaks into root `<html>` and breaks homepage | Medium | High | Pattern enforced: `dir="rtl"` ONLY on the `<div>` wrapper, never on `<html>`. CSS-only enforcement. |
| Form spam via bot signups | Medium | Medium | Honeypot field + IP rate limit (5/hour). Make.com sees the spam too — founder can add an Airtable view filter to hide bot rows. Add hCaptcha in v2 if volume becomes a problem. |
| Future change accidentally adds an off-funnel link, breaking isolation (§3.5) | Medium | Medium | CI test asserts zero `<a href>` / `<Link>` to non-`/get-started*` routes from the rendered ad page. PR that adds a forbidden link fails CI. Manual isolation audit on Vercel preview before every merge. |
| Search engines index the ad page → competes with homepage in SERPs | Low | Medium | `robots: { index: false, follow: false }` set in metadata. Page also excluded from `sitemap.ts`. Belt-and-suspenders. |

---

## 18. Success criteria

After 2 weeks of running ads to this page, we should see:

- **Signup conversion rate** ≥ 8% (industry benchmark for B2B waitlists is 5-10%)
- **Bounce rate** ≤ 50% (visitors who leave without scrolling)
- **Time on page** ≥ 30 seconds (means they engaged with the demo video)
- **Mobile vs desktop split** roughly 70/30 (matches Instagram/TikTok ad-source expectations)
- **Hebrew vs English split** dependent on ad spend distribution; expect Hebrew to over-index on conversion if Israeli producers are the primary ICP

If conversion is below 5% after 2 weeks, the next iteration is UTM-aware variants (v2 scope) — different headlines per ad source to test which messaging lands.

---

## 19. Implementation order

Built in this sequence (each is a separable commit):

1. **Isolated layout** — `apps/web/src/app/get-started/layout.tsx`. Minimal, no nav/footer. Sets metadata `robots: { index: false, follow: false }`. This is the foundation for the dead-end funnel pattern from §3.5.
2. **Sitemap exclusion** — modify `apps/web/src/app/sitemap.ts` to skip `/get-started*` routes
3. **tRPC procedure** — `waitlist.signup` with rate limit + honeypot + Make.com webhook POST. Gated behind `MAKE_WAITLIST_WEBHOOK_URL` env var.
4. **Shared form component** — `<WaitlistForm locale="en|he" />` with submit + redirect to `/thanks`
5. **English page skeleton** — `/get-started/page.tsx` with all 5 sections (placeholder copy)
4. **Hero animation** — split-screen chaos↔Skitza CSS
5. **Demo video section** — phone frame + lazy-load + reduced-motion fallback
6. **Pain cascade section** — copy + stack-reveal animation
7. **Founder section** — placeholder photo + copy
8. **CTA repeat section** — same form, larger
9. **English thanks page** — `/get-started/thanks/page.tsx` with confetti, name personalization
10. **Hebrew page** — `/get-started/he/page.tsx` (mirror with translated copy + RTL wrapper)
11. **Hebrew thanks page** — `/get-started/he/thanks/page.tsx`
12. **Tests** — unit tests for the tRPC procedure (mock the webhook fetch) **+ isolation test** asserting the rendered `/get-started` page has zero outbound `<a>` or `<Link>` elements pointing to routes outside `/get-started*` (enforces §3.5 rules in CI)
13. **CI verify** — `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test`
14. **Pre-deploy check** — confirm `MAKE_WAITLIST_WEBHOOK_URL` is set in Vercel (Production + Preview + Development)
15. **Vercel preview** — push branch, verify both languages on real device + Lighthouse + smoke-test the webhook (one signup → one Airtable row) **+ isolation audit**: open dev tools, query all `<a href>` and `<Link>` on the page, verify zero off-funnel destinations

**Dropped from prior version of this doc:** "DB migration" step (no DB changes) and "Resend integration" step (Make.com handles all downstream routing). **Added:** isolated layout (step 1), sitemap exclusion (step 2), isolation tests (step 12), isolation audit (step 15). Net: 15 steps total — fewer than the original 16, more comprehensive.

This will be broken into shippable tasks by the `writing-plans` skill (next step after approval of this design doc).
