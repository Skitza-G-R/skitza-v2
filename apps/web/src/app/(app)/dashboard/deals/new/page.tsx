import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { NewDealForm } from "./new-deal-form";

export default async function NewDealPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const siteUrl = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

  return (
    <AppShell active="pipeline">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up">
          <Link
            href="/dashboard"
            className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
          >
            ← All deals
          </Link>
          <h1
            className="mt-3 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontWeight: 800 }}
          >
            New deal.
          </h1>
          <p className="mt-3 text-sm text-[rgb(var(--fg-secondary))]">
            One engagement per deal. Create the room, copy the share URL, send it to the
            artist. You can upload tracks + collect feedback inside.
          </p>
        </header>

        <section className="mt-8">
          <NewDealForm siteUrl={siteUrl} />
        </section>
      </div>
    </AppShell>
  );
}
