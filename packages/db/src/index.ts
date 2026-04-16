export * from "./schema";
export * from "./client";
// Re-export drizzle helpers so consumer apps don't need a direct
// drizzle-orm dependency just to compose where-clauses. Add more
// helpers here only when an actual call-site needs them.
// - `eq`: equality predicate (used everywhere)
// - `and`: combine predicates, e.g. tenant-scoped row-level filters
//   in portfolio.reorder
export { eq, and } from "drizzle-orm";
