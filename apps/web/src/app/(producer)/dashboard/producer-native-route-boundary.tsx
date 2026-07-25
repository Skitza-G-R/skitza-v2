"use client";

import { WifiOff } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useRuntimeCachedView } from "~/components/runtime-state/use-runtime-state";
import {
  producerRouteFamily,
  type ProducerRouteFamily,
} from "~/lib/native/producer-route-family";
import type {
  ProducerMusicSafeView,
  ProducerOverviewSafeView,
  ProducerPortfolioSafeView,
  ProducerStoreSafeView,
  ProducerWorkspaceSafeView,
} from "~/lib/runtime-state/runtime-state";

function savedSummary(
  family: ProducerRouteFamily,
  views: {
    workspace: ProducerWorkspaceSafeView | undefined;
    music: ProducerMusicSafeView | undefined;
    store: ProducerStoreSafeView | undefined;
    portfolio: ProducerPortfolioSafeView | undefined;
  },
): string | null {
  if (family === "workspace" && views.workspace) {
    return `${String(views.workspace.projectCount)} projects · ${String(views.workspace.clientCount)} clients`;
  }
  if (family === "music" && views.music) {
    return `${String(views.music.songCount)} songs · ${String(views.music.projectCount)} projects`;
  }
  if (family === "store" && views.store) {
    return `${String(views.store.liveProductCount)} live · ${String(views.store.productCount)} products`;
  }
  if (family === "portfolio" && views.portfolio) {
    return `${String(views.portfolio.publishedCount)} published · ${String(views.portfolio.availableCount)} available`;
  }
  return null;
}

function SavedProducerToday({
  view,
  source,
  refreshing,
}: {
  view: ProducerOverviewSafeView;
  source: "unseen" | "cache" | "server";
  refreshing: boolean;
}) {
  const firstName = (view.displayName ?? "").trim().split(/\s+/)[0] || "there";

  return (
    <div
      data-runtime-source={source}
      data-runtime-refreshing={refreshing || undefined}
      className="sk-page-enter mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 pt-5 pb-10 sm:px-6 lg:gap-5 lg:px-8 lg:pt-8 lg:pb-8"
    >
      <p
        role="status"
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.08)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--fg-warning-text))]"
      >
        Offline · Showing your saved studio overview. Booking, payment, availability, and other live
        actions need a connection.
      </p>
      <section
        aria-labelledby="offline-overview-heading"
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
      >
        <h1
          id="offline-overview-heading"
          className="font-syne text-[28px] leading-tight font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]"
        >
          Welcome back, {firstName}.
        </h1>
        <p className="mt-3 text-[13px] text-[rgb(var(--fg-muted))]">Saved studio pulse</p>
        <p className="mt-1 text-2xl font-extrabold text-[rgb(var(--fg-default))]">
          {String(view.activeProjects)}
        </p>
        <p className="text-[12px] text-[rgb(var(--fg-muted))]">Active projects</p>
      </section>
    </div>
  );
}

function savedRouteTitle(family: ProducerRouteFamily): string {
  if (family === "workspace") return "Workspace";
  if (family === "music") return "Music";
  if (family === "store") return "Store";
  if (family === "portfolio") return "Portfolio";
  return "Studio";
}

function SavedProducerRoute({ family, summary }: { family: ProducerRouteFamily; summary: string }) {
  const title = savedRouteTitle(family);

  return (
    <div className="sk-page-enter mx-auto w-full max-w-[1180px] px-4 pt-5 pb-24 sm:px-6 lg:px-8 lg:pt-8">
      <section
        aria-labelledby="offline-route-heading"
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
      >
        <p className="font-mono text-[10.5px] font-bold tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
          Saved {title}
        </p>
        <h1
          id="offline-route-heading"
          className="font-syne mt-2 text-[28px] leading-tight font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]"
        >
          {title}
        </h1>
        <p className="mt-3 text-[13px] text-[rgb(var(--fg-muted))]">
          Showing saved {title.toLowerCase()} context from this device.
        </p>
        <p className="mt-2 text-lg font-bold text-[rgb(var(--fg-default))]">{summary}</p>
        <p className="mt-3 text-[12px] text-[rgb(var(--fg-muted))]">
          Live actions need a connection.
        </p>
      </section>
    </div>
  );
}

export function ProducerNativeRouteBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const online = useOnlineStatus();
  const family = producerRouteFamily(pathname);
  const search = searchParams.toString();
  const route = `${pathname}${search ? `?${search}` : ""}`;
  const overview = useRuntimeCachedView({
    slot: "producer.overview.safe-view",
    route: "/dashboard",
  });
  const workspace = useRuntimeCachedView({
    slot: "producer.workspace.safe-view",
    route,
  });
  const music = useRuntimeCachedView({
    slot: "producer.music.safe-view",
    route,
  });
  const store = useRuntimeCachedView({
    slot: "producer.store.safe-view",
    route,
  });
  const portfolio = useRuntimeCachedView({
    slot: "producer.portfolio.safe-view",
    route,
  });
  const summary = family
    ? savedSummary(family, {
        workspace: workspace.data,
        music: music.data,
        store: store.data,
        portfolio: portfolio.data,
      })
    : null;

  return (
    <div
      className="min-w-0 max-w-full"
      data-producer-route-family={family ?? "unknown"}
    >
      {!online && family !== "today" ? (
        <div
          role="status"
          className="mx-4 mt-3 flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-xs font-semibold text-[rgb(var(--fg-secondary))] sm:mx-6"
        >
          <WifiOff aria-hidden className="h-4 w-4 shrink-0 text-[rgb(var(--fg-muted))]" />
          <span>
            {summary ? `Offline · Saved context: ${summary}.` : "Offline · Saved navigation remains available."}{" "}
            Live booking, payment, availability, upload, and catalog changes require a connection.
          </span>
        </div>
      ) : null}
      {!online && family === "today" && overview.data ? (
        <SavedProducerToday
          view={overview.data}
          source={overview.source}
          refreshing={overview.refreshing}
        />
      ) : !online && family && family !== "today" && summary ? (
        <SavedProducerRoute family={family} summary={summary} />
      ) : (
        children
      )}
    </div>
  );
}
