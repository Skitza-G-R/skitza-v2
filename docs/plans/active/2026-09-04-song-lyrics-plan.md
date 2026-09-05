# Song lyrics implementation plan (SK-305)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give every song one set of lyrics that the producer and the artist can both read and rewrite — from a field in the Upload new Version modal, and from a Lyrics row on the song page that opens an editing popup.

**Architecture:** Three columns on `project_tracks` (the song row). One domain function `setSongLyrics` doing an optimistic compare-and-set on `lyrics_updated_at`; the router does authorization, the domain does the rule. Lyrics reach the client on the existing `SongPageData` wire payload and save through a **separate** call that never touches the guarded version-upload payload.

**Tech stack:** Drizzle + raw SQL migration, tRPC v11, Next 15 server actions, React 19, Tailwind v4, Vitest.

Design: `docs/plans/active/2026-09-04-song-lyrics-design.md`
Linear: SK-305
Branch: `giasraf/sk-305-song-lyrics-a-box-in-the-upload-modal-and-an-editable-lyrics` (already created off `origin/v3-clean`)

---

## Rules for this branch

- **Never** add a field to the `first-version-upload.ts` completion payload. SK-302 did that
  and every production booking rolled back. Lyrics save in their own call, after the upload.
- Migration number is **0062**. `0061` belongs to the open SK-302 PR (#418).
- **Never** run `pnpm -F db db:migrate` or `drizzle-kit migrate`. Use `$skitza-migrate`.
- Colors are bare RGB triplets: `rgb(var(--token))`, never bare `var(--token)`.
  `--surface-card`, `--text-muted`, `--text-strong`, `--surface-hover`, `--bg-hover` do **not** exist.
- Verify with `$skitza-verify` before opening the PR. Vercel runs ESLint at `--max-warnings 0`.
- Commit after every task with an explicit file list. Never `git add -A`.

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts` (the `projectTracks` table, ~line 2289)
- Create: `packages/db/drizzle/0062_song_lyrics.sql`

**Step 1: Add the columns to the Drizzle table**

In `projectTracks`, directly after the `artworkObjectEtag` line and before `releasedAt`:

```ts
    // SK-305. One lyrics sheet per song, shared by every version. The two
    // stamps are not decoration: `lyricsUpdatedAt` is the compare-and-set
    // token that stops a producer and an artist silently overwriting each
    // other. Role rather than a user id because a producer lives in
    // `producers` and an artist in `client_contacts` — no single FK covers
    // both, and each page already knows the other side's display name.
    lyrics: text("lyrics"),
    lyricsUpdatedAt: timestamp("lyrics_updated_at", { withTimezone: true }),
    lyricsUpdatedBy: text("lyrics_updated_by").$type<"producer" | "artist">(),
```

**Step 2: Add the shape CHECK to the same table's constraint block**

Alongside `artworkIdentityShape`:

```ts
    lyricsStampShape: check(
      "project_tracks_lyrics_stamp_shape",
      sql`(
        (${t.lyricsUpdatedAt} IS NULL AND ${t.lyricsUpdatedBy} IS NULL)
        OR (${t.lyricsUpdatedAt} IS NOT NULL AND ${t.lyricsUpdatedBy} IS NOT NULL)
      ) AND (
        ${t.lyrics} IS NULL OR ${t.lyricsUpdatedAt} IS NOT NULL
      )`,
    ),
```

**Step 3: Write the migration**

`packages/db/drizzle/0062_song_lyrics.sql`:

```sql
-- SK-305: one lyrics sheet per song, editable by the producer and the artist.
--
-- Lyrics belong to the SONG (project_tracks), not to a version. A producer
-- thinks "the words of this song", not "the words of V2", and one sheet means
-- fixing a typo fixes it everywhere instead of leaving V1 and V2 stale.
--
-- lyrics_updated_at is load-bearing, not cosmetic. Both a producer and an
-- artist can save, so every write is a compare-and-set against the value the
-- editor loaded. A mismatch means somebody saved first and the second save is
-- refused instead of silently replacing the whole sheet.
--
-- lyrics_updated_by stores the ROLE, not a user id: a producer row lives in
-- `producers` and an artist row in `client_contacts`, so no single foreign key
-- covers both, and each side's page already knows the other's display name.
--
-- Additive only. Every existing song keeps all three columns NULL, which the
-- shape constraint below accepts.

ALTER TABLE "project_tracks" ADD COLUMN IF NOT EXISTS "lyrics" text;
ALTER TABLE "project_tracks" ADD COLUMN IF NOT EXISTS "lyrics_updated_at" timestamp with time zone;
ALTER TABLE "project_tracks" ADD COLUMN IF NOT EXISTS "lyrics_updated_by" text;

-- Both stamps travel together, and lyrics can never exist unstamped. Clearing
-- the sheet sets lyrics back to NULL but KEEPS the stamps, so "who emptied
-- this, and when" survives.
ALTER TABLE "project_tracks" DROP CONSTRAINT IF EXISTS "project_tracks_lyrics_stamp_shape";
ALTER TABLE "project_tracks" ADD CONSTRAINT "project_tracks_lyrics_stamp_shape" CHECK (
  (
    ("lyrics_updated_at" IS NULL AND "lyrics_updated_by" IS NULL)
    OR ("lyrics_updated_at" IS NOT NULL AND "lyrics_updated_by" IS NOT NULL)
  )
  AND ("lyrics" IS NULL OR "lyrics_updated_at" IS NOT NULL)
);

-- Exactly the two roles the application writes. An unknown value here would
-- mean a caller invented a third writer, which should fail loudly.
ALTER TABLE "project_tracks" DROP CONSTRAINT IF EXISTS "project_tracks_lyrics_updated_by_allowed";
ALTER TABLE "project_tracks" ADD CONSTRAINT "project_tracks_lyrics_updated_by_allowed" CHECK (
  "lyrics_updated_by" IS NULL OR "lyrics_updated_by" IN ('producer', 'artist')
);
```

**Step 4: Typecheck the package**

Run: `cd packages/db && pnpm typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0062_song_lyrics.sql
git commit -m "feat(db): SK-305 add song lyrics columns and their shape constraint"
```

---

### Task 2: `normalizeLyrics` pure helper

**Files:**
- Modify: `apps/web/src/server/domain/song-management/service.ts`
- Test: `apps/web/src/server/domain/song-management/__tests__/service.test.ts`

**Step 1: Write the failing tests**

Append to `service.test.ts`:

```ts
describe("normalizeLyrics", () => {
  it("keeps the words and the line breaks", () => {
    expect(normalizeLyrics("one\ntwo")).toBe("one\ntwo");
  });

  it("turns blank input into null so the song reads as having no lyrics", () => {
    expect(normalizeLyrics("")).toBeNull();
    expect(normalizeLyrics("   \n \n  ")).toBeNull();
    expect(normalizeLyrics(null)).toBeNull();
  });

  it("normalises Windows line endings so a paste does not double the count", () => {
    expect(normalizeLyrics("one\r\ntwo")).toBe("one\ntwo");
  });

  it("trims the outer whitespace but never the inside", () => {
    expect(normalizeLyrics("\n  one\n\n  two  \n")).toBe("one\n\n  two");
  });

  it("rejects anything past the cap instead of silently truncating a song", () => {
    expect(() => normalizeLyrics("x".repeat(8001))).toThrow(SongManagementDomainError);
  });

  it("accepts exactly the cap", () => {
    expect(normalizeLyrics("x".repeat(8000))?.length).toBe(8000);
  });
});
```

Add `normalizeLyrics` and `LYRICS_MAX_LENGTH` to that file's import from `../service`.

**Step 2: Run and watch it fail**

Run: `cd apps/web && pnpm vitest run src/server/domain/song-management/__tests__/service.test.ts`
Expected: FAIL — `normalizeLyrics is not a function`.

**Step 3: Implement**

In `service.ts`:

```ts
export const LYRICS_MAX_LENGTH = 8000;

// Trim the outside, keep the inside. Blank verses and leading spaces are how
// people lay a song out on the page, so only the outer edges are touched.
// Truncating past the cap would quietly lose the last verse, so it throws.
export function normalizeLyrics(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const normalized = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (normalized === "") return null;
  if (normalized.length > LYRICS_MAX_LENGTH) {
    throw new SongManagementDomainError(
      "INVALID_INPUT",
      `Lyrics can be up to ${String(LYRICS_MAX_LENGTH)} characters.`,
    );
  }
  return normalized;
}
```

**Step 4: Run and watch it pass**

Run: same command. Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/server/domain/song-management/service.ts apps/web/src/server/domain/song-management/__tests__/service.test.ts
git commit -m "feat(music): SK-305 normalize lyrics input"
```

---

### Task 3: `setSongLyrics` domain function

**Files:**
- Modify: `apps/web/src/server/domain/song-management/db.ts` (after `updateSongMetadata`, ~line 293)
- Test: `apps/web/src/server/domain/song-management/__tests__/real-db.integration.test.ts`

**Step 1: Write the implementation**

```ts
export type SetSongLyricsResult =
  | Readonly<{
      ok: true;
      lyrics: string | null;
      lyricsUpdatedAt: Date;
      lyricsUpdatedBy: "producer" | "artist";
    }>
  | Readonly<{
      ok: false;
      reason: "stale";
      lyrics: string | null;
      lyricsUpdatedAt: Date | null;
      lyricsUpdatedBy: "producer" | "artist" | null;
    }>;

// Optimistic concurrency, not a lock. The editor was handed the
// `lyricsUpdatedAt` it loaded; the UPDATE only fires while the row still
// carries that exact value. Zero rows updated means somebody else saved
// first — we return their current sheet so the caller can show it instead of
// blindly replacing it.
//
// `IS NOT DISTINCT FROM` rather than `=` because the first ever save compares
// against NULL, and NULL = NULL is not true in SQL.
//
// Authorization is the caller's job. Both roles route through here, and the
// producer/artist routers each resolve `producerId` their own way before
// calling.
export async function setSongLyrics(
  db: Db,
  input: Readonly<{
    producerId: string;
    trackId: string;
    projectId?: string;
    lyrics: string | null;
    expectedUpdatedAt: Date | null;
    updatedBy: "producer" | "artist";
    changedAt: Date;
  }>,
): Promise<SetSongLyricsResult> {
  const lyrics = normalizeLyrics(input.lyrics);
  return db.transaction(async (tx) => {
    const scope = await discoverSongScope(tx, input);
    if (input.projectId !== undefined && scope.projectId !== input.projectId) notFound();
    await lockSong(tx, { producerId: input.producerId, scope });
    const [updated] = await tx
      .update(projectTracks)
      .set({
        lyrics,
        lyricsUpdatedAt: input.changedAt,
        lyricsUpdatedBy: input.updatedBy,
      })
      .where(
        and(
          eq(projectTracks.id, scope.trackId),
          eq(projectTracks.projectId, scope.projectId),
          eq(projectTracks.purchaseId, scope.purchaseId),
          sql`${projectTracks.lyricsUpdatedAt} IS NOT DISTINCT FROM ${input.expectedUpdatedAt}`,
        ),
      )
      .returning({
        lyrics: projectTracks.lyrics,
        lyricsUpdatedAt: projectTracks.lyricsUpdatedAt,
        lyricsUpdatedBy: projectTracks.lyricsUpdatedBy,
      });

    if (!updated) {
      const [current] = await tx
        .select({
          lyrics: projectTracks.lyrics,
          lyricsUpdatedAt: projectTracks.lyricsUpdatedAt,
          lyricsUpdatedBy: projectTracks.lyricsUpdatedBy,
        })
        .from(projectTracks)
        .where(eq(projectTracks.id, scope.trackId))
        .limit(1);
      if (!current) integrityError("The song disappeared while its lyrics were being saved");
      return {
        ok: false as const,
        reason: "stale" as const,
        lyrics: current.lyrics,
        lyricsUpdatedAt: current.lyricsUpdatedAt,
        lyricsUpdatedBy: current.lyricsUpdatedBy,
      };
    }

    await touchProject(tx, {
      producerId: input.producerId,
      projectId: scope.projectId,
      changedAt: input.changedAt,
    });
    if (!updated.lyricsUpdatedAt || !updated.lyricsUpdatedBy) {
      integrityError("Lyrics saved without their stamp");
    }
    return {
      ok: true as const,
      lyrics: updated.lyrics,
      lyricsUpdatedAt: updated.lyricsUpdatedAt,
      lyricsUpdatedBy: updated.lyricsUpdatedBy,
    };
  });
}
```

Import `normalizeLyrics` from `./service` at the top of `db.ts`.

**Step 2: Write the integration test**

In `real-db.integration.test.ts`, add `setSongLyrics` to the `../db` import and add:

```ts
  it("saves lyrics, then refuses a second save that started from a stale sheet", async () => {
    const first = await setSongLyrics(db, {
      producerId,
      trackId,
      lyrics: "one\ntwo",
      expectedUpdatedAt: null,
      updatedBy: "producer",
      changedAt: new Date("2026-09-04T10:00:00Z"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected the first save to win");

    // The artist opened the popup before the producer saved, so they still
    // hold the original NULL stamp. Their save must not replace the sheet.
    const stale = await setSongLyrics(db, {
      producerId,
      trackId,
      lyrics: "totally different words",
      expectedUpdatedAt: null,
      updatedBy: "artist",
      changedAt: new Date("2026-09-04T10:01:00Z"),
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("expected the stale save to be refused");
    expect(stale.reason).toBe("stale");
    expect(stale.lyrics).toBe("one\ntwo");
    expect(stale.lyricsUpdatedBy).toBe("producer");

    // Re-sending with the fresh stamp is the "save mine anyway" path.
    const retry = await setSongLyrics(db, {
      producerId,
      trackId,
      lyrics: "totally different words",
      expectedUpdatedAt: first.lyricsUpdatedAt,
      updatedBy: "artist",
      changedAt: new Date("2026-09-04T10:02:00Z"),
    });
    expect(retry.ok).toBe(true);
  });

  it("clearing the sheet keeps the stamps so we still know who emptied it", async () => {
    const written = await setSongLyrics(db, {
      producerId,
      trackId,
      lyrics: "words",
      expectedUpdatedAt: null,
      updatedBy: "producer",
      changedAt: new Date("2026-09-04T11:00:00Z"),
    });
    if (!written.ok) throw new Error("expected the write to win");
    const cleared = await setSongLyrics(db, {
      producerId,
      trackId,
      lyrics: "   ",
      expectedUpdatedAt: written.lyricsUpdatedAt,
      updatedBy: "artist",
      changedAt: new Date("2026-09-04T11:01:00Z"),
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) throw new Error("expected the clear to win");
    expect(cleared.lyrics).toBeNull();
    expect(cleared.lyricsUpdatedBy).toBe("artist");
  });
```

Reuse whatever `producerId` / `trackId` fixtures that file already seeds; do not invent new ones.

**Step 3: Run it against a throwaway Postgres**

This suite skips unless `DATABASE_URL_TEST` is set, and it must **never** point at production.

```bash
export PGDATA=/private/tmp/claude-501/sk305-pg
export PGSOCKET=/var/tmp/sk305
mkdir -p "$PGSOCKET"
LC_ALL=C initdb -U postgres "$PGDATA"
pg_ctl -D "$PGDATA" -o "-k $PGSOCKET -h ''" -l "$PGDATA/log" start
createdb -h "$PGSOCKET" -U postgres sk305
```

`LC_ALL=C` and the `-k /var/tmp` socket directory are both required — the default
locale and the long default socket path each break `initdb` on this machine.

Apply the schema, then:

```bash
cd apps/web && DATABASE_URL_TEST="postgres://postgres@localhost/sk305?host=$PGSOCKET" \
  pnpm vitest run src/server/domain/song-management/__tests__/real-db.integration.test.ts
```

Expected: the two new tests PASS, not skip. **If the output says "skipped", the
compare-and-set is unproven — stop and fix the database URL before moving on.**

Tear down with `pg_ctl -D "$PGDATA" stop && rm -rf "$PGDATA" "$PGSOCKET"`.

**Step 4: Commit**

```bash
git add apps/web/src/server/domain/song-management/db.ts apps/web/src/server/domain/song-management/__tests__/real-db.integration.test.ts
git commit -m "feat(music): SK-305 save song lyrics with a compare-and-set guard"
```

---

### Task 4: Producer tRPC procedure

**Files:**
- Modify: `apps/web/src/server/trpc/routers/project.ts`

**Step 1: Add the procedure after `updateVersionLabel` (~line 958)**

```ts
  // SK-305. `expectedUpdatedAtIso` is the stamp the editor loaded. It is the
  // whole clash guard — see setSongLyrics. A stale result is a normal return
  // value, not an error, because the caller has to render the other side's
  // words next to the ones still sitting in the textarea.
  setSongLyrics: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        lyrics: z.string().max(LYRICS_MAX_LENGTH).nullable(),
        expectedUpdatedAtIso: z.string().datetime().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await setSongLyrics(ctx.db, {
          producerId: ctx.producerId,
          trackId: input.trackId,
          projectId: input.projectId,
          lyrics: input.lyrics,
          expectedUpdatedAt: input.expectedUpdatedAtIso
            ? new Date(input.expectedUpdatedAtIso)
            : null,
          updatedBy: "producer",
          changedAt: new Date(),
        });
        return toLyricsWire(result);
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),
```

**Step 2: Add the shared wire mapper near `mapSongManagementDomainError` (~line 192)**

```ts
// Dates cross tRPC as ISO strings. Both roles return the same shape so one
// dialog component can consume either.
function toLyricsWire(result: SetSongLyricsResult) {
  return result.ok
    ? {
        ok: true as const,
        lyrics: result.lyrics,
        lyricsUpdatedAtIso: result.lyricsUpdatedAt.toISOString(),
        lyricsUpdatedBy: result.lyricsUpdatedBy,
      }
    : {
        ok: false as const,
        reason: "stale" as const,
        lyrics: result.lyrics,
        lyricsUpdatedAtIso: result.lyricsUpdatedAt?.toISOString() ?? null,
        lyricsUpdatedBy: result.lyricsUpdatedBy,
      };
}
```

Put `toLyricsWire` in a shared module if the artist router cannot import from
`project.ts` without a cycle — check before duplicating it.

Import `setSongLyrics` and `SetSongLyricsResult` from `~/server/domain/song-management/db`,
and `LYRICS_MAX_LENGTH` from `~/server/domain/song-management/service`.

**Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`. Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/src/server/trpc/routers/project.ts
git commit -m "feat(music): SK-305 producer procedure for saving song lyrics"
```

---

### Task 5: Artist tRPC procedure

**Files:**
- Modify: `apps/web/src/server/trpc/routers/artist.ts`

**Step 1: Add after `approveVersion` (~line 1014)**

The artist does **not** have `ctx.producerId`. Resolve ownership first, exactly the way
`artist.detail` and `addComment` already do, then hand the owning producer's id to the
same domain function.

```ts
  // SK-305. Gili's decision: the artist writes the words too — they are
  // usually the one who wrote them. Authorization is resolveProjectOwnership,
  // the same NOT_FOUND-on-miss gate every other artist write uses; the clash
  // guard inside setSongLyrics is what keeps the two writers apart.
  setSongLyrics: artistProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        projectId: z.string().uuid(),
        lyrics: z.string().max(LYRICS_MAX_LENGTH).nullable(),
        expectedUpdatedAtIso: z.string().datetime().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await resolveProjectOwnership(
        ctx.db,
        ctx.clerkUserId,
        input.projectId,
      );
      assertArtistMusicProjectAvailable(project.lifecycleStatus);
      try {
        const result = await setSongLyrics(ctx.db, {
          producerId: project.producerId,
          trackId: input.trackId,
          projectId: input.projectId,
          lyrics: input.lyrics,
          expectedUpdatedAt: input.expectedUpdatedAtIso
            ? new Date(input.expectedUpdatedAtIso)
            : null,
          updatedBy: "artist",
          changedAt: new Date(),
        });
        return toLyricsWire(result);
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),
```

Confirm `resolveProjectOwnership` returns `producerId` on its project; if it does not,
read it from the join `artist.detail` already performs rather than adding a query.

**Step 2: Write the authorization test**

Add to the artist router tests: a second artist's `trackId` must return `NOT_FOUND`, and
must leave `project_tracks.lyrics` unchanged. This is the isolation boundary CLAUDE.md
requires — do not skip it.

**Step 3: Run**

Run: `cd apps/web && pnpm vitest run src/server/trpc/routers/__tests__`
Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/src/server/trpc/routers/artist.ts apps/web/src/server/trpc/routers/__tests__
git commit -m "feat(music): SK-305 artist procedure for saving song lyrics"
```

---

### Task 6: Carry lyrics down to the page

**Files:**
- Modify: `apps/web/src/server/trpc/routers/producer.ts` (~line 1360, the `detail` head select)
- Modify: `apps/web/src/server/trpc/routers/artist.ts` (~line 812, the `detail` head select)
- Modify: `apps/web/src/components/music/song-page.tsx` (`SongPageData["track"]`, ~line 243)
- Modify: `apps/web/src/app/(producer)/dashboard/music/[versionId]/page.tsx` (the `wire` object)
- Modify: `apps/web/src/app/(artist)/artist/music/song/[versionId]/page.tsx` (same)

**Step 1: Add to both head selects**

```ts
            trackLyrics: projectTracks.lyrics,
            trackLyricsUpdatedAt: projectTracks.lyricsUpdatedAt,
            trackLyricsUpdatedBy: projectTracks.lyricsUpdatedBy,
```

and return them from each `detail` procedure's track object.

**Step 2: Extend the wire type**

In `SongPageData["track"]`:

```ts
    /** SK-305. One sheet per song. Null means nobody has written the words yet. */
    lyrics: string | null;
    /**
     * The stamp the page loaded. It is echoed back on save and is the whole
     * clash guard — a save whose stamp no longer matches is refused rather
     * than replacing the other side's sheet.
     */
    lyricsUpdatedAtIso: string | null;
    lyricsUpdatedBy: "producer" | "artist" | null;
```

**Step 3: Map them in both page loaders**

```ts
      lyrics: data.track.lyrics,
      lyricsUpdatedAtIso: data.track.lyricsUpdatedAt?.toISOString() ?? null,
      lyricsUpdatedBy: data.track.lyricsUpdatedBy,
```

**Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS. Any test factory that builds `SongPageData` will fail to compile until it
supplies the three fields — fix those factories, do not loosen the type.

**Step 5: Commit**

```bash
git commit -m "feat(music): SK-305 carry song lyrics onto the song page payload"
```

---

### Task 7: Server actions

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/music/actions.ts`
- Modify: `apps/web/src/app/(artist)/artist/music/song/[versionId]/actions.ts`
- Modify: `apps/web/src/components/music/song-page.tsx` (`L3Actions`)

**Step 1: Add the result type and the action to `L3Actions`**

```ts
export type MusicL3LyricsActionResult =
  | { ok: true; lyrics: string | null; lyricsUpdatedAtIso: string; lyricsUpdatedBy: "producer" | "artist" }
  | { ok: false; reason: "stale"; lyrics: string | null; lyricsUpdatedAtIso: string | null; lyricsUpdatedBy: "producer" | "artist" | null }
  | { ok: false; reason: "error"; error: string };
```

```ts
  // Present for producer and artist alike — Gili's call is that both write.
  setSongLyrics?: (input: {
    projectId: string;
    trackId: string;
    versionId: string;
    lyrics: string | null;
    expectedUpdatedAtIso: string | null;
  }) => Promise<MusicL3LyricsActionResult>;
```

**Step 2: Producer action**

Follow `renameMusicSong` exactly: `callerOrError`, call
`caller.project.setSongLyrics`, `revalidateMusic(projectId, versionId)` **only when the
save won**, and map thrown errors through `toMessage`. A `stale` return is not a throw —
pass it straight through.

**Step 3: Artist action**

Same shape against `caller.artist.music.setSongLyrics`, revalidating the artist song path.

**Step 4: Typecheck, then commit**

```bash
git commit -m "feat(music): SK-305 server actions for saving song lyrics"
```

---

### Task 8: `LyricsDialog`

**Files:**
- Create: `apps/web/src/components/music/lyrics-dialog.tsx`
- Test: `apps/web/src/components/music/__tests__/lyrics-dialog.interaction.test.tsx`

Model the shell on `song-management-dialog.tsx` — same Radix `Root`/`Portal`/`Overlay`/
`Content`, same class strings, same `returnFocusRef` handling. Do **not** extend
`SongManagementDialog` itself; it is a single-line-input dialog used by eight callers.

**Behaviour to build:**

| Rule | Why |
| --- | --- |
| Textarea carries `dir="auto"` | Hebrew lyrics flip right-to-left inside the English UI |
| `Save lyrics` disabled until the text differs from what loaded | a reader cannot save by accident |
| Closing with unsaved changes shows an inline bar with `Discard`, not a second dialog | nested dialogs land under the overlay in this codebase (SK-298) |
| A `stale` result renders an amber bar with `See their version` / `Save mine anyway` and **never** clears the textarea | the whole point of the clash guard |
| `Save mine anyway` re-sends with the stamp from the stale result | that is the override |
| `See their version` replaces the textarea with the other side's words and drops the bar | |
| Footer reads `Updated by you · 3 days ago` / `Updated by {name} · …` / `Not written yet` | |
| Counter appears only above ~7,500 characters | it should not nag |
| `maxLength={8000}` on the textarea | matches `LYRICS_MAX_LENGTH` |

**Tests to write first** — one per row above. Then implement until they pass.

Run: `cd apps/web && pnpm vitest run src/components/music/__tests__/lyrics-dialog.interaction.test.tsx`

```bash
git commit -m "feat(music): SK-305 lyrics dialog"
```

---

### Task 9: The Lyrics row on the song page

**Files:**
- Modify: `apps/web/src/components/music/song-page.tsx` (~line 2675, just before the mobile Notes button)
- Test: `apps/web/src/components/music/__tests__/song-page.interaction.test.tsx`

**Step 1: Write the failing tests**

- The row renders for `role="producer"` and `role="artist"`, and **not** for `role="guest"`.
- Badge reads `24 lines` when lyrics have 24 lines, and `Add` when `lyrics` is null.
- Clicking it opens the dialog.
- A successful save updates the badge without a page reload.

**Step 2: Implement the row**

Copy the existing mobile Notes button's markup exactly, minus its `lg:hidden` wrapper so it
shows at every width, and place it directly above that button:

```tsx
{role !== "guest" && actions.setSongLyrics ? (
  <button
    type="button"
    data-test="open-song-lyrics"
    aria-label={lyricsLineCount > 0 ? `Open lyrics, ${String(lyricsLineCount)} lines` : "Add lyrics"}
    onClick={() => { setLyricsOpen(true); }}
    className="sk-press flex min-h-14 w-full items-center justify-between rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[13px] font-bold text-[rgb(var(--fg-default))] shadow-[var(--shadow-sm)] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
  >
    <span>Lyrics</span>
    <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2 py-1 font-mono text-[11px] text-[rgb(var(--fg-muted))]">
      {lyricsLineCount > 0 ? `${String(lyricsLineCount)} lines` : "Add"}
    </span>
  </button>
) : null}
```

Hold the saved sheet in local state seeded from `data.track`, so a save updates the badge
and the next open starts from the fresh stamp without a round trip.

**Step 3: Run, then commit**

```bash
git commit -m "feat(music): SK-305 lyrics row and dialog on the song page"
```

---

### Task 10: The upload modal field

**Files:**
- Modify: `apps/web/src/components/dashboard/song/upload-track-modal.tsx`
- Test: `apps/web/src/components/dashboard/song/__tests__/upload-track-modal.interaction.test.tsx`

**Step 1: Extend the props**

```ts
export interface UploadTrackModalTrack {
  ...
  /** SK-305. Cheap flag only — full lyrics never ride in the library dropdown payload. */
  hasLyrics?: boolean;
  lyricsLineCount?: number;
}
```

```ts
export interface UploadTrackModalProps {
  ...
  /**
   * SK-305. Only the song page supplies this, for mode="new-version", because
   * only it already holds the song's sheet. Library uploads deliberately do
   * not — shipping every song's lyrics into that dropdown would bloat the page
   * for a rare path.
   */
  songLyrics?: { text: string | null; updatedAtIso: string | null } | null;
  onSaveLyrics?: (input: {
    trackId: string;
    lyrics: string | null;
    expectedUpdatedAtIso: string | null;
  }) => Promise<{ ok: boolean; staleBy?: "producer" | "artist" | null }>;
}
```

**Step 2: Add the field**

Directly after the Version label block and **before** the `<details>` "Stage and notes
(optional)" element — never inside it. Reset `lyrics` in the existing open-effect
alongside `setDescription("")`.

Three states:

| Condition | Render |
| --- | --- |
| lyrics supplied (song page → new version) | expandable row, badge `N lines`, textarea pre-filled and editable, `dir="auto"` |
| no lyrics anywhere | expandable row, badge `optional`, empty editable textarea |
| library mode and the chosen track has `hasLyrics` | row is disabled, reads `already written — open the song to edit` |

**Step 3: Tests**

- The field renders outside the `<details>` element (assert it is not a descendant).
- Pre-filled text appears for the new-version case.
- The library case with `hasLyrics` renders disabled and no textarea.
- Editing then submitting calls `onSaveLyrics` once, with the loaded stamp.
- **Not** editing it does not call `onSaveLyrics` at all.

```bash
git commit -m "feat(music): SK-305 lyrics field in the upload modal"
```

---

### Task 11: Save the lyrics after the upload, never inside it

**Files:**
- Modify: `apps/web/src/components/dashboard/song/upload-track-modal.tsx` (the submit path, ~line 684)
- Modify: `apps/web/src/components/music/song-page.tsx` (pass `songLyrics` and `onSaveLyrics`)

**Step 1: Wire the sequence**

After the existing upload chain reports success, and **only** if the lyrics text differs
from what loaded:

1. `await onSaveLyrics(...)`.
2. `ok` → nothing extra; the parent refresh already picks up the new sheet.
3. `stale` → toast `Version saved. Lyrics unchanged — someone edited them while you uploaded.`
   as `"error"` severity, and still close the modal. **Do not** roll back the upload.
4. Thrown error → same treatment. The audio is saved either way.

This mirrors how `stageResult` is already handled a few lines above
(`Uploaded — but stage didn't update: …`), so it is an existing precedent, not a new pattern.

**Step 2: Test**

- A failing `onSaveLyrics` still reports the upload as successful and still calls `onCreated`.
- A stale `onSaveLyrics` toasts and does not re-send.

**Step 3: Commit**

```bash
git commit -m "feat(music): SK-305 save lyrics after the version upload completes"
```

---

### Task 12: Verify and open the PR

**Step 1: Full verification**

Run: `$skitza-verify`
Expected: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/web` and `pnpm typecheck` in
`packages/db` all pass. Warnings count as failures — Vercel runs ESLint at `--max-warnings 0`.

**Step 2: Look at it on a real phone width**

Start the dev server through the browser preview and check the song page at **390px and
360px**, then desktop separately. A browser window merely narrowed below 500px does not
count. Confirm the header action row did not gain a third line, and that Hebrew lyrics
render right-to-left inside the popup.

**Step 3: Do NOT apply the migration to production**

`0062` reaches production only through `$skitza-migrate` against an explicitly confirmed
target, with Gili's approval for that exact run. Ask first.

**Step 4: Open the PR**

```bash
gh pr create --base v3-clean \
  --title "SK-305: song lyrics in the upload modal and an editable Lyrics popup" \
  --body "..."
```

Body must state that migration `0062` is required and has not been applied.
Ask Gili before merging, and never promote without explicit approval for that deployment.
