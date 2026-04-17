"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Server Action wrapper for the ⌘K command palette. Thin by design:
// the palette component calls this directly (no tRPC/react-query on
// the client) so the palette bundle stays small and hydration-free.
// Empty query returns recents; non-empty runs the fuzzy search.
export type PaletteResult = {
  deals: Array<{ id: string; title: string; stage: string }>;
  contacts: Array<{ id: string; name: string; email: string }>;
  contracts: Array<{ id: string; title: string; status: string }>;
};

export async function paletteSearch(
  q: string,
): Promise<PaletteResult | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Please sign in." };
  try {
    const c = appRouter.createCaller({ userId });
    return await c.palette.search({ q });
  } catch (err) {
    if (err instanceof TRPCError) return { error: err.message };
    return { error: "Search failed." };
  }
}
