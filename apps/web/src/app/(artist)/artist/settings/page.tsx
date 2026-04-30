import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function ArtistSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="space-y-6 pb-24">
      <h1 className="sr-only">Settings</h1>

      <section aria-labelledby="integrations-heading" className="space-y-3">
        <h2
          id="integrations-heading"
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
        >
          Integrations
        </h2>

        <article className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]">
          <h3 className="font-display text-base text-[rgb(var(--fg-primary))]">
            Google Calendar
          </h3>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            Sync your sessions to your personal calendar.
          </p>
          <button
            type="button"
            disabled
            className="mt-3 inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-muted))] opacity-60"
          >
            Connect Google Calendar
          </button>
          <p className="mt-1.5 text-[0.66rem] text-[rgb(var(--fg-muted))]">
            (coming soon)
          </p>
        </article>

        <article className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]">
          <h3 className="font-display text-base text-[rgb(var(--fg-primary))]">
            Payment method
          </h3>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            For purchasing services from producers.
          </p>
          <button
            type="button"
            disabled
            className="mt-3 inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-muted))] opacity-60"
          >
            Add payment method
          </button>
          <p className="mt-1.5 text-[0.66rem] text-[rgb(var(--fg-muted))]">
            (coming soon)
          </p>
        </article>
      </section>

      <section aria-labelledby="account-heading" className="space-y-3">
        <h2
          id="account-heading"
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
        >
          Account
        </h2>
        <p className="text-sm text-[rgb(var(--fg-secondary))]">
          Name, email, profile photo, sign out, and account deletion are
          managed through the account menu in the top-right corner of the app.
        </p>
      </section>
    </div>
  );
}
