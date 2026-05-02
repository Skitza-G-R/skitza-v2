import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { appRouter } from "~/server/trpc/routers/_app";

import { initialsOf } from "../_design-test/data-mapping";
import { DesignShell } from "../_design-test/design-shell";
import { buildPaletteData } from "../_design-test/palette-data";
import type { Producer } from "../_design-test/shell";

// Sandbox-scoped layout — owns the design-test chrome (Sidebar +
// FloatingPlayer + Cmd-K palette) so it persists across navigation
// between every tab in (sandbox)/. This is what makes the dashboard
// feel like a true SPA: the Sidebar literally never unmounts when you
// click between tabs — only the {children} slot swaps in the new
// page's RSC payload.
//
// Before this layout existed, every page wrapped its own <DesignShell>.
// Each navigation tore down the shell and rebuilt it, causing a frame
// of "shell missing → loading.tsx → new shell" that read as a full
// page reload even though the network was a soft RSC swap.
//
// The (sandbox) route group keeps URLs identical (route groups don't
// add URL segments) but scopes this layout to the design-test pages
// only. /dashboard/onboarding and /dashboard/revenue stay outside
// (sandbox) and continue to use their own legacy chrome.
//
// Shared data fetched here once per request:
// - producer.me() → producer object passed to Sidebar
// - buildPaletteData(caller) → Cmd-K palette candidates
//
// Each page beneath this layout fetches ONLY its page-specific data,
// avoiding the duplicate `producer.me()` fetches that every page used
// to do.
export default async function SandboxLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [me, paletteData] = await Promise.all([
    caller.producer.me(),
    buildPaletteData(caller),
  ]);

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  return (
    <DesignShell producer={producer} paletteData={paletteData}>
      {children}
    </DesignShell>
  );
}
