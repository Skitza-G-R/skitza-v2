"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useRuntimeState } from "~/components/runtime-state/runtime-state-provider";
import { useRuntimeCachedView } from "~/components/runtime-state/use-runtime-state";
import type { ArtistHomeSafeView } from "~/lib/runtime-state/runtime-state";

interface ArtistHomeRuntimeValue {
  view: ArtistHomeSafeView;
  online: boolean;
}

const ArtistHomeRuntimeContext = createContext<ArtistHomeRuntimeValue | null>(null);

export function ArtistHomeSoftNavigationBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const online = useOnlineStatus();
  const { identity } = useRuntimeState();
  const activeStudioId = identity.contextId === "artist-no-studio" ? null : identity.contextId;
  const route = activeStudioId ? `/artist?studio=${encodeURIComponent(activeStudioId)}` : "/artist";
  const cachedView = useRuntimeCachedView({
    slot: "artist.home.safe-view",
    route,
    contextId: identity.contextId,
  });

  if (!online && pathname === "/artist" && cachedView.data) {
    return (
      <ArtistHomeRuntime serverView={cachedView.data} activeStudioId={activeStudioId}>
        {children}
      </ArtistHomeRuntime>
    );
  }

  return children;
}

export function ArtistHomeRuntime({
  serverView,
  activeStudioId,
  children,
}: {
  serverView: ArtistHomeSafeView;
  activeStudioId: string | null;
  children: ReactNode;
}) {
  const online = useOnlineStatus();
  const route = activeStudioId ? `/artist?studio=${encodeURIComponent(activeStudioId)}` : "/artist";
  const cachedView = useRuntimeCachedView({
    slot: "artist.home.safe-view",
    route,
    contextId: activeStudioId ?? "artist-no-studio",
    serverData: serverView,
  });
  const view = cachedView.data ?? serverView;

  if (!online) {
    return (
      <ArtistHomeRuntimeContext.Provider value={{ view, online }}>
        <div
          data-runtime-source={cachedView.source}
          data-runtime-refreshing={cachedView.refreshing || undefined}
          className="mx-auto w-full max-w-[760px] px-7 py-6"
        >
          <p
            role="status"
            className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.08)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--fg-warning-text))]"
          >
            Offline · Showing saved artist context. Booking, payment, and live music actions need a
            connection.
          </p>
          <section
            aria-labelledby="offline-artist-heading"
            className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
          >
            <h1
              id="offline-artist-heading"
              className="font-syne text-xl font-extrabold text-[rgb(var(--fg-default))]"
            >
              Welcome back, {view.firstName}.
            </h1>
            <p className="mt-1 text-[13px] text-[rgb(var(--fg-muted))]">
              {view.studios.length === 0
                ? "Your studio roster is empty."
                : `${String(view.studios.length)} ${view.studios.length === 1 ? "studio" : "studios"} in your roster.`}
            </p>
            {view.studios.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {view.studios.map((studio) => (
                  <li
                    key={studio.producerId}
                    className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-default))]"
                  >
                    {studio.producerName}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </ArtistHomeRuntimeContext.Provider>
    );
  }

  return (
    <ArtistHomeRuntimeContext.Provider value={{ view, online }}>
      <div
        data-runtime-source={cachedView.source}
        data-runtime-refreshing={cachedView.refreshing || undefined}
      >
        {children}
      </div>
    </ArtistHomeRuntimeContext.Provider>
  );
}

export function useArtistHomeRuntime(): ArtistHomeRuntimeValue | null {
  return useContext(ArtistHomeRuntimeContext);
}
