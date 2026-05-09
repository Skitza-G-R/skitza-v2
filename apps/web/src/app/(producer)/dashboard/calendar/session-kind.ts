// Producer Calendar — session-kind inference & color tokens.
//
// The locked design spec § 2 colors session blocks by "kind" (tracking,
// mix, master, intro, songwriting, meeting). The DB `bookings` table
// doesn't carry a kind column — we derive one from the product/package
// name with a keyword table. The producer can keep their own naming
// (`Mix-only — full song`, `Stems & Master`, `Quick intro`) and the
// calendar still renders the right accent stripe + agenda dot.
//
// Adding a kind: extend SessionKind, add a row to RULES (most-specific
// keywords first), and add a matching `--kind-foo` token in globals.css.
// The session-kind.test.ts pins the inference contract — TDD it.

export type SessionKind =
  | "tracking"
  | "mix"
  | "master"
  | "intro"
  | "songwriting"
  | "meeting";

// Token names (no `rgb()` wrapper). Consumers compose with the alpha
// syntax: `style={{ background: \`rgb(var(${KIND_COLORS[kind]}) / 0.15)\` }}`.
export const KIND_COLORS: Record<SessionKind, string> = {
  tracking: "--kind-tracking",
  mix: "--kind-mix",
  master: "--kind-master",
  intro: "--kind-intro",
  songwriting: "--kind-songwriting",
  meeting: "--kind-meeting",
};

// Order matters — earlier rules win. mix > master because producers
// often label sessions "Mix + master" when the engagement is centered
// on the mix (the master is a deliverable). songwriting > tracking
// because "song" overlaps with the catch-all bucket if checked late.
const RULES: ReadonlyArray<{ kind: SessionKind; tokens: readonly string[] }> = [
  { kind: "mix", tokens: ["mix"] },
  { kind: "master", tokens: ["master", "review"] },
  { kind: "songwriting", tokens: ["song", "writ"] },
  { kind: "tracking", tokens: ["track", "vocal", "record"] },
  { kind: "intro", tokens: ["intro", "consult"] },
  { kind: "meeting", tokens: ["deliv", "meet", "sync", "call"] },
];

export function inferSessionKind(
  packageName: string | null | undefined,
): SessionKind {
  if (!packageName) return "meeting";
  const lower = packageName.toLowerCase().trim();
  if (lower.length === 0) return "meeting";
  for (const rule of RULES) {
    if (rule.tokens.some((t) => lower.includes(t))) return rule.kind;
  }
  return "meeting";
}
