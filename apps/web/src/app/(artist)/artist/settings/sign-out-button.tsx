"use client";

import { SignOutButton as ClerkSignOutButton } from "@clerk/nextjs";

// A plain sign-out button styled to match the "Manage account" link
// alongside it on /artist/settings. Uses Clerk's <SignOutButton>
// component so sign-out redirection respects the root ClerkProvider's
// `afterSignOutUrl` (configured to "/" per Gili's Q7 answer for Task
// 17). Kept as its own client-component file so the settings page
// can stay a Server Component (for the auth() + currentUser() reads).

export function SignOutButton() {
  return (
    <ClerkSignOutButton redirectUrl="/">
      <button
        type="button"
        className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-md)] border border-transparent px-4 py-2 font-mono text-[0.75rem] uppercase tracking-wider text-[rgb(var(--fg-danger))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--fg-danger))]"
      >
        Sign out
      </button>
    </ClerkSignOutButton>
  );
}
