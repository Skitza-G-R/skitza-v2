import { redirect } from "next/navigation";

// Legacy URL — the old /dashboard/projects list redirected to
// /dashboard/deals in Phase C, and the deals list collapsed into the
// /dashboard root (Kanban) in C.4. Redirect straight there so old
// bookmarks still land somewhere sensible.
export default function LegacyProjectsRedirect() {
  redirect("/dashboard");
}
