"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { Studio } from "~/server/artist/identity";

// Client component — bare-avatar "Book a session" tiles.
//
//   - One tile per producer the artist has a relationship with.
//   - Just an avatar circle (colored, with the initial) and the
//     producer name underneath in small text. No card chrome.
//   - With 2+ studios, tiles are draggable to reorder. Order is
//     persisted in localStorage so the artist's preferred ordering
//     sticks across reloads.
//   - Clicking / tapping a tile opens /artist/book?studio=<id>.
//
// Local storage shape: a JSON array of producerIds. New producers
// (not yet in the saved order) get appended in their incoming order.
// Producers no longer present are dropped on read.

const STORAGE_KEY = "skitza:artist:studio-order";

const KIND_PALETTE = [
  "rgb(var(--kind-mix))",
  "rgb(var(--kind-master))",
  "rgb(var(--kind-tracking))",
  "rgb(var(--kind-intro))",
  "rgb(var(--kind-songwriting))",
  "rgb(var(--kind-meeting))",
] as const;

function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return KIND_PALETTE[hash % KIND_PALETTE.length] ?? KIND_PALETTE[0];
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

// Read saved order from localStorage and reconcile against the
// current studio list. Studios missing from saved order are appended.
function reconcileOrder(studios: Studio[]): string[] {
  if (typeof window === "undefined") return studios.map((s) => s.producerId);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return studios.map((s) => s.producerId);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return studios.map((s) => s.producerId);
    const savedIds = parsed.filter((x): x is string => typeof x === "string");
    const currentIds = new Set(studios.map((s) => s.producerId));
    const inOrder = savedIds.filter((id) => currentIds.has(id));
    const seen = new Set(inOrder);
    const newOnes = studios
      .map((s) => s.producerId)
      .filter((id) => !seen.has(id));
    return [...inOrder, ...newOnes];
  } catch {
    return studios.map((s) => s.producerId);
  }
}

export function BookWithStudios({ studios }: { studios: Studio[] }) {
  // Start in incoming order. On mount, hydrate from saved order.
  const [order, setOrder] = useState<string[]>(() =>
    studios.map((s) => s.producerId),
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const router = useRouter();

  // Hydrate the saved order after mount + whenever the incoming
  // studios list changes (new producer connected, one removed).
  useEffect(() => {
    setOrder(reconcileOrder(studios));
  }, [studios]);

  // Persist order whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } catch {
      /* localStorage may be unavailable (private mode) — silent */
    }
  }, [order]);

  if (studios.length === 0) return null;

  const byId = new Map(studios.map((s) => [s.producerId, s]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((s): s is Studio => s !== undefined);

  const dndEnabled = ordered.length > 1;

  const onDragStart = (idx: number) => (e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox to start a drag.
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const onDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIdx(idx);
  };

  const onDragLeave = () => {
    setOverIdx(null);
  };

  const onDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setOverIdx(null);
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      return;
    }
    const next = [...order];
    const movedId = next[dragIdx];
    if (!movedId) {
      setDragIdx(null);
      return;
    }
    next.splice(dragIdx, 1);
    next.splice(idx, 0, movedId);
    setOrder(next);
    setDragIdx(null);
  };

  const onDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  const goto = (producerId: string) => {
    router.push(`/artist/book?studio=${producerId}`);
  };

  return (
    <section
      aria-labelledby="book-with-heading"
      className="reveal-up-delay-3"
    >
      <h2
        id="book-with-heading"
        className="px-1 text-[13px] font-medium text-[rgb(var(--fg-muted))]"
      >
        Book a session
      </h2>
      <div className="mt-3 flex flex-wrap gap-5">
        {ordered.map((s, idx) => {
          const color = hashColor(s.producerId);
          const isDragging = dragIdx === idx;
          const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx;

          return (
            <div
              key={s.producerId}
              role="link"
              tabIndex={0}
              draggable={dndEnabled}
              onDragStart={onDragStart(idx)}
              onDragOver={onDragOver(idx)}
              onDragLeave={onDragLeave}
              onDrop={onDrop(idx)}
              onDragEnd={onDragEnd}
              onClick={() => {
                goto(s.producerId);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  goto(s.producerId);
                }
              }}
              aria-label={`Book a session with ${s.name}`}
              className="sk-press flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-md)] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              style={{
                opacity: isDragging ? 0.35 : 1,
                transform: isOver ? "scale(1.04)" : undefined,
                transition: "transform 160ms cubic-bezier(0.23, 1, 0.32, 1)",
              }}
            >
              <Avatar
                name={s.name}
                color={color}
                logoUrl={s.logoUrl}
                size={56}
              />
              <span className="line-clamp-1 max-w-[80px] text-center text-[12px] font-medium text-[rgb(var(--fg-default))]">
                {s.name}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Avatar ─────────────────────────────────────────────────────────

function Avatar({
  name,
  color,
  logoUrl,
  size,
}: {
  name: string;
  color: string;
  logoUrl: string | null;
  size: number;
}) {
  if (logoUrl) {
    return (
      <span
        aria-hidden
        className="shrink-0 overflow-hidden rounded-full ring-1 ring-[rgb(var(--border-subtle))]"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 select-none items-center justify-center rounded-full font-mono font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initial(name)}
    </span>
  );
}
