export * from "./schema";
export * from "./client";
// Re-export drizzle helpers so consumer apps don't need a direct
// drizzle-orm dependency just to compose where-clauses. Add more
// helpers here only when an actual call-site needs them.
// - `eq`: equality predicate (used everywhere)
// - `and`: combine predicates, e.g. tenant-scoped row-level filters
//   in portfolio.reorder
// - `desc`: ORDER BY direction for magicLink.list (newest first)
// - `sql`: tagged-template escape hatch for aggregates
//   (max(viewedAt)) in magicLink.list — drizzle has no first-class
//   helper for arbitrary SQL fragments yet
// - `asc`: ORDER BY direction for packages.list (by position ASC)
// - `gte/lte`: range filters on booking.startsAt in slot computation
// - `inArray`: WHERE status IN (...) for filtering confirmed+pending
// - `notInArray`: WHERE stage NOT IN (...) — artist.book.availability
//   excludes "paid"/"archived"/"cancelled" projects when resolving a
//   free-session carryover.
// - `or`: disjunction for the palette's multi-field fuzzy search
// - `ilike`: case-insensitive LIKE for the same
// - `isNull`/`isNotNull`: nullness predicates for the inbox router —
//   active = archivedAt IS NULL, archived = archivedAt IS NOT NULL.
export { eq, and, or, desc, asc, sql, gte, lte, inArray, notInArray, ilike, isNull, isNotNull } from "drizzle-orm";
