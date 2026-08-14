import { auth } from "~/server/auth/clerk-identity";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import { postSignInDestination } from "~/server/auth/post-sign-in";
import {
  syncAcceptedProducerInvitation,
  type ProducerInvitationSyncResult,
} from "~/server/auth/producer-invitation-sync";
import { fetchUserAccountMemberships } from "~/server/auth/role";

export const metadata: Metadata = {
  title: "Producer access",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ProducerAccessPage() {
  const { userId, providerUserId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  let invitationCheckUnavailable = false;

  if (userId) {
    if (!dbUrl) throw new Error("missing DATABASE_URL");
    let memberships = await fetchUserAccountMemberships({ dbUrl, userId });
    if (memberships.producer.status !== "none") {
      redirect(postSignInDestination(memberships));
    }

    let sync: ProducerInvitationSyncResult | null = null;
    try {
      sync = await syncAcceptedProducerInvitation({ dbUrl, userId, providerUserId });
    } catch {
      // No invitation grant is made when Clerk cannot be checked. Existing
      // Artist access stays usable, and this page offers a safe retry.
      invitationCheckUnavailable = true;
      console.error("[producer-invitation] reconciliation unavailable");
    }
    if (sync?.status === "created") redirect("/onboarding");
    if (sync?.status === "already_granted") {
      memberships = await fetchUserAccountMemberships({ dbUrl, userId });
      redirect(postSignInDestination(memberships));
    }
  }

  return (
    <div className="sk-auth-page" data-auth-page="producer-access">
      <AuthHero
        eyebrow="Producer access"
        title="Producer access is invitation-only"
        blurb="Producer accounts open only from a Clerk invitation sent by Skitza."
      />

      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
        {invitationCheckUnavailable ? (
          <p
            className="mb-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-default))] p-3 text-[rgb(var(--fg-default))]"
            role="status"
          >
            We could not check your invitation right now. Your existing account is unchanged.
            Refresh this page to try again.
          </p>
        ) : null}
        <ol className="space-y-3">
          <li>
            <strong className="text-[rgb(var(--fg-default))]">1.</strong> Open the invitation email
            from Skitza.
          </li>
          <li>
            <strong className="text-[rgb(var(--fg-default))]">2.</strong> Accept it using the same
            email as your Skitza account.
          </li>
          <li>
            <strong className="text-[rgb(var(--fg-default))]">3.</strong> Sign in and finish your
            Producer setup.
          </li>
        </ol>

        <p className="mt-5 border-t border-[rgb(var(--border-subtle))] pt-5">
          Example: if your Artist account uses <strong>maya@email.com</strong>, the invitation must
          also be sent to <strong>maya@email.com</strong>. Your Artist account stays active, and
          Producer access is added to it.
        </p>

        <p className="mt-3">
          If the link expired, was revoked, or opened under another account, sign out and reopen the
          invitation email. If it still does not work, ask Skitza for a new invitation.
        </p>

        <Link
          href="/"
          className="sk-press mt-5 inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-default))] px-4 font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))]"
        >
          Back to Skitza
        </Link>
      </div>
    </div>
  );
}
