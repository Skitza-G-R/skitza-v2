import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty-state";
import { appRouter } from "~/server/trpc/routers/_app";
import { NewProjectForm } from "./new-project-form";

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export default async function ProjectsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const list = await caller.project.list();
  const siteUrl = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

  return (
    <AppShell active="projects">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Projects
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontWeight: 800 }}
          >
            The rooms.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            One per engagement. Upload tracks, post versions, collect timestamped feedback,
            gate the final files behind payment. Share a single URL.
          </p>
        </header>

        <section className="mt-8">
          <NewProjectForm siteUrl={siteUrl} />
        </section>

        <section className="mt-10">
          {list.length === 0 ? (
            <EmptyState
              title="No projects yet."
              description="Create your first project room — it's the URL you send to a client after a confirmed booking. Tracks + versions + feedback all live there."
            />
          ) : (
            <ul className="grid gap-3">
              {list.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/projects/${p.id}`}
                    className="group block rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 transition-all hover:border-[rgb(var(--border-strong))] hover:shadow-[var(--shadow-md)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3
                          className="font-display text-xl tracking-tight"
                          style={{ fontWeight: 700 }}
                        >
                          {p.title}
                        </h3>
                        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
                          {p.artistName}
                          <span className="ml-2 font-mono text-xs text-[rgb(var(--fg-muted))]">
                            {p.artistEmail}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.finalPaid ? (
                          <Badge variant="active" dot>
                            Paid
                          </Badge>
                        ) : p.depositPaid ? (
                          <Badge variant="warning" dot>
                            Deposit
                          </Badge>
                        ) : (
                          <Badge dot>Unpaid</Badge>
                        )}
                      </div>
                    </div>
                    <p className="mt-3 font-mono text-xs text-[rgb(var(--fg-muted))]">
                      Created {dateFmt.format(p.createdAt)} · Updated{" "}
                      {dateFmt.format(p.updatedAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
