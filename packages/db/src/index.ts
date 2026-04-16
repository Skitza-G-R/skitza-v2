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
export { eq, and, desc, sql } from "drizzle-orm";
