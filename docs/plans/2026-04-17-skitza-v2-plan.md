# Skitza v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Skitza from a "website with features" to "software producers install and depend on" — real audio uploads, PandaDoc-grade PDF contracts, unified Deal architecture, Linear-grade UX chrome, unified Inbox, installable Tauri desktop app.

**Architecture:** Feature-first shipping order. Phase A swaps link-based audio for R2 multipart + wavesurfer. Phase B rips markdown contracts and rebuilds PandaDoc-grade PDF editor (react-pdf + dnd-kit + pdf-lib + PKCS#7 seal). Phase C unifies booking + contract + room under a top-level Deal record with Kanban. Phase D is the chrome pass (Fraunces, warm-dark, ⌘K, shortcuts, tight tables). Phase E ships Inbox + polish. Phase F activates Tauri.

**Tech Stack:** Next.js 15 · React 19 · tRPC v11 · Drizzle + Neon Postgres · Cloudflare R2 (S3 API) · react-pdf · dnd-kit · pdf-lib · @signpdf/signpdf · react-signature-canvas · wavesurfer.js · react-dropzone · next-themes · cmdk · framer-motion · Fraunces + Outfit + JetBrains Mono · Tauri 2.x · Vitest.

**Reference design doc:** `docs/plans/2026-04-17-skitza-v2-design.md`

**Idiot-Proof QA gate:** Every phase ends with the §7 QA protocol. A phase only closes when all Core tests PASS. Findings commit to `docs/qa/2026-04-17-phase-<X>.md`.

---

## Pre-flight

### Task 0.1: Branch + env sanity check

**Files:** —

**Step 1:** Verify clean main:
```bash
cd "/Users/giliasraf/Skitza 16.4"
git status        # expect: nothing to commit, working tree clean
git pull origin main
```

**Step 2:** Verify required env vars in Vercel dashboard (and `.env.local` mirror):
- `DATABASE_URL` (Neon)
- `CLERK_*` (existing)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_AUDIO`, `R2_BUCKET_DOCS`, `R2_PUBLIC_BASE` (new for this plan)
- `SIGNPDF_PEM_BASE64`, `SIGNPDF_PASSPHRASE` (added in Phase B)

**Step 3:** If R2 not yet set up, create two buckets (`skitza-audio`, `skitza-docs`) in the Cloudflare dashboard, generate an API token scoped to those buckets, stash credentials. Document in plan but do not commit creds.

**Step 4:** Run baseline: `corepack pnpm --filter web typecheck && corepack pnpm --filter web lint && corepack pnpm --filter web test`. Expect all green.

**Step 5:** Commit nothing — checkpoint only.

---

# Phase A — Real Audio Uploads

**Days:** 3

### Task A.1: Install deps

**Files:**
- Modify: `apps/web/package.json`

**Step 1:** Install:
```bash
cd "/Users/giliasraf/Skitza 16.4"
corepack pnpm --filter web add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner react-dropzone wavesurfer.js
corepack pnpm --filter web add -D @types/wavesurfer.js
```

**Step 2:** Verify lockfile clean:
```bash
git status    # expect: apps/web/package.json + pnpm-lock.yaml modified
```

**Step 3:** Commit:
```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add R2 + dropzone + wavesurfer deps"
```

### Task A.2: R2 client module

**Files:**
- Create: `apps/web/src/server/storage/r2.ts`
- Test: `apps/web/src/server/storage/r2.test.ts`

**Step 1: Test**
```ts
import { describe, it, expect } from "vitest";
import { buildAudioKey, buildDocKey } from "./r2";

describe("r2 key builders", () => {
  it("namespaces audio keys by producer + track version", () => {
    const key = buildAudioKey({ producerId: "p_123", trackVersionId: "tv_456", filename: "mix.wav" });
    expect(key).toBe("producers/p_123/tracks/tv_456/mix.wav");
  });
  it("namespaces doc keys by producer + contract", () => {
    const key = buildDocKey({ producerId: "p_123", contractId: "c_789", filename: "agreement.pdf" });
    expect(key).toBe("producers/p_123/contracts/c_789/agreement.pdf");
  });
  it("sanitizes filename path separators", () => {
    const key = buildAudioKey({ producerId: "p_1", trackVersionId: "tv_1", filename: "../../etc/passwd" });
    expect(key).not.toMatch(/\.\./);
  });
});
```

**Step 2:** Run: `corepack pnpm --filter web test r2.test` — expect FAIL.

**Step 3: Implement**
```ts
import { S3Client } from "@aws-sdk/client-s3";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export const BUCKETS = {
  audio: process.env.R2_BUCKET_AUDIO ?? "skitza-audio",
  docs: process.env.R2_BUCKET_DOCS ?? "skitza-docs",
} as const;

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.\.+/g, "_");
}

export function buildAudioKey(args: { producerId: string; trackVersionId: string; filename: string }) {
  return `producers/${args.producerId}/tracks/${args.trackVersionId}/${sanitize(args.filename)}`;
}

export function buildDocKey(args: { producerId: string; contractId: string; filename: string }) {
  return `producers/${args.producerId}/contracts/${args.contractId}/${sanitize(args.filename)}`;
}

export function publicUrl(bucket: keyof typeof BUCKETS, key: string) {
  return `${process.env.R2_PUBLIC_BASE!}/${BUCKETS[bucket]}/${key}`;
}
```

**Step 4:** Run test — expect PASS.

**Step 5:** Commit:
```bash
git add apps/web/src/server/storage
git commit -m "feat(storage): R2 client + key builders with tests"
```

### Task A.3: Schema additions

**Files:**
- Modify: `packages/db/src/schema.ts` (append to `trackVersions` + `portfolioTracks` tables)

**Step 1:** Add columns inside the existing table definitions:
```ts
// trackVersions (append after audioUrl)
audioR2Key: text("audio_r2_key"),
sizeBytes: bigint("size_bytes", { mode: "number" }),
durationMs: integer("duration_ms"),
peaksR2Key: text("peaks_r2_key"),

// portfolioTracks (append after audioUrl)
audioR2Key: text("audio_r2_key"),
sizeBytes: bigint("size_bytes", { mode: "number" }),
durationMs: integer("duration_ms"),
peaksR2Key: text("peaks_r2_key"),
```

**Step 2:** Generate migration:
```bash
corepack pnpm --filter @skitza/db drizzle:generate
```

**Step 3:** Inspect migration SQL. Expect `ALTER TABLE ... ADD COLUMN` only, no drops.

**Step 4:** Apply to dev DB:
```bash
corepack pnpm --filter @skitza/db drizzle:push
```

**Step 5:** Commit:
```bash
git add packages/db
git commit -m "feat(db): audio upload columns on trackVersions + portfolioTracks"
```

### Task A.4: Audio tRPC router

**Files:**
- Create: `apps/web/src/server/trpc/routers/audio.ts`
- Modify: `apps/web/src/server/trpc/routers/_app.ts`
- Test: `apps/web/src/server/trpc/routers/audio.test.ts`

**Step 1: Test**
```ts
import { describe, it, expect } from "vitest";
import { validateUploadInput } from "./audio";

describe("audio upload validation", () => {
  it("rejects files over 500MB", () => {
    expect(() => validateUploadInput({ filename: "x.wav", sizeBytes: 501 * 1024 * 1024, contentType: "audio/wav" }))
      .toThrow(/500 ?MB/i);
  });
  it("rejects non-audio content types", () => {
    expect(() => validateUploadInput({ filename: "x.jpg", sizeBytes: 1000, contentType: "image/jpeg" }))
      .toThrow(/audio/i);
  });
  it("accepts wav/mp3/flac/m4a/aiff", () => {
    for (const ct of ["audio/wav", "audio/mpeg", "audio/flac", "audio/x-m4a", "audio/aiff"]) {
      expect(() => validateUploadInput({ filename: "x", sizeBytes: 1000, contentType: ct })).not.toThrow();
    }
  });
});
```

**Step 2:** Run: expect FAIL.

**Step 3: Implement router** — expose `initMultipart`, `signPart`, `completeMultipart`, `abortMultipart`. All `producerProcedure`. Uses `CreateMultipartUploadCommand`, `UploadPartCommand` via `getSignedUrl`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`. On complete, update `trackVersions` row (with ownership traversal through projectTracks → deals → producers) and return the public URL.

**Step 4:** Wire into `_app.ts`: `audio: audioRouter`.

**Step 5:** Run tests — PASS.

**Step 6:** typecheck + lint clean.

**Step 7:** Commit:
```bash
git add apps/web/src/server
git commit -m "feat(trpc): audio router — multipart init/sign/complete/abort"
```

### Task A.5: Client upload hook

**Files:**
- Create: `apps/web/src/lib/audio/use-multipart-upload.ts`
- Test: `apps/web/src/lib/audio/use-multipart-upload.test.ts`

**Step 1: Test (pure function)**
```ts
import { describe, it, expect } from "vitest";
import { computeParts } from "./use-multipart-upload";

describe("computeParts", () => {
  it("splits 50MB into 10 parts of 5MB", () => {
    const parts = computeParts(50 * 1024 * 1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(10);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: 5 * 1024 * 1024 });
  });
  it("last part handles remainder", () => {
    const parts = computeParts(12 * 1024 * 1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(3);
    expect(parts[2]!.end - parts[2]!.start).toBe(2 * 1024 * 1024);
  });
});
```

**Step 2:** Run: FAIL.

**Step 3: Implement `computeParts` + `useMultipartUpload` hook.** State machine: idle → signing → uploading (per-part loop with progress) → completing → done. Persist `{ uploadId, key, completedParts }` to localStorage on each part, clear on complete. On mount, scan localStorage for incomplete uploads and offer resume.

**Step 4:** PASS.

**Step 5:** Commit:
```bash
git add apps/web/src/lib/audio
git commit -m "feat(audio): useMultipartUpload hook with resumable parts"
```

### Task A.6: AudioUploader component

**Files:**
- Create: `apps/web/src/components/audio/audio-uploader.tsx`

**Step 1: Implement** dropzone with drag/drop + click, progress bar, error states. Uses `react-dropzone` with `accept: { "audio/*": [...] }` and `maxSize: 500MB`.

**Step 2:** typecheck clean.

**Step 3:** Commit:
```bash
git add apps/web/src/components/audio/audio-uploader.tsx
git commit -m "feat(audio): AudioUploader drop-zone component"
```

### Task A.7: WaveformPlayer with wavesurfer

**Files:**
- Create: `apps/web/src/components/audio/waveform-player.tsx`
- Modify: existing track-panel + share-client to use it

**Step 1:** Client component wrapping `WaveSurfer.create` with amber progress + copper wave colors. Space-bar play/pause when focused. On click, seek.

**Step 2:** Swap existing `<audio>` tags.

**Step 3:** typecheck + lint clean.

**Step 4:** Commit:
```bash
git add apps/web/src/components/audio/waveform-player.tsx apps/web/src/app
git commit -m "feat(audio): WaveformPlayer via wavesurfer.js — replaces <audio> everywhere"
```

### Task A.8: Wire uploader into Portfolio + Project track pages

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/portfolio/*`
- Modify: `apps/web/src/app/(app)/dashboard/projects/[id]/*`

**Step 1:** Replace URL text inputs with `<AudioUploader trackVersionId={v.id} onComplete={r => updateAudioUrl(v.id, r.url)} />`. On complete, call a Server Action or tRPC mutation to persist `audioUrl + audioR2Key + sizeBytes + durationMs`.

**Step 2:** typecheck clean.

**Step 3:** Commit:
```bash
git add apps/web/src/app
git commit -m "feat(audio): portfolio + project track forms use AudioUploader"
```

### Task A.9: Phase A Idiot-Proof QA

**Files:**
- Create: `docs/qa/2026-04-17-phase-a.md`

**Step 1:** Deploy: `git push origin main`, wait for Vercel.

**Step 2:** Open incognito on **mobile viewport 375px** AND desktop. Run checklist:
```
Core:
[ ] C1 Core flow completes on mobile <60s without help text
[ ] C2 Biggest CTA = obvious, does what you'd guess
[ ] C3 Errors in plain English + recovery action
[ ] C4 Empty states: one sentence + one CTA
[ ] C5 Loading visible ≥200ms after click
[ ] C6 Success states unmissable
[ ] C7 Refresh mid-flow doesn't lose state
[ ] C8 Readable on cream AND warm-dark

Phase A:
[ ] A1 Upload 50MB WAV end-to-end
[ ] A2 Close tab at 40%, reopen → resumes
[ ] A3 Wrong file type → clear error
[ ] A4 >500MB → error mentions limit, not a 500
[ ] A5 Waveform renders within 2s
[ ] A6 Click waveform = seek
```

**Step 3:** Log PASS/WARN/FAIL in `docs/qa/2026-04-17-phase-a.md`.

**Step 4:** Fix any FAIL. Re-test.

**Step 5:** Commit:
```bash
git add docs/qa
git commit -m "qa(phase-a): idiot-proof walkthrough results"
```

---

# Phase B — Contracts PDF Editor

**Days:** 5–6

### Task B.1: Install deps + pdf.js worker

**Step 1:**
```bash
corepack pnpm --filter web add react-pdf pdfjs-dist pdf-lib @dnd-kit/core @dnd-kit/modifiers @dnd-kit/utilities react-signature-canvas @react-pdf/renderer @signpdf/signpdf node-forge
corepack pnpm --filter web add -D @types/react-signature-canvas @types/node-forge
```

**Step 2:** Copy worker: `cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs apps/web/public/`.

**Step 3:** Update Next config / middleware CSP to allow `worker-src 'self' blob:`.

**Step 4:** Create `apps/web/src/components/contracts/pdf-worker.ts`:
```ts
"use client";
import { pdfjs } from "react-pdf";
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
```

**Step 5:** Commit:
```bash
git add apps/web
git commit -m "chore(contracts): add react-pdf + dnd-kit + pdf-lib + signpdf deps"
```

### Task B.2: Hard-cut old schema

**Files:**
- Modify: `packages/db/src/schema.ts`

**Step 1:** Drop old tables — `contractTemplates`, `contracts`, `contractEvents`.

**Step 2:** Re-add new tables per design §5:

- `contracts(id, producerId, dealId?, title, pdfR2Key, finalPdfR2Key?, status, shareTokenHash, sentAt?, viewedAt?, signedAt?, cancelledAt?, createdAt, updatedAt)`
- `contractRecipients(id, contractId, email, name, role, routingOrder, signingTokenHash, viewedAt?, signedAt?, ipHash?, userAgent?, createdAt)`
- `contractFields(id, contractId, recipientId?, page, x, y, w, h [all numeric(5,2) percent], type enum, required, prefilledValue?, signedValue?, signedAt?, options jsonb?)`
- `contractEvents(id, contractId, recipientId?, event enum, ipHash?, userAgent?, metadata jsonb?, occurredAt)`

**Step 3:** Generate migration. Hand-edit to wrap in `BEGIN; ... COMMIT;`. Verify DROP happens before CREATE.

**Step 4:** Apply to dev DB:
```bash
corepack pnpm --filter @skitza/db drizzle:push
```

**Step 5:** typecheck — expect MANY errors from old contract code. That drives Phase B tasks.

**Step 6:** Commit:
```bash
git add packages/db
git commit -m "feat(db)!: hard-cut contracts schema — PDF + recipients + fields + events"
```

### Task B.3: Coord transform utility

**Files:**
- Create: `apps/web/src/lib/contracts/coords.ts`
- Test: `apps/web/src/lib/contracts/coords.test.ts`

**Step 1: Test**
```ts
import { describe, it, expect } from "vitest";
import { percentToPdfLib, pdfLibToPercent } from "./coords";

describe("coord transforms", () => {
  it("top-left percent → pdf-lib bottom-left points", () => {
    const pdf = percentToPdfLib({ x: 10, y: 10, w: 20, h: 5 }, 612, 792);
    expect(pdf.x).toBeCloseTo(61.2, 1);
    expect(pdf.y).toBeCloseTo(672.3, 1); // 792 - (15/100)*792
    expect(pdf.width).toBeCloseTo(122.4, 1);
    expect(pdf.height).toBeCloseTo(39.6, 1);
  });
  it("round trips", () => {
    const pct = { x: 25, y: 50, w: 30, h: 8 };
    const back = pdfLibToPercent(percentToPdfLib(pct, 612, 792), 612, 792);
    expect(back.x).toBeCloseTo(pct.x, 2);
    expect(back.y).toBeCloseTo(pct.y, 2);
  });
});
```

**Step 2:** Run: FAIL.

**Step 3: Implement** — see design doc.

**Step 4:** PASS.

**Step 5:** Commit:
```bash
git add apps/web/src/lib/contracts
git commit -m "feat(contracts): coord transform utils top-left% ↔ pdf-lib bottom-left pts"
```

### Task B.4: Contract router (new shape)

**Files:**
- Replace: `apps/web/src/server/trpc/routers/contract.ts`

**Procedures** (all with ownership traversal + `producerProcedure` or `publicCtx()`):

- `contract.uploadPdf({ filename, sizeBytes })` → returns { key, signedPutUrl } for direct R2 upload (pre-signs with `PutObjectCommand`, 5-min TTL).
- `contract.createDraft({ title, pdfR2Key })` → inserts contract row, status=draft, logs `created` event.
- `contract.list()` / `contract.detail({ id })` for producer dashboard.
- `contract.saveFields({ contractId, fields })` — idempotent batch upsert.
- `contract.addRecipient({ contractId, email, name, role })` → mints raw token + stores hash, returns raw once.
- `contract.removeRecipient({ id })`.
- `contract.send({ contractId })` — sets status=sent, logs `sent` per recipient.
- `contract.cancel({ contractId })`.
- `contract.publicByToken({ token })` — looks up recipient, auto-advances sent→viewed if first view, logs event; returns PDF signed-GET URL + recipient's fields (their assigned + sender-prefilled visible) + already-filled values.
- `contract.publicFillField({ token, fieldId, value })` — update signedValue, log `field_filled`.
- `contract.publicSign({ token })` — validates all required fields filled, marks recipient signed, logs event. If last recipient → call flatten (synchronous for now; queue later).

**Step 1:** typecheck drives everything.

**Step 2:** typecheck + lint clean.

**Step 3:** Commit:
```bash
git add apps/web/src/server/trpc/routers/contract.ts
git commit -m "feat(trpc): contract router — PDF upload, fields CRUD, recipients, send, sign"
```

### Task B.5: Flatten job

**Files:**
- Create: `apps/web/src/server/contracts/flatten.ts`
- Test: `apps/web/src/server/contracts/flatten.test.ts`

**Step 1: Test** — round-trip a minimal PDF with one text field and one signature image, verify output is a valid PDF of size > input.

**Step 2:** FAIL.

**Step 3: Implement**
- Load original PDF via `PDFDocument.load(bytes)`.
- For each filled field: compute `percentToPdfLib` with page's actual `getSize()`. If text-like type: `page.drawText(value, { x, y, size, font })`. If signature/initial: decode data URL → `doc.embedPng` → `page.drawImage`.
- Generate audit cert page via `@react-pdf/renderer` as React Server Component → PDF bytes → `PDFDocument.copyPages` → append.
- PKCS#7 seal via `@signpdf/signpdf` with cert from env. For Phase B1, self-signed cert is OK; upgrade to CA-issued in Phase F+.
- Upload result to R2 under `finalPdfR2Key`, update contract row.

**Step 4:** PASS.

**Step 5:** Commit:
```bash
git add apps/web/src/server/contracts
git commit -m "feat(contracts): PDF flatten + audit cert + PKCS#7 seal"
```

### Task B.6: Editor page (3-pane)

**Files:**
- Create: `apps/web/src/app/(app)/dashboard/contracts/new/page.tsx` (server: load producer, render client)
- Create: `apps/web/src/app/(app)/dashboard/contracts/new/editor.tsx` (client — 3-pane)
- Create: `apps/web/src/components/contracts/field-palette.tsx`
- Create: `apps/web/src/components/contracts/pdf-canvas.tsx`
- Create: `apps/web/src/components/contracts/field-inspector.tsx`
- Create: `apps/web/src/app/(app)/dashboard/contracts/[id]/page.tsx` (editor in edit mode)

**Implementation:**
- Step 0 of page: PDF dropzone — drag PDF → uploads → becomes editable.
- Editor layout: 240px left palette / flex center canvas (max 816px) / 320px right inspector. On mobile, stack; palette becomes bottom sheet.
- `PDFCanvas`: renders each page via react-pdf at `scale={1.5}` desktop / device-width mobile. Each page wrapped in relatively-positioned `<DndContext>` with `restrictToParentElement`. Fields are absolutely positioned `<Draggable>` elements with `%` coords. Resize handle in bottom-right corner (custom ~40-line pointer handler).
- On drag/resize end: recompute x/y/w/h as % of page bounds, call `saveFields` (debounced 2s).
- Field inspector: shows selected field's props — assignee select (Sender | Signer 1 | + new), required toggle, default/prefilled value, type-specific options.
- Autosave indicator top-right: "Saved · 2s ago".
- "Send" button disabled until at least one field assigned to at least one recipient.

**Commits** per sub-component (5 commits):
1. `feat(contracts): FieldPalette component`
2. `feat(contracts): PDFCanvas with react-pdf + dnd-kit drag/drop`
3. `feat(contracts): FieldInspector component`
4. `feat(contracts): editor page assembling palette + canvas + inspector`
5. `feat(contracts): PDF upload flow at /dashboard/contracts/new`

### Task B.7: Signer UI

**Files:**
- Replace: `apps/web/src/app/(public)/sign/[token]/page.tsx`
- Replace: `apps/web/src/app/(public)/sign/[token]/sign-client.tsx`
- Create: `apps/web/src/components/contracts/signer-view.tsx`

**Implementation:**
- Same `PDFCanvas`, read-only mode for non-assigned fields (muted outlines).
- Assigned fields render as inputs:
  - text/number → inline `<input>`
  - checkbox → checkbox
  - dropdown → `<select>`
  - date → auto-filled with "today" on open (editable)
  - signature/initial → tap opens `<SignatureModal>` using `react-signature-canvas`; save embeds data URL
- Progress indicator top: "X of Y fields filled" + animated fill bar
- Mobile: `<meta viewport content="width=device-width, initial-scale=1, maximum-scale=1">`, `touch-action: none` on canvas, `scrollIntoView({block:'center'})` on field focus
- Minimum 44×44 tap target: scale up via CSS `min()` if stored % would be smaller on current viewport
- Final submit: server validates all required filled, then shows copper seal animation → "Signed. You'll get a PDF emailed."

**Commit:**
```bash
git add apps/web/src/app/(public)/sign apps/web/src/components/contracts/signer-view.tsx
git commit -m "feat(contracts): signer view — PDF render + inline field inputs + signature modal"
```

### Task B.8: Rip old markdown UI

**Files:**
- Replace: `apps/web/src/app/(app)/dashboard/contracts/page.tsx` — list contracts with new schema
- Delete: old `contracts-client.tsx`
- Delete: old per-template files if any

**Step 1:** Rewrite list to show: title, recipient, status badge, sent date, signed date, Cancel/View.

**Step 2:** typecheck clean — follow errors.

**Step 3:** Commit:
```bash
git add -A
git commit -m "feat(contracts)!: rip markdown UI — PDF editor + signer view live"
```

### Task B.9: Phase B Idiot-Proof QA

**Files:**
- Create: `docs/qa/2026-04-17-phase-b.md`

**Step 1:** Deploy, push, wait.

**Step 2:** Walk through on **real mobile device** (not just 375px viewport — signing is the highest-stakes mobile flow). Run:
```
[ ] B1 Upload PDF → first field place-able <30s
[ ] B2 Drag sig field, resize, save, refresh → field persists in same spot
[ ] B3 Send → copy link → incognito phone → PDF renders readable → sign → success
[ ] B4 Finger sig doesn't scroll-hijack, tap targets ≥44px
[ ] B5 Full flow <2 min cold
[ ] B6 Cancel mid-signing + reopen = resume where left off
[ ] B7 Completed flattened PDF with audit page within 10s
[ ] All Core C1–C8
```

**Step 3:** Fix FAILs. Re-test.

**Step 4:** Commit:
```bash
git add docs/qa
git commit -m "qa(phase-b): idiot-proof walkthrough results"
```

---

# Phase C — Deal Architecture

**Days:** 3

### Task C.1: DB rename + deal stage enum + client fields

**Files:**
- Modify: `packages/db/src/schema.ts`

**Step 1:** Generate migration that renames `projects` → `deals`, renames child FK columns, adds `stage`, `clientEmail`, `clientName`. Set `deal_id` FKs on `bookings` and `contracts` (they should already be nullable from Phase B).

**Migration SQL sketch:**
```sql
BEGIN;
ALTER TABLE projects RENAME TO deals;
ALTER TABLE project_tracks RENAME COLUMN project_id TO deal_id;
ALTER TABLE project_tracks RENAME TO deal_tracks;
ALTER TABLE deals ADD COLUMN stage text NOT NULL DEFAULT 'lead';
ALTER TABLE deals ADD COLUMN client_email text;
ALTER TABLE deals ADD COLUMN client_name text;
ALTER TABLE bookings ADD COLUMN deal_id text REFERENCES deals(id);
-- contracts already has nullable deal_id from Phase B
COMMIT;
```

**Step 2:** Update Drizzle schema exports — rename every `projects` → `deals`.

**Step 3:** Apply to dev DB.

**Step 4:** typecheck — follow all import errors.

**Step 5:** Commit:
```bash
git add packages/db
git commit -m "feat(db)!: rename projects→deals + stage enum + client cache fields"
```

### Task C.2: Deal router

**Files:**
- Rename: `apps/web/src/server/trpc/routers/project.ts` → `deal.ts`
- Modify: `_app.ts`

**Step 1:** Rename file + update `projectRouter` → `dealRouter` + `project:` → `deal:` in `_app.ts`.

**Step 2:** Add `deal.setStage({ id, stage })` — logs a status change event.

**Step 3:** Add `deal.listByStage()` — returns `Record<Stage, Deal[]>` for Kanban.

**Step 4:** typecheck — follow repo-wide import errors, fix.

**Step 5:** Commit:
```bash
git add apps/web/src/server
git commit -m "refactor(trpc)!: project router → deal router + stage management"
```

### Task C.3: Deal detail page with tabs

**Files:**
- Move: `apps/web/src/app/(app)/dashboard/projects/[id]/*` → `apps/web/src/app/(app)/dashboard/deals/[id]/*`
- Create: `apps/web/src/app/(app)/dashboard/deals/[id]/layout.tsx`

**Step 1:** Tab bar: Overview / Audio / Contract / Invoices / Activity.

**Step 2:** Overview: client info, stage, last activity, upcoming session, contract status.

**Step 3:** Audio: existing track panel.

**Step 4:** Contract: list filtered by dealId + "New contract for this deal" button pre-fills dealId.

**Step 5:** Activity: chronological event list.

**Step 6:** Add `/dashboard/projects/[id]` redirect to `/dashboard/deals/[id]`.

**Step 7:** Commit:
```bash
git add apps/web/src/app
git commit -m "feat(deals): deal detail with Overview/Audio/Contract/Invoices/Activity tabs"
```

### Task C.4: Pipeline Kanban at /dashboard

**Files:**
- Replace: `apps/web/src/app/(app)/dashboard/page.tsx`

**Step 1:** Columns: Lead / Booked / Contract-sent / In-production / Final-review / Paid / Archived.

**Step 2:** Card shows client name, title, stage duration, last activity, stage-specific CTA (e.g. "Send contract" in Booked column).

**Step 3:** dnd-kit Kanban — drag to column → `deal.setStage`.

**Step 4:** "New deal" button + search + ⌘K hint.

**Step 5:** typecheck + lint clean.

**Step 6:** Commit:
```bash
git add apps/web/src/app/(app)/dashboard/page.tsx
git commit -m "feat(dashboard): pipeline Kanban of deals by stage"
```

### Task C.5: Client contacts cache

**Files:**
- Modify: `packages/db/src/schema.ts` — add `clientContacts`
- Create: `apps/web/src/server/trpc/routers/client-contacts.ts`

**Step 1:** Schema: `(id, producerId, emailHash, name, email, firstSeenAt, lastSeenAt)` with composite UNIQUE (producerId, emailHash).

**Step 2:** Server helper `recordContact(producerId, email, name)` — upsert. Called from every magic-link claim, contract recipient add, booking submit.

**Step 3:** Expose `clientContacts.list()` for autocomplete.

**Step 4:** Wire autocomplete into contract Send and booking creation forms (pre-fills name on email match).

**Step 5:** Commit:
```bash
git add packages/db apps/web/src
git commit -m "feat(clients): contact cache — pre-fill sends for returning artists"
```

### Task C.6: Phase C Idiot-Proof QA

**Files:**
- Create: `docs/qa/2026-04-17-phase-c.md`

```
[ ] C1 Dashboard = Kanban visible, no empty-chrome if seeded
[ ] C2 Drag card to next column → persists on refresh
[ ] C3 Click deal → tabs show state within 300ms
[ ] C4 From a deal, create booking + contract + room in any order, all show in tabs
[ ] C5 /dashboard/projects → redirects to /dashboard/deals
[ ] All Core C1–C8
```

**Commit QA doc.**

---

# Phase D — Software-Feel Chrome Pass

**Days:** 5

### Task D.1: Palette sharpening

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Step 1:** Update `:root` variables to sharpened cream + amber WCAG-AA values; add `[data-theme="chrome-dark"]` warm-dark variables. See design §D.1 for exact values.

**Step 2:** DevTools contrast check on landing page. Fix fails.

**Step 3:** Commit:
```bash
git add apps/web/src/app/globals.css
git commit -m "feat(theme): sharpen palette — WCAG AA amber, warm-dark mode"
```

### Task D.2: Fonts — Fraunces + Outfit + JetBrains Mono

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/tailwind.config.ts` (or wherever font-display is mapped)

**Step 1:**
```tsx
import { Fraunces, Outfit, JetBrains_Mono } from "next/font/google";
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
```

**Step 2:** html className: `${fraunces.variable} ${outfit.variable} ${mono.variable}`.

**Step 3:** Grep repo for `Syne` and remove.

**Step 4:** Commit:
```bash
git add apps/web/src/app apps/web/tailwind.config.ts
git commit -m "feat(type): Syne → Fraunces (variable serif) + JetBrains Mono for numerics"
```

### Task D.3: Dark mode via next-themes

**Step 1:** Install: `corepack pnpm --filter web add next-themes`.

**Step 2:** Wrap `layout.tsx` root in `<ThemeProvider attribute="data-theme" value={{ light: "chrome-light", dark: "chrome-dark" }} defaultTheme="light" enableSystem>`. Adds `suppressHydrationWarning` on `<html>`.

**Step 3:** Create `components/shell/theme-toggle.tsx` using `useTheme()` — button with sun/moon icon toggles.

**Step 4:** Add to AppShell bottom.

**Step 5:** Commit:
```bash
git add apps/web/src
git commit -m "feat(theme): dark mode toggle via next-themes (no FOUC, no inline scripts)"
```

### Task D.4: Command palette ⌘K

**Files:**
- Install: `cmdk`
- Create: `apps/web/src/components/shell/command-palette.tsx`
- Create: `apps/web/src/server/trpc/routers/palette.ts` — search procedure
- Modify: `app-shell.tsx` — mount palette + keybind

**Step 1:** CommandPalette uses `cmdk`. Groups: Recent / Deals / Clients / Contracts / Actions.

**Step 2:** Global hotkey: `useEffect` listens for `⌘K` / `Ctrl+K`, sets open=true. Escape closes.

**Step 3:** Context prefixes: `> action`, `# deal`, `@ client`, `$ contract`, `~ file`.

**Step 4:** `palette.search({ q })` tRPC: unions deals + contacts + contracts + fixed actions, fuzzy-matches server-side, returns top 20.

**Step 5:** Row: [icon] [primary text] ...spacer... [mono shortcut hint].

**Step 6:** Commit:
```bash
git add apps/web/src
git commit -m "feat(ui): command palette ⌘K — fuzzy search + context prefixes"
```

### Task D.5: Keyboard shortcuts layer

**Files:**
- Create: `apps/web/src/lib/keyboard/shortcut-context.tsx`
- Create: `apps/web/src/components/shell/shortcut-cheatsheet.tsx`

**Step 1:** Global handler with state machine for two-key sequences (`g` then `p/i/l/s` → /pipeline / /inbox / /library / /settings).

**Step 2:** `?` or `⌘/` opens cheatsheet overlay.

**Step 3:** `c` create (context-aware), `/` focus search, `j/k` list-nav, space play/pause audio.

**Step 4:** Ignore when input/textarea focused.

**Step 5:** Commit:
```bash
git add apps/web/src
git commit -m "feat(ui): global keyboard shortcuts + cheatsheet (? / ⌘/)"
```

### Task D.6: Collapsible sidebar

**Files:**
- Modify: `apps/web/src/components/shell/app-shell.tsx`

**Step 1:** Collapse button top. Collapsed = 56px icon rail. Expanded = 240px with labels.

**Step 2:** Persist to localStorage `skitza-sidebar-collapsed`.

**Step 3:** Hover on collapsed → tooltip, not full expand.

**Step 4:** Mobile: overlay sheet via Radix Dialog.

**Step 5:** Commit:
```bash
git add apps/web/src/components/shell
git commit -m "feat(shell): collapsible sidebar with persisted state"
```

### Task D.7: Dense table style

**Files:**
- Modify: deals list, contracts list, bookings list

**Step 1:** 44px row, 13px body, `tabular-nums` on numerics. Hover `--surface-2` tint.

**Step 2:** Sticky filter chip bar at top of every list.

**Step 3:** Commit:
```bash
git add apps/web/src
git commit -m "feat(ui): dense table style across dashboard lists"
```

### Task D.8: Motion pass

**Files:**
- Install: `framer-motion`
- Create: `apps/web/src/components/contracts/signed-seal.tsx`
- Modify: signer view to trigger on success

**Step 1:** `<SignedSeal />` — full-screen cream overlay, copper seal scales 0.8→1 over 400ms spring. Respects `prefers-reduced-motion`.

**Step 2:** All other transitions: 120-180ms ease-out via CSS.

**Step 3:** Commit:
```bash
git add apps/web/src
git commit -m "feat(motion): subtle defaults + one expressive moment (contract seal)"
```

### Task D.9: Phase D QA

**Files:**
- Create: `docs/qa/2026-04-17-phase-d.md`

```
[ ] D1 ⌘K opens <100ms, filters <50ms/keystroke
[ ] D2 g p/i/l/s navigates correctly
[ ] D3 Dark mode toggle works cleanly, no FOUC
[ ] D4 Mobile: sidebar collapses to rail + overlay, no h-scroll
[ ] D5 Fraunces + Outfit + Mono all loading fast
[ ] D6 Contrast WCAG AA on both modes
[ ] All Core C1–C8
```

---

# Phase E — Inbox + Polish

**Days:** 2

### Task E.1: Inbox schema + emit helpers

**Files:**
- Modify: `packages/db/src/schema.ts` — `notifications` table
- Create: `apps/web/src/server/notifications/emit.ts`

**Step 1:** `notifications(id, producerId, kind, dealId?, contractId?, trackVersionId?, commentId?, title, body, readAt?, archivedAt?, createdAt)` with index on `(producerId, archivedAt)`.

**Step 2:** `emit.commentCreated(...)`, `emit.contractSigned(...)`, `emit.bookingRequested(...)` — each inserts a row. Call from existing mutation sites.

**Step 3:** Commit:
```bash
git add packages/db apps/web/src/server/notifications
git commit -m "feat(inbox): notifications table + emit helpers"
```

### Task E.2: Inbox router + UI

**Files:**
- Create: `apps/web/src/server/trpc/routers/inbox.ts`
- Create: `apps/web/src/app/(app)/dashboard/inbox/page.tsx`
- Create: `apps/web/src/app/(app)/dashboard/inbox/inbox-list.tsx`

**Step 1:** `inbox.list({ archived? })`, `inbox.markRead({ id })`, `inbox.archive({ id })`, `inbox.reply({ id, body })` (comment kind).

**Step 2:** UI: list with j/k nav, `e` archives (optimistic), `r` inline reply for comment kind, click lands on context with highlight.

**Step 3:** Unread badge on sidebar nav.

**Step 4:** Commit:
```bash
git add apps/web/src
git commit -m "feat(inbox): unified inbox — list + reply + archive, keyboard-first"
```

### Task E.3: Empty states + error boundaries sweep

**Step 1:** Grep every page: any empty array → one-sentence + one-CTA empty state. Any catch → user-facing recovery action.

**Step 2:** Error boundaries on every `(app)` route layout.

**Step 3:** Commit:
```bash
git add apps/web/src
git commit -m "feat(ui): empty states + error boundary sweep"
```

### Task E.4: Phase E QA

```
[ ] E1 New comment on track → inbox item appears ≤3s
[ ] E2 j/k nav, e archive, r reply inline
[ ] E3 Click inbox item → lands on context with highlight
[ ] All Core C1–C8
```

Commit findings.

---

# Phase F — Tauri Desktop Activation

**Days:** 3

### Task F.1: File drop from Finder

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json` — `fileDropEnabled: true`
- Create: `apps/web/src/lib/desktop/bridge.ts` — detects Tauri, wraps event API

**Step 1:** In web app, when running in Tauri, subscribe to `tauri://file-drop` event. Broadcast via CustomEvent to whichever `AudioUploader` is mounted.

**Step 2:** Feature-flag via `typeof window !== 'undefined' && '__TAURI__' in window`.

**Step 3:** Commit:
```bash
git add apps/desktop apps/web/src/lib/desktop
git commit -m "feat(tauri): Finder file drop → AudioUploader"
```

### Task F.2: Native notifications

**Files:**
- Modify: `tauri.conf.json` notification permission
- Modify: `apps/web/src/lib/desktop/notifications.ts`

**Step 1:** If Tauri, use `window.__TAURI__.notification.sendNotification`. Else fall back to Web `Notification` API.

**Step 2:** Call from inbox emit helpers on critical events.

**Step 3:** Commit.

### Task F.3: Menu bar

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`

**Step 1:** Native menu: File (New Deal, New Contract) / Edit (standard) / View (Toggle Dark, Toggle Sidebar) / Window.

**Step 2:** Each dispatches an `emit`, web listens and routes.

**Step 3:** Commit.

### Task F.4: Global shortcut

**Files:**
- Modify: `tauri.conf.json` + `main.rs`

**Step 1:** Register `⌥⌘Space` global shortcut. On press, show window + emit `open-palette`.

**Step 2:** Commit.

### Task F.5: DMG + MSI builds in CI

**Files:**
- Create: `.github/workflows/tauri-release.yml`

**Step 1:** On `v*` tag push, matrix macOS + Windows, run `pnpm tauri build`, upload artifacts.

**Step 2:** Landing page "Download" fetches latest release URL via GitHub API.

**Step 3:** Commit.

### Task F.6: Phase F QA

Install DMG/MSI locally, test F1–F4. Commit findings.

---

# Wrap

### Task W.1: Full regression

**Step 1:** `corepack pnpm --filter web test && corepack pnpm --filter web typecheck && corepack pnpm --filter web lint` all green.

**Step 2:** Walk user's 5 complaints end-to-end:
1. Real audio uploads: ✅
2. Software feel: ✅
3. PDF contracts: ✅
4. UI not cheap: ✅
5. Flow clear: ✅

**Step 3:** Update landing copy if flow changed materially.

### Task W.2: Final delta doc

**Files:**
- Create: `docs/plans/2026-04-17-phase-abcdef-delta.md`

Summary of all six phases + QA outcomes + screenshots.

---

## Execution Discipline

- Each task = single commit (or small logical group).
- `typecheck + lint + test` green after every task.
- Phase gates: no advancing until QA PASSes.
- Follow repo patterns: `producerProcedure`, ownership traversal, sha256 tokens, `stripUndefined()`, `publicCtx()`.
- Commit messages: conventional (`feat`, `fix`, `refactor`, `chore`, `docs`, `qa`, `!` for breaking).

**Total: ~21 days of disciplined work.**
