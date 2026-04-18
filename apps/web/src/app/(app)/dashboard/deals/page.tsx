import { redirect } from "next/navigation";

// Legacy URL — Phase H.1 renamed /dashboard/deals → /dashboard/projects.
// Keep this redirect so old bookmarks and share links still resolve.
export default function LegacyDealsRedirect() {
  redirect("/dashboard/projects");
}
