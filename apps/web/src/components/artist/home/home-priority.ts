export type ArtistHomeActionKind =
  | "session_status"
  | "today_session"
  | "payment_action"
  | "ready_to_schedule"
  | "new_song"
  | "services";

export type ArtistHomeAction = Readonly<{
  id: string;
  kind: ArtistHomeActionKind;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  upcomingAt: Date | null;
  occurredAt: Date;
  audio?: Readonly<{
    url: string | null;
    title: string;
    subtitle: string;
    durationMs: number | null;
  }>;
  isNew?: boolean;
}>;

const PRIORITY: Record<ArtistHomeActionKind, number> = {
  session_status: 0,
  today_session: 0,
  payment_action: 1,
  ready_to_schedule: 2,
  new_song: 3,
  services: 4,
};

export function selectArtistHomeMainAction(
  candidates: readonly ArtistHomeAction[],
): ArtistHomeAction | null {
  return (
    [...candidates].sort((left, right) => {
      const priority = PRIORITY[left.kind] - PRIORITY[right.kind];
      if (priority !== 0) return priority;

      if (left.upcomingAt && right.upcomingAt) {
        const upcoming = left.upcomingAt.getTime() - right.upcomingAt.getTime();
        if (upcoming !== 0) return upcoming;
      } else if (left.upcomingAt) {
        return -1;
      } else if (right.upcomingAt) {
        return 1;
      }

      const newest = right.occurredAt.getTime() - left.occurredAt.getTime();
      if (newest !== 0) return newest;
      return left.id.localeCompare(right.id);
    })[0] ?? null
  );
}

export function withoutArtistHomeDuplicate(
  candidates: readonly ArtistHomeAction[],
  main: ArtistHomeAction | null,
): ArtistHomeAction[] {
  return candidates.filter((candidate) => candidate.id !== main?.id);
}
