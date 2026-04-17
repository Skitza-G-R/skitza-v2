import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { ContractsClient } from "./contracts-client";

export default async function ContractsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [templates, contractsList] = await Promise.all([
    caller.contract.templates.list(),
    caller.contract.list(),
  ]);
  const siteUrl = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

  return (
    <AppShell active="contracts">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Contracts
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontWeight: 800 }}
          >
            Sign before you start.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Reusable templates with merge fields. One signing URL per artist. Audit trail
            on every view + sign.
          </p>
        </header>

        <div className="mt-8">
          <ContractsClient
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              body: t.body,
              active: t.active,
              updatedAt: t.updatedAt,
            }))}
            contracts={contractsList.map((c) => ({
              id: c.id,
              title: c.title,
              artistName: c.artistName,
              artistEmail: c.artistEmail,
              status: c.status,
              createdAt: c.createdAt,
              signedAt: c.signedAt,
            }))}
            siteUrl={siteUrl}
          />
        </div>
      </div>
    </AppShell>
  );
}
