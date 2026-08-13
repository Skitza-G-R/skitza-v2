"use client";

import { useAuth } from "@clerk/nextjs";
import { flushSync } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  captureAccountPrivateWriteGeneration,
  isAccountPrivateRuntimeWriteAllowed,
} from "~/lib/runtime-state/account-exit";
import {
  announceRuntimeMainNavigationIntent,
  captureRuntimeMainNavigationTarget,
  RUNTIME_MAIN_NAVIGATION_DESTINATION_ATTRIBUTE,
  RUNTIME_MAIN_NAVIGATION_PRESENTATION_EVENT,
  RUNTIME_MAIN_NAVIGATION_RELEASE_GUARD_UNTIL_ATTRIBUTE,
  resolveRuntimeMainNavigationHref,
  type RuntimeMainNavigationIntentDetail,
} from "~/lib/runtime-state/navigation-cache";
import {
  findOnlyRuntimeStateUserId,
  getBrowserRuntimeStorage,
  readRuntimeLaunchTarget,
  readRuntimeScreenSafeView,
  writeRuntimeScreenSafeView,
  type RuntimeRole,
  type RuntimeScreenSafeView,
} from "~/lib/runtime-state/runtime-state";
import {
  desktopSavedScreenPreviewEnabled,
  desktopSessionCacheAccess,
  subscribeDesktopSessionValidation,
} from "~/lib/desktop/session-validation";
import { recordGate1MeaningfulPaint, startGate1Journey } from "~/lib/desktop/gate1-proof";

import { useOnlineStatus } from "./online-required-link";
import { useRuntimeState } from "./runtime-state-provider";

const RUNTIME_ROLE_RESOLVER_HREF = "/launch/resolve";

const PRODUCER_NAV = [
  ["/dashboard/music", "Music"],
  ["/dashboard/clients-projects", "Clients"],
  ["/dashboard", "Today"],
  ["/dashboard/calendar", "Calendar"],
  ["/dashboard/payments", "Payments"],
] as const;

const ARTIST_NAV = [
  ["/artist", "Home"],
  ["/artist/music", "Music"],
  ["/artist/sessions", "Sessions"],
  ["/artist/store", "Store"],
] as const;

interface PendingRuntimeScreen {
  desktopPreview: boolean;
  href: string;
  identityKey: string;
  localOnly: boolean;
  originHref: string;
  view: RuntimeScreenSafeView | null;
  warm: boolean;
}

interface ResumeState {
  target: {
    userId: string;
    role: RuntimeRole;
    contextId: string;
    href: string;
  };
  view: RuntimeScreenSafeView | null;
}

function hrefFromLocation(pathname: string, searchParams: URLSearchParams): string {
  const search = searchParams.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

function runtimeRoleResolverHref(nextHref: string | null): string {
  if (!nextHref) return RUNTIME_ROLE_RESOLVER_HREF;
  const search = new URLSearchParams({ next: nextHref });
  return `${RUNTIME_ROLE_RESOLVER_HREF}?${search.toString()}`;
}

function destinationLabel(href: string, role: RuntimeRole): string {
  const pathname = new URL(href, "https://runtime.skitza.invalid").pathname;
  const entries = role === "producer" ? PRODUCER_NAV : ARTIST_NAV;
  const exact = entries.find(([route]) => route === pathname);
  if (exact) return exact[1];

  if (role === "producer") {
    if (pathname.startsWith("/dashboard/store")) return "Store";
    if (pathname.startsWith("/dashboard/portfolio")) return "Portfolio";
    if (pathname.startsWith("/dashboard/settings")) return "Settings";
    if (pathname.startsWith("/dashboard/requests")) return "Requests";
    return "Studio";
  }

  if (pathname.startsWith("/artist/sessions")) return "Sessions";
  if (pathname.startsWith("/artist/settings")) return "Settings";
  return "Artist";
}

function isActiveDestination(currentHref: string, destination: string): boolean {
  const current = new URL(currentHref, "https://runtime.skitza.invalid").pathname;
  if (destination === "/dashboard" || destination === "/artist") {
    return current === destination;
  }
  return current === destination || current.startsWith(`${destination}/`);
}

export function RuntimeScreenSafeViewWriter({
  view,
  href,
  contextId,
}: {
  view: RuntimeScreenSafeView;
  href?: string;
  contextId?: string;
}) {
  return href !== undefined ? (
    <RuntimeScreenSafeViewWriterAtHref view={view} href={href} contextId={contextId} />
  ) : (
    <RuntimeScreenSafeViewWriterForCurrentRoute view={view} contextId={contextId} />
  );
}

function RuntimeScreenSafeViewWriterForCurrentRoute({
  view,
  contextId,
}: {
  view: RuntimeScreenSafeView;
  contextId: string | undefined;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <RuntimeScreenSafeViewWriterAtHref
      view={view}
      href={hrefFromLocation(pathname, searchParams)}
      contextId={contextId}
    />
  );
}

function RuntimeScreenSafeViewWriterAtHref({
  view,
  href,
  contextId,
}: {
  view: RuntimeScreenSafeView;
  href: string;
  contextId: string | undefined;
}) {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const writeGeneration = useMemo(
    () => captureAccountPrivateWriteGeneration(identity.userId),
    [identity.userId],
  );

  useLayoutEffect(() => {
    if (
      !privateStateAccessAllowed ||
      !storage ||
      (contextId !== undefined && contextId !== identity.contextId) ||
      !isAccountPrivateRuntimeWriteAllowed(writeGeneration)
    ) {
      return;
    }
    writeRuntimeScreenSafeView(storage, identity, href, view);
  }, [contextId, href, identity, privateStateAccessAllowed, storage, view, writeGeneration]);

  useEffect(() => {
    if (!privateStateAccessAllowed) return;
    const meaningful =
      view.title.trim().length > 0 &&
      (view.metrics.length > 0 || view.sections.some((section) => section.items.length > 0));
    if (!meaningful) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const proofScreen =
          href === "/dashboard"
            ? "today"
            : href === "/dashboard/clients-projects"
              ? "clients-projects"
              : null;
        recordGate1MeaningfulPaint({
          href,
          root: proofScreen
            ? document.querySelector<HTMLElement>(`[data-gate1-meaningful-screen="${proofScreen}"]`)
            : null,
          source: "server",
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [href, privateStateAccessAllowed, view]);

  return null;
}

export function RuntimeScreenPreview({
  view,
  proofHref,
  source = "cache",
  refreshing,
}: {
  view: RuntimeScreenSafeView;
  proofHref?: string;
  source?: "cache" | "resume";
  refreshing: boolean;
}) {
  const proofRootRef = useRef<HTMLDivElement>(null);
  const meaningful =
    view.title.trim().length > 0 &&
    (view.metrics.length > 0 || view.sections.some((section) => section.items.length > 0));

  useEffect(() => {
    if (!meaningful) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        recordGate1MeaningfulPaint({
          href: proofHref ?? window.location.pathname,
          root: proofRootRef.current,
          source,
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [meaningful, proofHref, source, view]);

  return (
    <div
      ref={proofRootRef}
      aria-label={`${view.title} saved view`}
      aria-busy={refreshing || undefined}
      data-runtime-screen-source={source}
      className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 pt-5 pb-24 sm:px-6 lg:gap-5 lg:px-8 lg:pt-8"
    >
      {refreshing ? (
        <p role="status" className="sr-only">
          Updating {view.title}
        </p>
      ) : null}

      <header>
        <h1 className="font-syne text-[32px] leading-none font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))] lg:text-[38px]">
          {view.title}
        </h1>
        {view.subtitle ? (
          <p className="mt-2 text-sm text-[rgb(var(--fg-muted))]">{view.subtitle}</p>
        ) : null}
      </header>

      {view.metrics.length > 0 ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {view.metrics.map((metric) => (
            <div
              key={`${metric.label}:${metric.value}`}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[var(--shadow-sm)]"
            >
              <dt className="text-[11px] font-semibold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                {metric.label}
              </dt>
              <dd className="mt-1 text-xl font-extrabold text-[rgb(var(--fg-default))]">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {view.sections.map((section) => (
        <section
          key={section.label}
          className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
        >
          <h2 className="border-b border-[rgb(var(--border-subtle))] px-4 py-3 font-mono text-[11px] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
            {section.label}
          </h2>
          {section.items.length > 0 ? (
            <ul role="list" className="divide-y divide-[rgb(var(--border-subtle))]">
              {section.items.map((item) => (
                <li key={item.key} className="flex min-w-0 items-center gap-3 px-4 py-3">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                      {item.title}
                    </span>
                    {item.detail ? (
                      <span className="mt-0.5 block truncate text-xs text-[rgb(var(--fg-muted))]">
                        {item.detail}
                      </span>
                    ) : null}
                  </span>
                  {item.badge ? (
                    <span className="shrink-0 rounded-full bg-[rgb(var(--bg-sunken))] px-2 py-1 text-[10px] font-bold text-[rgb(var(--fg-secondary))]">
                      {item.badge}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-5 text-sm text-[rgb(var(--fg-muted))]">
              Nothing saved in this section yet.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

export function RuntimeDestinationScaffold({
  href,
  role,
  offline = false,
}: {
  href: string;
  role: RuntimeRole;
  offline?: boolean;
}) {
  const label = destinationLabel(href, role);
  return (
    <div
      aria-busy={!offline}
      aria-label={`Loading ${label}`}
      data-runtime-screen-source="scaffold"
      className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 pt-5 pb-24 sm:px-6 lg:gap-5 lg:px-8 lg:pt-8"
    >
      <header>
        <h1 className="font-syne text-[32px] leading-none font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))] lg:text-[38px]">
          {label}
        </h1>
        <p className="mt-2 text-sm text-[rgb(var(--fg-muted))]">
          {offline
            ? `Reconnect to load the latest ${label.toLowerCase()} data.`
            : `Loading the latest ${label.toLowerCase()} data…`}
        </p>
      </header>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-[74px] animate-pulse rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-3 last:border-b-0"
          >
            <div className="size-9 animate-pulse rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] motion-reduce:animate-none" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-2/3 animate-pulse rounded bg-[rgb(var(--bg-sunken))] motion-reduce:animate-none" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-[rgb(var(--bg-sunken))] motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RuntimeLaunchCover() {
  return (
    <div className="sk-pwa-startup" data-runtime-launch-cover="">
      <div
        className="sk-pwa-startup__lockup"
        role="status"
        aria-label="Opening Skitza…"
        aria-live="polite"
      >
        <span className="sk-pwa-startup__pulse" aria-hidden="true">
          {/* The install icon is precached; a regular img remains available
              offline while Next's image optimizer is network-only. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="sk-pwa-startup__mark"
            src="/icons/skitza-192.png"
            width="96"
            height="96"
            alt=""
          />
        </span>
        <span className="sk-pwa-startup__wordmark">
          Skitza<span aria-hidden="true">.</span>
        </span>
        <span className="sk-pwa-startup__status">Opening Skitza…</span>
      </div>
    </div>
  );
}

export function RuntimeScreenTransitionBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const online = useOnlineStatus();
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const [pending, setPending] = useState<PendingRuntimeScreen | null>(null);
  const [, setDesktopValidationVersion] = useState(0);
  const currentHref = hrefFromLocation(pathname, searchParams);
  const identityKey = `${identity.userId}:${identity.role}:${identity.contextId}`;
  const desktopPreviewEnabled = desktopSavedScreenPreviewEnabled();
  const desktopCacheAccess = desktopSessionCacheAccess(identity.userId, online);
  const desktopPreviewAllowed = desktopCacheAccess.kind === "web" || desktopCacheAccess.allowed;

  useEffect(
    () =>
      subscribeDesktopSessionValidation(() => {
        setDesktopValidationVersion((version) => version + 1);
      }),
    [],
  );

  const clearPending = useCallback(() => {
    setPending(null);
    delete document.documentElement.dataset.skScreenSource;
  }, []);

  useLayoutEffect(() => {
    const onOfflineNavigationClick = (event: MouseEvent) => {
      if (
        navigator.onLine ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLElement>(
        `[${RUNTIME_MAIN_NAVIGATION_DESTINATION_ATTRIBUTE}]`,
      );
      const requestedHref = link?.getAttribute(RUNTIME_MAIN_NAVIGATION_DESTINATION_ATTRIBUTE);
      if (!link || !requestedHref) return;

      const releaseGuardDeadline = Number(
        link.getAttribute(RUNTIME_MAIN_NAVIGATION_RELEASE_GUARD_UNTIL_ATTRIBUTE),
      );
      if (Number.isFinite(releaseGuardDeadline) && Date.now() <= releaseGuardDeadline) {
        event.preventDefault();
        return;
      }
      link.removeAttribute(RUNTIME_MAIN_NAVIGATION_RELEASE_GUARD_UNTIL_ATTRIBUTE);

      const targetHref = resolveRuntimeMainNavigationHref(requestedHref, {
        role: identity.role,
        contextId: identity.contextId,
      });
      if (!targetHref) {
        return;
      }
      if (targetHref === currentHref) {
        if (!pending || pending.originHref !== currentHref) return;
        event.preventDefault();
        captureRuntimeMainNavigationTarget(link);
        announceRuntimeMainNavigationIntent(targetHref, { localOnly: true });
        return;
      }

      event.preventDefault();
      captureRuntimeMainNavigationTarget(link);
      announceRuntimeMainNavigationIntent(targetHref, { localOnly: true });
    };

    document.addEventListener("click", onOfflineNavigationClick, true);
    return () => {
      document.removeEventListener("click", onOfflineNavigationClick, true);
    };
  }, [currentHref, identity, pending]);

  useLayoutEffect(() => {
    const onPresentation = (event: Event) => {
      const detail = (
        event as CustomEvent<Partial<RuntimeMainNavigationIntentDetail> | undefined>
      ).detail;
      if (!detail || typeof detail.href !== "string") return;

      const targetHref = resolveRuntimeMainNavigationHref(detail.href, {
        role: identity.role,
        contextId: identity.contextId,
      });
      if (!targetHref) return;
      if (targetHref === currentHref) {
        if (pending?.originHref === currentHref) flushSync(clearPending);
        return;
      }

      const localOnly = detail.localOnly === true || !navigator.onLine;
      if (targetHref === "/dashboard/clients-projects") {
        startGate1Journey("safe-clients-projects");
      }
      const desktopAccessAllowed = !desktopPreviewEnabled || desktopPreviewAllowed;
      const mayReadSavedView =
        desktopAccessAllowed &&
        (localOnly || desktopPreviewEnabled) &&
        privateStateAccessAllowed &&
        storage;
      const view = mayReadSavedView
        ? readRuntimeScreenSafeView(storage, identity, targetHref)
        : null;
      const warm =
        desktopAccessAllowed && !localOnly && !view && detail.warm === true;
      if (warm) {
        delete document.documentElement.dataset.skScreenSource;
      } else {
        document.documentElement.dataset.skScreenSource = view ? "cache" : "scaffold";
      }
      flushSync(() => {
        setPending({
          desktopPreview: desktopPreviewEnabled,
          href: targetHref,
          identityKey,
          localOnly,
          originHref: currentHref,
          view,
          warm,
        });
      });
    };

    window.addEventListener(RUNTIME_MAIN_NAVIGATION_PRESENTATION_EVENT, onPresentation);
    return () => {
      window.removeEventListener(RUNTIME_MAIN_NAVIGATION_PRESENTATION_EVENT, onPresentation);
    };
  }, [
    clearPending,
    currentHref,
    identityKey,
    identity,
    desktopPreviewAllowed,
    desktopPreviewEnabled,
    pending,
    privateStateAccessAllowed,
    storage,
  ]);

  useLayoutEffect(() => {
    if (
      online ||
      !pending ||
      pending.localOnly ||
      pending.identityKey !== identityKey ||
      currentHref !== pending.originHref
    ) {
      return;
    }

    const desktopAccessAllowed = !pending.desktopPreview || desktopPreviewAllowed;
    const view = desktopAccessAllowed && privateStateAccessAllowed && storage
      ? readRuntimeScreenSafeView(storage, identity, pending.href)
      : null;
    document.documentElement.dataset.skScreenSource = view ? "cache" : "scaffold";
    setPending({
      ...pending,
      localOnly: true,
      view,
      warm: false,
    });
  }, [
    currentHref,
    desktopPreviewAllowed,
    identity,
    identityKey,
    online,
    pending,
    privateStateAccessAllowed,
    storage,
  ]);

  useLayoutEffect(() => {
    if (!pending) return;
    if (pending.identityKey !== identityKey) {
      clearPending();
      return;
    }
    if (
      pending.desktopPreview &&
      (!privateStateAccessAllowed || !desktopPreviewAllowed)
    ) {
      if (pending.view || pending.warm) {
        document.documentElement.dataset.skScreenSource = "scaffold";
        setPending({ ...pending, view: null, warm: false });
      }
      return;
    }

    const committedHref = resolveRuntimeMainNavigationHref(currentHref, {
      role: identity.role,
      contextId: identity.contextId,
    });
    if (currentHref === pending.originHref) return;
    if (committedHref !== pending.href) {
      clearPending();
      return;
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(clearPending);
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    clearPending,
    currentHref,
    identity.contextId,
    identity.role,
    identityKey,
    pending,
    desktopPreviewAllowed,
    privateStateAccessAllowed,
  ]);

  useEffect(() => {
    if (
      !pending?.localOnly ||
      pending.identityKey !== identityKey ||
      currentHref !== pending.originHref
    ) {
      return;
    }
    const onOnline = () => {
      setPending((value) => (value ? { ...value, localOnly: false } : value));
      router.push(pending.href);
    };
    window.addEventListener("online", onOnline, { once: true });
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [
    currentHref,
    identityKey,
    pending,
    router,
  ]);

  useLayoutEffect(
    () => () => {
      delete document.documentElement.dataset.skScreenSource;
    },
    [],
  );

  const committedHref = resolveRuntimeMainNavigationHref(currentHref, {
    role: identity.role,
    contextId: identity.contextId,
  });
  const visiblePending =
    pending &&
    pending.identityKey === identityKey &&
    (currentHref === pending.originHref || committedHref === pending.href)
      ? pending
      : null;

  if (!visiblePending) return children;
  if (
    visiblePending.warm &&
    (!visiblePending.desktopPreview || desktopPreviewAllowed)
  ) {
    return children;
  }
  return visiblePending.view &&
    privateStateAccessAllowed &&
    (!visiblePending.desktopPreview || desktopPreviewAllowed) ? (
    <RuntimeScreenPreview
      proofHref={visiblePending.href}
      view={visiblePending.view}
      refreshing={online && !visiblePending.localOnly}
    />
  ) : (
    <RuntimeDestinationScaffold
      href={visiblePending.href}
      role={identity.role}
      offline={visiblePending.localOnly}
    />
  );
}

function readResumeState(userId: string): ResumeState | null {
  const storage = getBrowserRuntimeStorage();
  if (!storage) return null;
  const target = readRuntimeLaunchTarget(storage, userId);
  if (!target) return null;
  const identity = {
    userId,
    role: target.role,
    contextId: target.contextId,
  };
  return {
    target: { userId, ...target },
    view: readRuntimeScreenSafeView(storage, identity, target.href),
  };
}

function initialOfflineResumeState(): ResumeState | null {
  if (typeof window === "undefined" || navigator.onLine) return null;
  const storage = getBrowserRuntimeStorage();
  if (!storage) return null;
  const userId = findOnlyRuntimeStateUserId(storage);
  return userId ? readResumeState(userId) : null;
}

function readRequestedResumeView(resume: ResumeState, href: string): RuntimeScreenSafeView | null {
  const storage = getBrowserRuntimeStorage();
  if (!storage) return null;

  if (resume.target.role === "artist") {
    const requestedStudio = new URL(href, "https://runtime.skitza.invalid").searchParams.get(
      "studio",
    );
    if (
      resume.target.contextId === "artist-no-studio"
        ? requestedStudio !== null
        : requestedStudio !== resume.target.contextId
    ) {
      return null;
    }
  }

  return readRuntimeScreenSafeView(
    storage,
    {
      userId: resume.target.userId,
      role: resume.target.role,
      contextId: resume.target.contextId,
    },
    href,
  );
}

export function RuntimeResumeBoundary({
  expectedRole,
  navigate = false,
}: {
  expectedRole?: RuntimeRole;
  navigate?: boolean;
}) {
  const { isLoaded, userId } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const online = useOnlineStatus();
  const [resume, setResume] = useState<ResumeState | null>(null);
  const [resolvedIdentity, setResolvedIdentity] = useState(false);
  const [desktopValidationVersion, forceDesktopValidationRead] = useState(0);
  const requestedHref = hrefFromLocation(pathname, searchParams);

  useEffect(
    () =>
      subscribeDesktopSessionValidation(() => {
        forceDesktopValidationRead((version) => version + 1);
      }),
    [],
  );

  useLayoutEffect(() => {
    if (!isLoaded) {
      setResolvedIdentity(false);
      setResume(
        desktopSessionCacheAccess(null, online).kind === "web"
          ? initialOfflineResumeState()
          : null,
      );
      return;
    }
    const desktopAccess = desktopSessionCacheAccess(userId ?? null, navigator.onLine);
    if (desktopAccess.kind === "desktop" && !desktopAccess.allowed) {
      setResolvedIdentity(false);
      setResume(null);
      return;
    }
    setResolvedIdentity(true);
    setResume(
      userId && (desktopAccess.kind === "web" || desktopAccess.allowed)
        ? readResumeState(userId)
        : null,
    );
  }, [desktopValidationVersion, isLoaded, online, userId]);

  const fallbackRole = expectedRole ?? resume?.target.role ?? "producer";
  const fallbackHref =
    expectedRole && requestedHref.startsWith(expectedRole === "producer" ? "/dashboard" : "/artist")
      ? requestedHref
      : fallbackRole === "producer"
        ? "/dashboard"
        : "/artist";
  const activeResume =
    resume && (!expectedRole || resume.target.role === expectedRole) ? resume : null;
  const presentedHref = navigate ? (activeResume?.target.href ?? fallbackHref) : fallbackHref;
  const presentedView = navigate
    ? (activeResume?.view ?? null)
    : activeResume
      ? readRequestedResumeView(activeResume, presentedHref)
      : null;
  const launchDesktopAccess = desktopSessionCacheAccess(userId ?? null, online);
  const launchIsLocked = launchDesktopAccess.kind === "desktop" && !launchDesktopAccess.allowed;

  useEffect(() => {
    if (!navigate || !resolvedIdentity || !online) return;
    const href = runtimeRoleResolverHref(activeResume?.target.href ?? null);
    if (launchDesktopAccess.kind === "web") {
      router.replace(href);
      return;
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        router.replace(href);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    activeResume?.target.href,
    launchDesktopAccess.kind,
    navigate,
    online,
    resolvedIdentity,
    router,
    userId,
  ]);

  useEffect(() => {
    if (!navigate || online || launchDesktopAccess.kind === "desktop") return;
    const onOnline = () => {
      router.replace(runtimeRoleResolverHref(activeResume?.target.href ?? null));
    };
    window.addEventListener("online", onOnline, { once: true });
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [activeResume?.target.href, launchDesktopAccess.kind, navigate, online, router]);

  if (launchIsLocked) {
    const message =
      launchDesktopAccess.reason === "offline"
        ? "Reconnect to open your studio."
        : launchDesktopAccess.reason === "revoked"
          ? "Sign in again to open your studio."
          : "Checking your secure session…";
    return (
      <div
        aria-busy={launchDesktopAccess.reason !== "revoked"}
        aria-label="Secure launch"
        className="fixed inset-0 flex items-center justify-center bg-[rgb(var(--bg-background))] px-6 text-center text-sm font-semibold text-[rgb(var(--fg-muted))]"
      >
        {message}
      </div>
    );
  }

  if (navigate && online && launchDesktopAccess.kind === "web") {
    return <RuntimeLaunchCover />;
  }

  return (
    <RuntimeResumeShell
      href={presentedHref}
      role={activeResume?.target.role ?? fallbackRole}
      view={presentedView}
      refreshing={online}
    />
  );
}

function RuntimeResumeShell({
  href,
  role,
  view,
  refreshing,
}: {
  href: string;
  role: RuntimeRole;
  view: RuntimeScreenSafeView | null;
  refreshing: boolean;
}) {
  const nav = role === "producer" ? PRODUCER_NAV : ARTIST_NAV;
  return (
    <div
      className="fixed inset-0 flex overflow-hidden bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]"
      data-runtime-resume-shell=""
    >
      <aside className="hidden w-64 shrink-0 flex-col bg-[rgb(var(--bg-sidebar))] px-4 py-5 lg:flex">
        <div className="font-syne px-3 text-xl font-extrabold text-[rgb(var(--brand-primary))]">
          Skitza
        </div>
        <div className="mt-8 space-y-1">
          {nav.map(([route, label]) => {
            const active = isActiveDestination(href, route);
            return (
              <div
                key={route}
                className="rounded-[var(--radius-lg)] px-3 py-3 text-sm font-semibold"
                style={{
                  color: active ? "rgb(var(--brand-primary))" : "rgb(var(--fg-onsidebar) / 0.64)",
                  background: active ? "rgb(var(--fg-onsidebar) / 0.06)" : "transparent",
                }}
              >
                {label}
              </div>
            );
          })}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 lg:px-8">
          <span className="font-syne text-lg font-extrabold lg:hidden">Skitza</span>
          <span className="ml-auto text-xs font-semibold text-[rgb(var(--fg-muted))]">
            Opening Skitza…
          </span>
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {view ? (
            <RuntimeScreenPreview
              proofHref={href}
              view={view}
              source="resume"
              refreshing={refreshing}
            />
          ) : (
            <RuntimeDestinationScaffold href={href} role={role} />
          )}
        </main>
        <nav
          aria-label={`${role === "producer" ? "Producer" : "Artist"} saved tabs`}
          className={`grid shrink-0 ${
            role === "producer" ? "grid-cols-5" : "grid-cols-4"
          } border-t border-[rgb(var(--border-sidebar))] bg-[rgb(var(--bg-sidebar))] px-1 pb-[env(safe-area-inset-bottom,0px)] lg:hidden`}
        >
          {nav.map(([route, label]) => {
            const active = isActiveDestination(href, route);
            return (
              <div
                key={route}
                className="flex min-h-[68px] items-center justify-center px-1 text-center text-[11px] font-bold"
                style={{
                  color: active ? "rgb(var(--brand-primary))" : "rgb(var(--fg-onsidebar) / 0.58)",
                }}
              >
                {label}
              </div>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
