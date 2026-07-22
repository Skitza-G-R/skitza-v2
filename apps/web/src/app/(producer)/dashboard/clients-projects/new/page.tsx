import { redirect } from "next/navigation";

// Phase 1 G7 — the dedicated "New project" page is gone. The legacy
// form (new-project-form.tsx) has been deleted; producers now create
// projects from the floating NewProjectModal on /dashboard/clients-
// projects. This route exists only as a server-side redirect for the
// remaining saved URLs and Today contextual actions that still link here.
//
// Query params from the legacy URL (?mode=offline, ?clientFirst=1, …)
// are dropped — the modal handles all flows uniformly. The redirect
// target sets `?newProject=1` so the parent page can auto-open the
// modal on mount. That hydration lives in workspace-list-view.tsx +
// the page.tsx searchParams handler.
//
// DESIGN.md §6.2. Once every call site is updated to point at the
// parent route directly (a fast-follow), this file can be deleted
// outright.
export default function LegacyNewProjectRedirect() {
  redirect("/dashboard/clients-projects?newProject=1");
}
