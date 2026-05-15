import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";
import { SettingsClient } from "./settings-client";
import {
  isLegacyOutSectionKey,
  isSettingsSectionKey,
  LEGACY_IN_BRANCH_TO_SECTION,
  LEGACY_IN_SECTION_TO_SECTION,
  LEGACY_OUT_REDIRECTS,
  resolveNotifications,
  type SettingsSectionKey,
} from "./settings-keys";
import "./settings.css";

// /dashboard/settings — Settings redesign (2026-05-14).
//
// Five sections in a left sub-nav (Profile · Plan & billing · Notifications ·
// Integrations · Currency & region). The Studio section in the original
// reference is intentionally deferred; the slot is held open in the design
// but not rendered until business-name/city/country/tax-id schema lands.
//
// URL contract:
//   ?section=<key>  — the current key. Five values: profile, plan, notif,
//                     int, region. Missing/unknown values default to
//                     "profile".
//   ?branch=<key>   — legacy 2-branch URL ('profile' or 'integrations'),
//                     redirected to the equivalent new section.
//   ?section=<old>  — legacy 7-tab URLs:
//                       services      → /dashboard/profile?tab=store
//                                       (Storefront's Store tab)
//                       availability  → /dashboard/calendar?tab=availability
//                       portfolio / marketing / account → 'profile'
//                       autopilot / connections        → 'int'
//
// Public-page concerns (slug, brand colors, logo, portfolio image picks,
// genres/response/streams marketing copy) intentionally have no home on
// the new Settings page — they move to a future /dashboard/public-page
// route. Until that ships, those values stay in the DB; producers just
// can't edit them from Settings.
//
// Server-rendered so legacy ?section=services / ?branch=* redirects fire
// before any client work, and so the producer.me + paymentConnection +
// Clerk user fetches happen in one render pass (Promise.all under the
// hood inside the SettingsClient mount).
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; branch?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;

  // (1) Legacy `?section=services` / `?section=availability` redirect OUT
  // to the canonical homes (Storefront / Calendar). Done first so the
  // legacy keys never collide with new section keys (both 'services'
  // and 'availability' are NOT valid new section keys, so the order
  // here is just for clarity).
  if (params.section && isLegacyOutSectionKey(params.section)) {
    redirect(LEGACY_OUT_REDIRECTS[params.section]);
  }

  // (2) Legacy `?branch=<key>` (the 2-branch era) → new `?section=<key>`.
  // If both params are present, `?section=` wins; otherwise we map the
  // branch and redirect with the new param so the URL is canonical.
  if (params.branch && !params.section) {
    const mapped =
      LEGACY_IN_BRANCH_TO_SECTION[params.branch] ?? "profile";
    redirect(`/dashboard/settings?section=${mapped}`);
  }

  // (3) Old `?section=<old-key>` that maps INTO a new section (e.g.
  // portfolio → profile, autopilot → int). Server-side redirect so the
  // URL bar reflects the canonical key.
  if (
    params.section &&
    !isSettingsSectionKey(params.section) &&
    LEGACY_IN_SECTION_TO_SECTION[params.section]
  ) {
    redirect(
      `/dashboard/settings?section=${LEGACY_IN_SECTION_TO_SECTION[params.section] ?? "profile"}`,
    );
  }

  // (4) Resolve the active section. Unknown / missing → 'profile'.
  const active: SettingsSectionKey = isSettingsSectionKey(params.section)
    ? params.section
    : "profile";

  // Parallel fetches: profile from tRPC, Clerk user (for the Google
  // avatar + email), payment connection status. The Stripe Connect
  // flags ride along on profile.
  const caller = appRouter.createCaller({ userId });
  const [user, profile, paymentConnection] = await Promise.all([
    currentUser(),
    caller.producer.me(),
    caller.producer.paymentConnection(),
  ]);

  // Derive initials for the avatar fallback (when the Clerk user has no
  // Google image). Prefers the producer's displayName; falls back to
  // the Clerk first/last; finally a "?" if both are blank.
  const name = profile.displayName ?? user?.firstName ?? "";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <SettingsClient
      initialActive={active}
      initial={{
        displayName: profile.displayName ?? "",
        defaultCurrency: profile.defaultCurrency as
          | "USD"
          | "EUR"
          | "GBP"
          | "ILS",
        weekStart: profile.weekStart === "monday" ? "monday" : "sunday",
        plan: profile.plan === "pro" ? "pro" : "free",
        notifications: resolveNotifications(profile.notificationPrefs),
      }}
      identity={{
        avatarUrl: user?.imageUrl ?? null,
        initials,
        email: profile.email,
      }}
      integrations={{
        tranzilaConnected: paymentConnection.connected,
        stripeConnected: profile.stripeConnected,
        stripeChargesEnabled: profile.stripeChargesEnabled,
        billingEmail: profile.email,
        defaultBusinessName: profile.displayName ?? "",
      }}
    />
  );
}
