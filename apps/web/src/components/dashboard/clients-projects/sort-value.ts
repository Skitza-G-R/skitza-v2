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
  { value: "name", label: "Name" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];
