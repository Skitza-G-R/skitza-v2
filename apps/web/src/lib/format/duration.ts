// Formats a duration in milliseconds as "m:ss" (e.g. "3:42").
//
// Returns "—" for null, NaN, non-finite, or negative input — those
// inputs all signal "we don't have a real duration" (DB column was
// never decoded, an upload is still in flight, an external source
// returned garbage), and we'd rather render a neutral placeholder than
// a bogus zero.
//
// Per `feedback_time_display_format.md`: time displays use m:ss (e.g.
// `0:34`, not `34`). Extracted from the inline copies that previously
// lived in `version-row.tsx` and `song-space-hero.tsx` so the song
// surface is internally consistent.
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}
