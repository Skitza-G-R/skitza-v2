import { auth } from "~/server/auth/clerk-identity";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import {
  chosenRoleDestination,
  isGenuineDualRoleAccount,
  postSignInDestination,
  sanitizePostSignInTarget,
} from "~/server/auth/post-sign-in";
import { fetchUserAccountMemberships } from "~/server/auth/role";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose your workspace",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ChooseRolePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const query = await searchParams;
  const requestedTarget = typeof query.next === "string" ? query.next : null;
  const safeTarget = sanitizePostSignInTarget(requestedTarget)?.href ?? null;
  const memberships = await fetchUserAccountMemberships({ dbUrl, userId });

  if (!isGenuineDualRoleAccount(memberships)) {
    redirect(postSignInDestination(memberships, safeTarget));
  }

  const artistHref = chosenRoleDestination(memberships, "artist", safeTarget);
  const producerHref = chosenRoleDestination(memberships, "producer", safeTarget);

  return (
    <div data-auth-page="role-choice" className="space-y-5 sm:space-y-6">
      <AuthHero
        eyebrow="Choose workspace"
        title="Choose your workspace"
        blurb="This account belongs to both an artist and a producer. Choose where you want to continue."
      />

      <div className="grid gap-3">
        <Link
          href={artistHref}
          className={[
            "sk-press group min-h-20 rounded-[var(--radius-lg)] border",
            "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
            "px-4 py-3 text-left shadow-sm transition-[border-color,background-color,transform]",
            "hover:border-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--bg-overlay))]",
            "focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none",
            "motion-reduce:transition-none",
          ].join(" ")}
        >
          <span className="block text-sm font-bold text-[rgb(var(--fg-primary))]">
            Continue as artist
          </span>
          <span className="mt-1 block text-xs leading-5 text-[rgb(var(--fg-secondary))]">
            Open your music, sessions, bookings, and payments.
          </span>
        </Link>

        <Link
          href={producerHref}
          className={[
            "sk-press group min-h-20 rounded-[var(--radius-lg)] border",
            "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
            "px-4 py-3 text-left shadow-sm transition-[border-color,background-color,transform]",
            "hover:border-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--bg-overlay))]",
            "focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none",
            "motion-reduce:transition-none",
          ].join(" ")}
        >
          <span className="block text-sm font-bold text-[rgb(var(--fg-primary))]">
            Continue as producer
          </span>
          <span className="mt-1 block text-xs leading-5 text-[rgb(var(--fg-secondary))]">
            Open your studio dashboard and producer workspace.
          </span>
        </Link>
      </div>
    </div>
  );
}
