import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { SettingsTab } from "../../_design-test/settings-tab";

// Settings tab. The DesignShell + Sidebar live in (sandbox)/layout.tsx
// now, so the page only needs to fetch its own data and return the
// inner tab body.

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const me = await caller.producer.me();

  const brand = me.brand as Record<string, unknown>;
  const tagline = typeof brand.tagline === "string" ? brand.tagline : "";

  return (
    <SettingsTab
      data={{
        name: me.displayName ?? "",
        email: me.email,
        tagline,
        publicLinkSlug: me.slug,
        stripeConnected: me.stripeConnected,
      }}
    />
  );
}
