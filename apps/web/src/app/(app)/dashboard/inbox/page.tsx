import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

import { InboxList, type InboxItem } from "./inbox-list";

// The unified inbox at /dashboard/inbox. Reads from the notifications
// table via the inbox tRPC router and renders a keyboard-navigable
// stream. `?archived=1` flips to the archived bucket.
type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function InboxPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const showArchived = sp.archived === "1" || sp.archived === "true";

  const caller = appRouter.createCaller({ userId });
  const rows = await caller.inbox.list({ archived: showArchived });

  // Project on the wire so we don't leak producerId/schema changes to
  // the client. Dates become strings because Next's Server → Client
  // boundary serialises through JSON — we re-parse in the client.
  const initial: InboxItem[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    projectId: r.projectId,
    trackVersionId: r.trackVersionId,
    commentId: r.commentId,
    contractId: r.contractId,
    bookingId: r.bookingId,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <AppShell active="inbox">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="reveal-up">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Inbox
          </p>
          <h1
            className="mt-2 font-display text-3xl leading-tight tracking-tight sm:text-4xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            Everything that needs a look.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Comments, new bookings, contract events — one stream. <kbd className="rounded bg-[rgb(var(--bg-elevated))] px-1 font-mono text-[11px]">j</kbd>/<kbd className="rounded bg-[rgb(var(--bg-elevated))] px-1 font-mono text-[11px]">k</kbd> to move, <kbd className="rounded bg-[rgb(var(--bg-elevated))] px-1 font-mono text-[11px]">e</kbd> to archive, <kbd className="rounded bg-[rgb(var(--bg-elevated))] px-1 font-mono text-[11px]">Enter</kbd> to open.
          </p>
        </header>

        <section className="mt-8 reveal-up-delay-1">
          <InboxList initial={initial} showArchived={showArchived} />
        </section>
      </div>
    </AppShell>
  );
}
