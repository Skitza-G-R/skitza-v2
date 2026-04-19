import Link from "next/link";

// Brand-new sign-in with no studio relationships yet. We can't
// magically know which producers want to work with this artist —
// they need an invite link. So the welcome screen sets expectations.
export default function ArtistWelcomePage() {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="font-display text-3xl tracking-tight">
        Welcome to Skitza.
      </h1>
      <p className="mt-4 text-sm text-[rgb(var(--fg-secondary))]">
        Once a producer invites you to work on a project, your studios
        will show up here. Ask the producer to send you a Skitza link
        — clicking it from the same email address you used to sign in
        will connect everything automatically.
      </p>
      <p className="mt-8 text-xs text-[rgb(var(--fg-muted))]">
        Already have an invite link?
      </p>
      <Link
        href="/sign-out"
        className="mt-2 inline-block text-sm text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
      >
        Sign out + click the invite from your email
      </Link>
    </div>
  );
}
