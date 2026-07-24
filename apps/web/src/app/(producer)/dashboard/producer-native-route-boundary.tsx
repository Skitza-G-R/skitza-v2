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

export function ProducerNativeRouteBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const online = useOnlineStatus();
  const family = producerRouteFamily(pathname);
  const search = searchParams.toString();
  const route = `${pathname}${search ? `?${search}` : ""}`;
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
      {children}
    </div>
  );
}
