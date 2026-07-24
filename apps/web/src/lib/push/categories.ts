export const PUSH_CATEGORIES = [
  "booking",
  "payment",
  "comment",
  "project_status",
  "song_status",
  "purchase_status",
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number];

export const PUSH_CATEGORY_COPY: Readonly<
  Record<PushCategory, { label: string; description: string }>
> = {
  booking: {
    label: "Bookings",
    description: "New session requests and confirmed session changes.",
  },
  payment: {
    label: "Payments",
    description: "Payment proofs and confirmed payment activity.",
  },
  comment: {
    label: "Comments",
    description: "New feedback on a song or version.",
  },
  project_status: {
    label: "Project status",
    description: "Important project stage changes.",
  },
  song_status: {
    label: "Song status",
    description: "Important song and version changes.",
  },
  purchase_status: {
    label: "Purchase status",
    description: "Requests, agreements, approvals, and purchase changes.",
  },
};

const CATEGORY_SET = new Set<string>(PUSH_CATEGORIES);

export function isPushCategory(value: unknown): value is PushCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

export function normalizePushCategories(values: readonly unknown[]): PushCategory[] {
  return [...new Set(values.filter(isPushCategory))].sort(
    (left, right) => PUSH_CATEGORIES.indexOf(left) - PUSH_CATEGORIES.indexOf(right),
  );
}
