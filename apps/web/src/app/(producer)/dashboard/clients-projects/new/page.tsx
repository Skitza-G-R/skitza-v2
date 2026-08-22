import { redirect } from "next/navigation";

// Kept only so old bookmarks fail safely. SK-255 removed manual New
// project entry; this route now lands on the normal workspace without
// opening a creation flow.
export default function LegacyNewProjectRedirect() {
  redirect("/dashboard/clients-projects");
}
