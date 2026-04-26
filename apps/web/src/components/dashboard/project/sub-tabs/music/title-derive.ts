// Pure helper — filename → human-readable track title.
//
// Story 05 mirrors the server-side implementation in
// project-room.ts (`deriveTitleFromFilename`) so the optimistic
// preview row that the Music tab renders the moment a file is
// dropped shows the same title the server will persist after the
// round-trip. Two implementations exist on purpose: the server one
// is the source of truth (it actually writes to the DB), and this
// client copy keeps the optimistic UI consistent without having to
// round-trip just to compute a string.
//
// Rules (PRD §11.6 + Story 05 acceptance):
//   1. Strip file extension
//        (.wav | .mp3 | .aif | .aiff | .flac | .m4a — case-insensitive)
//   2. Iteratively strip recognised producer-naming suffixes at the
//      end of the name (case-insensitive):
//        _v\d+ | _master | _mix | _final | _demo | _rough
//      "Iteratively" = filenames like `song_v3_master.wav` strip both
//      suffixes, not just the trailing one.
//   3. Replace remaining `_` and `-` with spaces, collapse repeated
//      whitespace, trim leading/trailing whitespace.
//   4. Title-case: capitalize the first letter of each whitespace-
//      separated word but DO NOT lowercase existing capitals — that
//      preserves intentional ALL-CAPS like "OK" / "NASA".
//   5. If the result is empty (the entire filename stripped down to
//      nothing — e.g. "_v3.wav" → ""), return "Untitled track" so
//      downstream NOT NULL constraints don't fail.

const EXTENSION_RE = /\.(wav|mp3|aif|aiff|flac|m4a)$/i;

// Suffix pattern: a leading separator (`_` or `-` or whitespace) plus
// one of the recognised tokens, anchored at the end of the string.
// Anchored so we never strip mid-name occurrences (e.g. "master_mix"
// only loses the trailing `_mix`, leaving "master" as the title).
const SUFFIX_RE = /[\s_-]+(?:v\d+|master|mix|final|demo|rough)\s*$/i;

export function deriveTrackTitle(filename: string): string {
  // 1. Drop a recognised audio extension if present. We deliberately
  //    only strip the listed audio extensions — random ".tmp" or
  //    ".bak" suffixes stay so producers can see what they uploaded.
  let name = filename.replace(EXTENSION_RE, "");

  // 2. Iteratively strip suffixes. Loop until the string is stable
  //    (no more matches). The loop is bounded by string length, so
  //    it always terminates even on pathological inputs.
  let prev = "";
  while (prev !== name) {
    prev = name;
    name = name.replace(SUFFIX_RE, "");
  }

  // 3. Normalise separators. Replace `_` and `-` with spaces, then
  //    collapse repeated whitespace.
  name = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  // 4. Title-case: capitalize the first letter of each whitespace-
  //    separated word, leave existing capitals alone (so "OK" /
  //    "NASA" stay capitalized). We anchor on (^|\s) rather than
  //    \b so a leftover "." doesn't promote ".mp3" → ".Mp3" — the
  //    user typed lower-case there and we shouldn't second-guess.
  if (!name) return "Untitled track";
  return name.replace(/(^|\s)(\w)/g, (_, lead: string, ch: string) =>
    `${lead}${ch.toUpperCase()}`,
  );
}
