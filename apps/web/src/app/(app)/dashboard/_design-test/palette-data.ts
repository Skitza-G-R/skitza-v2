// Server-side helper that builds the PaletteData shape expected by
// CommandPalette. Each dashboard page passes its own caller in so the
// palette respects the producer's tenancy scope automatically.

import type { appRouter } from "~/server/trpc/routers/_app";

import { gradFor } from "./data-mapping";
import type { PaletteData } from "./command-palette";

type Caller = ReturnType<typeof appRouter.createCaller>;

export async function buildPaletteData(caller: Caller): Promise<PaletteData> {
  // Three parallel reads. Each falls back to [] on error so a single
  // upstream blip doesn't keep the palette from opening at all.
  const [projects, tracks, listResult] = await Promise.all([
    caller.project.list().catch(() => [] as Awaited<ReturnType<Caller["project"]["list"]>>),
    caller.library
      .list({})
      .catch(() => [] as Awaited<ReturnType<Caller["library"]["list"]>>),
    caller.clientContacts.listWithProjects().catch(
      () =>
        ({ view: "all-projects" as const, projects: [] }) as Awaited<
          ReturnType<Caller["clientContacts"]["listWithProjects"]>
        >,
    ),
  ]);

  // Derive distinct clients from listWithProjects → projects[].client.
  // Each row exposes { client: { id, email, name } }; group by email.
  type ClientAccum = { id: string; name: string; count: number };
  const clientsByEmail = new Map<string, ClientAccum>();
  if (listResult.view === "all-projects") {
    for (const p of listResult.projects) {
      const c = p.client;
      const key = c.email.toLowerCase();
      const existing = clientsByEmail.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        clientsByEmail.set(key, {
          id: c.id ?? `email:${key}`,
          name: c.name ?? c.email,
          count: 1,
        });
      }
    }
  }

  return {
    projects: projects.map((p, i) => ({
      id: p.id,
      title: p.title,
      client: p.clientName ?? p.artistName ?? "Client",
      grad: gradFor(i),
    })),
    tracks: tracks.map((t, i) => ({
      id: t.versionId,
      title: t.trackTitle ?? t.versionLabel ?? "Untitled",
      sub: [
        t.versionLabel ?? null,
        t.projectClientName ?? t.projectTitle ?? null,
      ]
        .filter((x): x is string => Boolean(x))
        .join(" · "),
      grad: gradFor(i),
    })),
    clients: Array.from(clientsByEmail.values()).map((c) => ({
      id: c.id,
      name: c.name,
      projectCount: c.count,
    })),
  };
}
