import { appRouter } from "~/server/trpc/routers/_app";

// Detect whether a freshly-signed-up producer has completed any of
// the core setup flows. Used by `/dashboard` → redirect to the wizard
// on first visit, and by the "finish setup" banner for returning
// skippers.
//
// Heuristic: if the producer has NO packages AND the brand JSONB is
// empty (no logo/primary/accent), they haven't started. We do NOT
// bucket "has availability" here because the wizard can set that; its
// absence alone isn't a strong first-run signal.
export async function detectOnboardingState(userId: string): Promise<{
  firstRun: boolean;
  hasPackages: boolean;
  hasAvailability: boolean;
  hasBrand: boolean;
  hasDisplayName: boolean;
}> {
  const caller = appRouter.createCaller({ userId });
  // Run in parallel — each is a small indexed SELECT. In the worst
  // case this is three round-trips that the first dashboard paint
  // would do anyway.
  const [me, pkgs, avail] = await Promise.all([
    caller.producer.me(),
    caller.booking.packages.list(),
    caller.booking.availability.list(),
  ]);
  const brand = me.brand;
  const hasBrand = Boolean(
    brand.primary || brand.accent || brand.logoUrl || brand.font,
  );
  const hasDisplayName = Boolean(me.displayName && me.displayName.trim().length > 0);
  const firstRun = pkgs.length === 0 && !hasBrand;
  return {
    firstRun,
    hasPackages: pkgs.length > 0,
    hasAvailability: avail.length > 0,
    hasBrand,
    hasDisplayName,
  };
}
