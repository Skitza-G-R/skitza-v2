import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";
import { getShellState } from "~/server/shell-data";
import { NewProjectForm } from "./new-project-form";

export default async function NewProjectPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const siteUrl = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

  const { slug: producerSlug } = await getShellState();

  // Pre-fetch the producer's known client contacts so the form can
  // offer returning-artist autocomplete without a client-side RPC
  // round-trip on mount. Failure here is non-fatal — the form
  // degrades to no autocomplete.
  let contacts: { id: string; email: string; name: string }[] = [];
  try {
    const caller = appRouter.createCaller({ userId });
    const rows = await caller.clientContacts.list();
    contacts = rows.map((r) => ({ id: r.id, email: r.email, name: r.name }));
  } catch {
    contacts = [];
  }

  return (
    <>
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up">
          <Link
            href="/dashboard"
            className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
          >
            ← All projects
          </Link>
          <h1
            className="mt-3 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontWeight: 800 }}
          >
            New project.
          </h1>
          <p className="mt-3 text-sm text-[rgb(var(--fg-secondary))]">
            One engagement per project. Create the room, copy the share URL, send it to the
            artist. You can upload tracks + collect feedback inside.
          </p>
        </header>

        <section className="mt-8">
          <NewProjectForm siteUrl={siteUrl} producerSlug={producerSlug} contacts={contacts} />
        </section>
      </div>
    </>
  );
}
