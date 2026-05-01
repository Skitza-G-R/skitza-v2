import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { initialsOf } from "../_design-test/data-mapping";
import { DesignShell } from "../_design-test/design-shell";
import { buildPaletteData } from "../_design-test/palette-data";
import { SettingsTab } from "../_design-test/settings-tab";
import type { Producer } from "../_design-test/shell";

// gili/design-test branch — Settings tab. Wires the mockup's
// Account / Plan / Integrations / Language sections against
// producer.me() — Display name, email, slug, Stripe connection
// pulled from the real DB. Tagline lives in producers.brand JSON
// (left empty for now; the mockup field is editable but not
// persisted on this round).

export default async function SettingsPage() {
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

  // tagline from brand JSON if present.
  const brand = me.brand as Record<string, unknown>;
  const tagline = typeof brand.tagline === "string" ? brand.tagline : "";

  return (
    <DesignShell producer={producer} paletteData={paletteData}>
      <SettingsTab
        data={{
          name: me.displayName ?? "",
          email: me.email,
          tagline,
          publicLinkSlug: me.slug,
          stripeConnected: me.stripeConnected,
        }}
      />
    </DesignShell>
  );
}
