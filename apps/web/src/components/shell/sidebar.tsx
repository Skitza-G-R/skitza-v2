// ─── Compat shim — Phase 2 ──────────────────────────────────────────
//
// The producer sidebar visual implementation moved to
// `~/components/nav/producer-sidebar` as part of the Phase 2 shell
// port (locked design system, 2026-05-05). Existing callers + tests
// keep importing from this path; this module re-exports the new
// surface so the import contract stays stable.
//
// Don't add new code here. New imports should target
// `~/components/nav/producer-sidebar` directly.

export {
  NAV_ITEMS,
  ProducerSidebar as Sidebar,
} from "~/components/nav/producer-sidebar";
