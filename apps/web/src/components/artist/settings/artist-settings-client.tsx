"use client";

import { UserButton } from "@clerk/nextjs";
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  Clock3,
  History,
  Loader2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  commitArtistDisconnectAction,
  previewArtistDisconnectAction,
  saveArtistNotificationPreferencesAction,
  saveArtistTimezoneAction,
  type ArtistDisconnectPreviewActionResult,
} from "~/app/(artist)/artist/settings/actions";
import { useTabSwipe } from "~/components/native/use-tab-swipe";
import { PushPreferences } from "~/components/push/push-preferences";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { formatTimeZoneSettingLabel } from "~/lib/timezone-display";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { ResolvedArtistNotificationPreferences } from "~/server/artist/profile";

import {
  ARTIST_SETTINGS_SECTION_KEYS,
  ARTIST_SETTINGS_SECTIONS,
  type ArtistSettingsSection,
  type ArtistSettingsSectionKey,
} from "./artist-settings-sections";

type ConnectedStudio = Readonly<{
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}>;

type PastStudio = Readonly<{
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  disconnectedAtIso: string;
}>;

type ArtistIdentity = Readonly<{
  fullName: string;
  email: string;
  imageUrl: string | null;
  joinedLabel: string | null;
}>;

type Category = keyof ResolvedArtistNotificationPreferences;

const NOTIFICATION_ROWS: readonly Readonly<{
  category: Category;
  label: string;
  detail: string;
  emailKey: "transactionalEmail" | "activityEmail";
}>[] = [
  {
    category: "purchase",
    label: "Purchases",
    detail: "Request approvals and declines",
    emailKey: "transactionalEmail",
  },
  {
    category: "proof",
    label: "Payment proofs",
    detail: "Proof verified or rejected",
    emailKey: "transactionalEmail",
  },
  {
    category: "booking",
    label: "Session changes",
    detail: "Confirmations, declines, changes and cancellations",
    emailKey: "transactionalEmail",
  },
  {
    category: "session_reminder",
    label: "Session reminders",
    detail: "24-hour and 1-hour reminders",
    emailKey: "transactionalEmail",
  },
  {
    category: "new_music",
    label: "New music",
    detail: "A new track version is ready",
    emailKey: "activityEmail",
  },
  {
    category: "producer_comment",
    label: "Producer comments",
    detail: "A producer commented on your music",
    emailKey: "activityEmail",
  },
] as const;

const SECTION_ICONS = {
  profile: UserRound,
  notifications: Bell,
  timezone: Clock3,
  studios: ShieldCheck,
} satisfies Record<ArtistSettingsSection["iconKey"], typeof UserRound>;

function studioInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "S"
  );
}

function StudioMark({
  name,
  logoUrl,
  size = "md",
}: {
  name: string;
  logoUrl: string | null;
  size?: "sm" | "md";
}) {
  const dimensions = size === "sm" ? "h-9 w-9 text-[11px]" : "h-11 w-11 text-xs";
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={`${dimensions} shrink-0 rounded-[var(--radius-sm)] object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`font-display ${dimensions} flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-extrabold text-[rgb(var(--fg-onsidebar))]`}
      style={{
        background:
          "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
      }}
    >
      {studioInitials(name)}
    </span>
  );
}

function PreferenceSwitch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-lg)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`relative h-6 w-10 rounded-[var(--radius-lg)] border transition-colors motion-reduce:transition-none ${
          checked
            ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))]"
            : "border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-overlay))]"
        }`}
      >
        <span
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left] motion-reduce:transition-none ${
            checked ? "left-[19px]" : "left-[3px]"
          }`}
        />
      </span>
    </button>
  );
}

export function ArtistSettingsClient({
  initialActive = "profile",
  identity,
  initialTimezone,
  initialPreferences,
  connectedStudios,
  pastStudios,
  previewOnly = false,
}: {
  initialActive?: ArtistSettingsSectionKey;
  identity: ArtistIdentity;
  initialTimezone: string | null;
  initialPreferences: ResolvedArtistNotificationPreferences;
  connectedStudios: readonly ConnectedStudio[];
  pastStudios: readonly PastStudio[];
  previewOnly?: boolean;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [active, setActive] = useState<ArtistSettingsSectionKey>(initialActive);
  const [timezone, setTimezone] = useState(initialTimezone ?? "");
  const [savedTimezone, setSavedTimezone] = useState(initialTimezone ?? "");
  const [timezoneStatus, setTimezoneStatus] = useState<string | null>(null);
  const [timezonePending, startTimezoneTransition] = useTransition();
  const detectedTimezoneSaved = useRef(false);
  const [preferences, setPreferences] =
    useState<ResolvedArtistNotificationPreferences>(initialPreferences);
  const [savedPreferences, setSavedPreferences] =
    useState<ResolvedArtistNotificationPreferences>(initialPreferences);
  const [preferenceStatus, setPreferenceStatus] = useState<string | null>(null);
  const [preferencesPending, startPreferencesTransition] = useTransition();
  const [disconnectStudio, setDisconnectStudio] = useState<ConnectedStudio | null>(null);
  const [disconnectPreview, setDisconnectPreview] = useState<
    Extract<ArtistDisconnectPreviewActionResult, { ok: true }>["preview"] | null
  >(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [previewPending, startPreviewTransition] = useTransition();
  const [disconnectPending, startDisconnectTransition] = useTransition();

  const changeSection = (next: ArtistSettingsSectionKey) => {
    setActive(next);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("section", next);
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  };

  const tabSwipeHandlers = useTabSwipe({
    items: ARTIST_SETTINGS_SECTION_KEYS,
    value: active,
    onChange: changeSection,
  });

  const dirtySections = useMemo<Set<ArtistSettingsSectionKey>>(() => {
    const dirty = new Set<ArtistSettingsSectionKey>();
    if (timezone !== savedTimezone) dirty.add("timezone");
    if (JSON.stringify(preferences) !== JSON.stringify(savedPreferences)) {
      dirty.add("notifications");
    }
    return dirty;
  }, [preferences, savedPreferences, savedTimezone, timezone]);

  const timezoneOptions = useMemo(() => {
    let supported: string[];
    try {
      supported = Intl.supportedValuesOf("timeZone");
    } catch {
      supported = [
        "America/Los_Angeles",
        "America/New_York",
        "Asia/Jerusalem",
        "Australia/Sydney",
        "Europe/Berlin",
        "Europe/London",
      ];
    }
    return ["UTC", ...supported.filter((zone) => zone !== "UTC")];
  }, []);

  useEffect(() => {
    if (initialTimezone || detectedTimezoneSaved.current) return;
    detectedTimezoneSaved.current = true;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected) return;
    setTimezone(detected);
    if (previewOnly) {
      setSavedTimezone(detected);
      setTimezoneStatus("Browser timezone detected.");
      return;
    }
    startTimezoneTransition(async () => {
      const result = await saveArtistTimezoneAction({ timezone: detected });
      if (result.ok) setSavedTimezone(result.timezone);
      setTimezoneStatus(result.ok ? "Browser timezone saved." : result.error);
    });
  }, [initialTimezone, previewOnly]);

  const saveTimezone = () => {
    if (!timezone || !online) return;
    setTimezoneStatus(null);
    if (previewOnly) {
      setSavedTimezone(timezone);
      setTimezoneStatus("Timezone saved.");
      return;
    }
    startTimezoneTransition(async () => {
      const result = await saveArtistTimezoneAction({ timezone });
      if (result.ok) setSavedTimezone(result.timezone);
      setTimezoneStatus(result.ok ? "Timezone saved." : result.error);
    });
  };

  const setPreference = (
    category: Category,
    key: "inApp" | "transactionalEmail" | "activityEmail",
  ) => {
    setPreferenceStatus(null);
    setPreferences((current) => ({
      ...current,
      [category]: {
        ...current[category],
        [key]: !current[category][key],
      },
    }));
  };

  const savePreferences = () => {
    if (!online) return;
    setPreferenceStatus(null);
    if (previewOnly) {
      setSavedPreferences(preferences);
      setPreferenceStatus("Notification preferences saved.");
      return;
    }
    startPreferencesTransition(async () => {
      const result = await saveArtistNotificationPreferencesAction(preferences);
      if (!result.ok) {
        setPreferenceStatus(result.error);
        return;
      }
      setPreferences(result.preferences);
      setSavedPreferences(result.preferences);
      setPreferenceStatus("Notification preferences saved.");
    });
  };

  const openDisconnect = (studio: ConnectedStudio) => {
    setDisconnectStudio(studio);
    setDisconnectPreview(null);
    setDisconnectError(null);
    if (previewOnly) {
      setDisconnectPreview({
        producerId: studio.producerId,
        producerName: studio.name,
        producerSlug: studio.slug,
        canDisconnect: true,
        blockers: [],
      });
      return;
    }
    if (!online) {
      setDisconnectError("Reconnect before managing this studio.");
      return;
    }
    startPreviewTransition(async () => {
      const result = await previewArtistDisconnectAction({
        producerId: studio.producerId,
      });
      if (!result.ok) {
        setDisconnectError(result.error);
        return;
      }
      setDisconnectPreview(result.preview);
    });
  };

  const confirmDisconnect = () => {
    if (!disconnectStudio || !disconnectPreview?.canDisconnect || !online) return;
    setDisconnectError(null);
    if (previewOnly) {
      setDisconnectStudio(null);
      setDisconnectPreview(null);
      return;
    }
    startDisconnectTransition(async () => {
      const result = await commitArtistDisconnectAction({
        producerId: disconnectStudio.producerId,
      });
      if (!result.ok) {
        setDisconnectError(result.error);
        if (result.blockers) {
          setDisconnectPreview((current) =>
            current
              ? { ...current, canDisconnect: false, blockers: result.blockers ?? [] }
              : current,
          );
        }
        return;
      }
      setDisconnectStudio(null);
      setDisconnectPreview(null);
      router.refresh();
    });
  };

  return (
    <div
      className="mx-auto w-full max-w-5xl"
      data-role-switch-unsaved={
        dirtySections.size > 0 ? "true" : undefined
      }
    >
      <nav
        aria-label="Settings sections"
        className="no-scrollbar -mx-4 mb-5 overflow-x-auto border-b border-[rgb(var(--border-subtle))] px-4 sm:mx-0 sm:px-0"
      >
        <div className="flex min-w-max items-center gap-1 pb-2">
          {ARTIST_SETTINGS_SECTIONS.map((section) => {
            const Icon = SECTION_ICONS[section.iconKey];
            const isActive = active === section.key;
            const isDirty = dirtySections.has(section.key);
            return (
              <button
                key={section.key}
                type="button"
                aria-current={isActive ? "page" : undefined}
                data-artist-settings-section={section.key}
                onClick={() => {
                  changeSection(section.key);
                }}
                className={`sk-press relative flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-lg)] px-3.5 text-[13px] font-semibold transition-[background,color,box-shadow] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none motion-reduce:transition-none ${
                  isActive
                    ? "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-onsidebar))] shadow-[0_4px_14px_rgb(17_16_9/0.16)]"
                    : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]"
                }`}
              >
                <Icon size={15} strokeWidth={1.8} aria-hidden className="hidden sm:block" />
                <span>{section.label}</span>
                {isDirty ? (
                  <span
                    aria-label="Unsaved changes in this section"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="[touch-action:pan-y_pinch-zoom]" data-tab-swipe-surface {...tabSwipeHandlers}>
        <div className="w-full max-w-[760px]" data-tab-swipe-panel>
          {active === "profile" ? (
            <section
              aria-labelledby="profile-heading"
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
            >
              <div className="mb-4 flex items-center gap-2">
                <UserRound size={17} aria-hidden className="text-[rgb(var(--brand-primary))]" />
                <h2
                  id="profile-heading"
                  className="font-display text-base font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
                >
                  Profile
                </h2>
              </div>
              <div className="flex items-center gap-4">
                {identity.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={identity.imageUrl}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-[rgb(var(--border-subtle))]"
                  />
                ) : (
                  <div className="font-display flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-overlay))] text-lg font-extrabold text-[rgb(var(--fg-secondary))]">
                    {studioInitials(identity.fullName)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-[rgb(var(--fg-default))]">
                    {identity.fullName}
                  </p>
                  <p className="truncate text-[13px] text-[rgb(var(--fg-muted))]">
                    {identity.email}
                  </p>
                  {identity.joinedLabel ? (
                    <p className="mt-1 font-mono text-[10px] tracking-wide text-[rgb(var(--fg-muted))] uppercase">
                      Joined {identity.joinedLabel}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0">
                  {previewOnly ? (
                    <span
                      aria-label="Account menu preview"
                      className="font-display flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-xs font-extrabold text-[rgb(var(--fg-on-brand))] ring-1 ring-[rgb(var(--border-subtle))]"
                    >
                      {studioInitials(identity.fullName)}
                    </span>
                  ) : (
                    <UserButton
                      appearance={{
                        elements: {
                          avatarBox: "h-11 w-11 ring-1 ring-[rgb(var(--border-subtle))]",
                        },
                      }}
                    />
                  )}
                </div>
              </div>
              <p className="mt-4 border-t border-[rgb(var(--border-subtle))] pt-3 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                Use the account menu to update your name, photo, email, or sign out.
              </p>
            </section>
          ) : null}

          {active === "notifications" ? (
            <div className="mb-5">
              <PushPreferences role="artist" />
            </div>
          ) : null}

          {active === "notifications" ? (
            <section
              aria-labelledby="notifications-heading"
              className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Bell size={17} aria-hidden className="text-[rgb(var(--brand-primary))]" />
                    <h2
                      id="notifications-heading"
                      className="font-display text-base font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
                    >
                      Notifications
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
                    Choose how each update reaches you.
                  </p>
                </div>
                <div
                  aria-hidden
                  className="grid shrink-0 grid-cols-2 gap-2 font-mono text-[9px] font-semibold tracking-wider text-[rgb(var(--fg-muted))] uppercase"
                >
                  <span className="w-11 text-center">In app</span>
                  <span className="w-11 text-center">Email</span>
                </div>
              </div>
              <div className="divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
                {NOTIFICATION_ROWS.map((row) => (
                  <div
                    key={row.category}
                    className="flex min-h-[68px] items-center gap-3 px-5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                        {row.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
                        {row.detail}
                      </p>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-2">
                      <PreferenceSwitch
                        checked={preferences[row.category].inApp}
                        disabled={preferencesPending}
                        label={`${row.label} in-app notifications`}
                        onChange={() => {
                          setPreference(row.category, "inApp");
                        }}
                      />
                      <PreferenceSwitch
                        checked={preferences[row.category][row.emailKey]}
                        disabled={preferencesPending}
                        label={`${row.label} email notifications`}
                        onChange={() => {
                          setPreference(row.category, row.emailKey);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p
                  role={preferenceStatus?.includes("couldn’t") ? "alert" : "status"}
                  className="min-h-5 text-xs text-[rgb(var(--fg-muted))]"
                >
                  {preferenceStatus ?? (!online ? "Reconnect to save changes." : "")}
                </p>
                <button
                  type="button"
                  onClick={savePreferences}
                  disabled={preferencesPending || !online}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[12px] font-bold text-[rgb(var(--bg-elevated))] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
                >
                  {preferencesPending ? (
                    <Loader2
                      size={15}
                      aria-hidden
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : null}
                  Save notifications
                </button>
              </div>
            </section>
          ) : null}

          {active === "timezone" ? (
            <section
              aria-labelledby="timezone-heading"
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
            >
              <div className="flex items-center gap-2">
                <Clock3 size={17} aria-hidden className="text-[rgb(var(--brand-primary))]" />
                <h2
                  id="timezone-heading"
                  className="font-display text-base font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
                >
                  Timezone
                </h2>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                Session times and reminders use this timezone.
              </p>
              <label
                htmlFor="artist-timezone"
                className="mt-4 block font-mono text-[10px] font-semibold tracking-wider text-[rgb(var(--fg-muted))] uppercase"
              >
                Your timezone
              </label>
              <select
                id="artist-timezone"
                value={timezone}
                onChange={(event) => {
                  setTimezone(event.target.value);
                  setTimezoneStatus(null);
                }}
                disabled={timezonePending}
                className="mt-2 min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-background))] px-3 text-sm text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-60"
              >
                {timezone && !timezoneOptions.includes(timezone) ? (
                  <option value={timezone}>{timezone}</option>
                ) : null}
                {timezoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {formatTimeZoneSettingLabel(zone)}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p
                  role={timezoneStatus?.includes("couldn’t") ? "alert" : "status"}
                  className="text-xs text-[rgb(var(--fg-muted))]"
                >
                  {timezoneStatus ?? ""}
                </p>
                <button
                  type="button"
                  onClick={saveTimezone}
                  disabled={!timezone || timezonePending || !online}
                  className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] px-4 text-[12px] font-bold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
                >
                  {timezonePending ? "Saving…" : "Save"}
                </button>
              </div>
            </section>
          ) : null}

          {active === "studios" ? (
            <div className="space-y-5">
              <section
                aria-labelledby="studios-heading"
                className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
              >
                <div className="px-5 pt-5 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck
                      size={17}
                      aria-hidden
                      className="text-[rgb(var(--brand-primary))]"
                    />
                    <h2
                      id="studios-heading"
                      className="font-display text-base font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
                    >
                      Connected studios
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
                    {connectedStudios.length} active{" "}
                    {connectedStudios.length === 1 ? "connection" : "connections"}
                  </p>
                </div>
                {connectedStudios.length === 0 ? (
                  <p className="border-t border-[rgb(var(--border-subtle))] px-5 py-4 text-sm text-[rgb(var(--fg-muted))]">
                    No connected studios.
                  </p>
                ) : (
                  <ul className="divide-y divide-[rgb(var(--border-subtle))] border-t border-[rgb(var(--border-subtle))]">
                    {connectedStudios.map((studio) => (
                      <li key={studio.producerId} className="flex items-center gap-3 px-4 py-3">
                        <StudioMark name={studio.name} logoUrl={studio.logoUrl} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                            {studio.name}
                          </p>
                          <p className="truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
                            {studio.slug}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            openDisconnect(studio);
                          }}
                          className="min-h-11 rounded-[var(--radius-lg)] px-3 text-[11px] font-bold text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                        >
                          Disconnect
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                aria-labelledby="past-studios-heading"
                className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
              >
                <div className="px-5 pt-5 pb-3">
                  <div className="flex items-center gap-2">
                    <History size={17} aria-hidden className="text-[rgb(var(--brand-primary))]" />
                    <h2
                      id="past-studios-heading"
                      className="font-display text-base font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
                    >
                      Past studios
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
                    Read-only records from disconnected studios.
                  </p>
                </div>
                {pastStudios.length === 0 ? (
                  <p className="border-t border-[rgb(var(--border-subtle))] px-5 py-4 text-sm text-[rgb(var(--fg-muted))]">
                    No past studios.
                  </p>
                ) : (
                  <ul className="divide-y divide-[rgb(var(--border-subtle))] border-t border-[rgb(var(--border-subtle))]">
                    {pastStudios.map((studio) => (
                      <li
                        key={studio.producerId}
                        id={previewOnly ? `past-studio-${studio.producerId}` : undefined}
                      >
                        <Link
                          href={
                            previewOnly
                              ? `#past-studio-${studio.producerId}`
                              : `/artist/settings/studios/${studio.producerId}`
                          }
                          className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
                        >
                          <StudioMark name={studio.name} logoUrl={studio.logoUrl} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                              {studio.name}
                            </p>
                            <p className="mt-0.5 text-[10.5px] text-[rgb(var(--fg-muted))]">
                              Disconnected{" "}
                              {new Intl.DateTimeFormat(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              }).format(new Date(studio.disconnectedAtIso))}
                            </p>
                          </div>
                          <ChevronRight
                            size={16}
                            aria-hidden
                            className="text-[rgb(var(--fg-muted))]"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog
        open={disconnectStudio !== null}
        onOpenChange={(open) => {
          if (!open && !disconnectPending) {
            setDisconnectStudio(null);
            setDisconnectPreview(null);
            setDisconnectError(null);
          }
        }}
      >
        <DialogContent className="gap-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-10">
              {disconnectPreview && !disconnectPreview.canDisconnect
                ? "Disconnect unavailable"
                : `Disconnect from ${disconnectStudio?.name ?? "studio"}?`}
            </DialogTitle>
            <DialogDescription className="mt-2 leading-relaxed">
              {disconnectPreview?.canDisconnect
                ? "This studio will leave your active workspace. Finished music, payment records, sessions, and downloads you already earned remain available under Past studios."
                : "We’ll check for active work before anything changes."}
            </DialogDescription>
          </DialogHeader>

          <div className="my-5">
            {previewPending ? (
              <div
                role="status"
                className="flex items-center gap-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-overlay))] p-4 text-sm text-[rgb(var(--fg-secondary))]"
              >
                <Loader2
                  size={18}
                  aria-hidden
                  className="animate-spin motion-reduce:animate-none"
                />
                Checking this studio…
              </div>
            ) : disconnectPreview && !disconnectPreview.canDisconnect ? (
              <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.06)] p-4">
                <div className="flex items-center gap-2 text-[13px] font-bold text-[rgb(var(--fg-danger))]">
                  <AlertTriangle size={17} aria-hidden />
                  Resolve these items first
                </div>
                <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-[rgb(var(--fg-secondary))]">
                  {disconnectPreview.blockers.map((blocker) => (
                    <li key={blocker.kind} className="flex gap-2">
                      <span aria-hidden>•</span>
                      <span>{blocker.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : disconnectPreview?.canDisconnect ? (
              <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-4 text-[12px] leading-relaxed text-[rgb(var(--fg-secondary))]">
                Disconnecting does not delete the producer’s records. Your preserved history becomes
                read-only.
              </div>
            ) : null}

            {disconnectError ? (
              <p
                role="alert"
                className="mt-3 text-[12px] leading-relaxed text-[rgb(var(--fg-danger))]"
              >
                {disconnectError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                disabled={disconnectPending}
                className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] px-4 text-[12px] font-bold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
              >
                {disconnectPreview && !disconnectPreview.canDisconnect ? "Close" : "Cancel"}
              </button>
            </DialogClose>
            {disconnectPreview?.canDisconnect ? (
              <button
                type="button"
                onClick={confirmDisconnect}
                disabled={disconnectPending || !online}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-4 text-[12px] font-bold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
              >
                {disconnectPending ? (
                  <Loader2
                    size={15}
                    aria-hidden
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : null}
                Disconnect studio
              </button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
