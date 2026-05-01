// Cmd-K palette ranking. Pure, no React imports — tested by
// __tests__/palette-ranking.test.ts.
//
// Three behaviours:
// 1) Empty query → recents (in "Recent" section) followed by tabs (in
//    "Jump to" section). Recents are looked up against the candidate
//    list to hydrate them with current label/icon.
// 2) Non-empty query → case-insensitive substring match on
//    `label + ' ' + sub`. Lower scores rank higher; label-prefix
//    matches score 0, mid-string score = the index of the match.
//    Tabs get a -1 bonus so they always rank above projects/tracks
//    when the label substring matches both.
// 3) Display grouping: results are emitted in fixed kind order
//    (tab → project → track → client). The first item of each kind
//    carries a `_section` header label; subsequent items don't.

const SECTION_LABEL = {
  tab: "Jump to",
  project: "Projects",
  track: "Songs",
  client: "Clients",
} as const;

export type PaletteKind = "tab" | "project" | "track" | "client";

export type PaletteCandidate = {
  kind: PaletteKind;
  id: string;
  label: string;
  sub?: string;
  icon: string;
  hint?: string;
  grad?: string;
};

export type PaletteItem = PaletteCandidate & {
  _section?: string;
};

export type RecentRef = {
  kind: PaletteKind;
  id: string;
};

const KIND_ORDER: readonly PaletteKind[] = ["tab", "project", "track", "client"];
const MAX_RESULTS = 24;

export function rankPaletteItems({
  query,
  candidates,
  recents,
}: {
  query: string;
  candidates: PaletteCandidate[];
  recents: RecentRef[];
}): PaletteItem[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    // Hydrate recents against the candidate list. Drop any recent that
    // no longer exists (the project/track was deleted).
    const recentSet = new Set(recents.map((r) => `${r.kind}:${r.id}`));
    const recentItems: PaletteItem[] = recents
      .map((r) => candidates.find((c) => c.kind === r.kind && c.id === r.id))
      .filter((c): c is PaletteCandidate => c !== undefined)
      .map((c, i) => (i === 0 ? { ...c, _section: "Recent" } : c));
    // Then show all tabs that aren't already in the recents list.
    const tabItems = candidates
      .filter(
        (c) => c.kind === "tab" && !recentSet.has(`${c.kind}:${c.id}`),
      )
      .map((c, i) => (i === 0 ? { ...c, _section: "Jump to" } : c));
    return [...recentItems, ...tabItems];
  }

  // Score each candidate. Lower = better. Returns null if no match.
  const scored: { c: PaletteCandidate; score: number }[] = [];
  for (const c of candidates) {
    const hay = `${c.label} ${c.sub ?? ""}`.toLowerCase();
    const idx = hay.indexOf(q);
    if (idx === -1) continue;
    const labelStartsWith = c.label.toLowerCase().startsWith(q);
    let score = labelStartsWith ? 0 : idx;
    if (c.kind === "tab") score -= 1;
    scored.push({ c, score });
  }
  scored.sort((a, b) => a.score - b.score);
  const ranked = scored.slice(0, MAX_RESULTS).map((s) => s.c);

  // Group by kind in fixed order. First of each kind gets _section.
  const grouped: PaletteItem[] = [];
  for (const kind of KIND_ORDER) {
    const inKind = ranked.filter((r) => r.kind === kind);
    inKind.forEach((c, i) => {
      grouped.push(i === 0 ? { ...c, _section: SECTION_LABEL[kind] } : c);
    });
  }
  return grouped;
}
