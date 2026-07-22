// Shared SortValue + SORT_OPTIONS for the Clients & Projects list view
// and its table-mode column headers. Extracted from
// workspace-list-view.tsx so ProjectsTableHeader / ClientsTableHeader
// can dispatch the same sort values the dropdown does without a
// circular import back into the parent component.

export const SORT_OPTIONS = [
  { value: "custom", label: "Custom" },
  { value: "recent", label: "Recent" },
  { value: "deadline", label: "Deadline" },
  { value: "balance", label: "Balance" },
  { value: "progress", label: "Progress" },
  // 'joined' (round-4 table polish): the Clients table JOINED column
  // dispatches this. On the Projects tab it maps to project.createdAt
  // so the same dropdown option keeps a parallel meaning.
  { value: "joined", label: "Joined" },
  { value: "name", label: "Name" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

type ProjectJoinedSortRow = {
  createdAtIso?: string | null;
};

type ClientJoinedSortRow = {
  joinedAtIso?: string | null;
};

function createdAtMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Newest-created first; projects without a valid creation date sink. */
export function compareProjectsByJoined<T extends ProjectJoinedSortRow>(
  left: T,
  right: T,
): number {
  return createdAtMs(right.createdAtIso) - createdAtMs(left.createdAtIso);
}

/** Newest roster join first; clients without a valid join date sink. */
export function compareClientsByJoined<T extends ClientJoinedSortRow>(left: T, right: T): number {
  return createdAtMs(right.joinedAtIso) - createdAtMs(left.joinedAtIso);
}
