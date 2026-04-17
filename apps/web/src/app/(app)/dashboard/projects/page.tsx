import { redirect } from "next/navigation";

// Legacy URL — renamed to /dashboard/deals in Phase C. Redirect so
// existing bookmarks don't 404.
export default function LegacyProjectsRedirect() {
  redirect("/dashboard/deals");
}
