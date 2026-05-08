"use client";

// Sidebar panel listing pending booking requests as "intro request" cards.
//
// Each card shows:
//   - Artist initials avatar (gradient backed by the artist email hash)
//   - Artist name
//   - Time in human form (relative: "in 3d", "Tue 14:00")
//   - Optional intro message from the booking notes
//   - Accept / Decline buttons that fire the same server actions the
//     classic Pending list uses, with optimistic removal on success
//
// Pure visual; data comes from the page
// (booking.list({ status: "pending_approval" })).

import { useState, useTransition } from "react";

import { useToast } from "~/components/ui/toast";

import { confirmBooking, rejectBooking } from "./calendar-actions";

export type IntroRequest = {
  id: string;
  artistName: string;
  artistEmail: string;
  startsAt: string; // ISO
  durationMin: number;
  message: string | null;
  packageName: string | null;
  // True when approving moves the booking to `pending_payment` rather
  // than straight to `confirmed` — the artist still owes money for a
  // productized booking that doesn't have an existing project (and
  // therefore no prior payment) attached. Drives the Accept/Approve
  // button copy + the post-action toast.
  needsPayment: boolean;
};

export function IntroRequestsPanel({
  initial,
  autoConfirm,
}: {
  initial: IntroRequest[];
  autoConfirm: boolean;
}) {
  const [rows, setRows] = useState<IntroRequest[]>(initial);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  function act(row: IntroRequest, kind: "confirm" | "reject") {
    setPendingId(row.id);
    const snapshot = rows;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    startTransition(async () => {
      const res =
        kind === "confirm"
          ? await confirmBooking({ id: row.id })
          : await rejectBooking({ id: row.id });
      setPendingId(null);
      if (!res.ok) {
        setRows(snapshot);
        toast(res.error, "error");
        return;
      }
      toast(
        kind === "reject"
          ? "Booking rejected."
          : row.needsPayment
            ? "Approved — awaiting artist payment."
            : "Booking confirmed.",
        "success",
      );
    });
  }

  return (
    <section
      aria-labelledby="intro-requests-heading"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border-subtle))] px-3 py-2.5">
        <h2
          id="intro-requests-heading"
          className="font-display text-sm tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Intro requests
        </h2>
        {rows.length > 0 ? (
          <span className="inline-flex items-center rounded-full bg-[rgb(var(--brand-primary)/0.18)] px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-warning))]">
            {rows.length}
          </span>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[0.7rem] text-[rgb(var(--fg-secondary))]">
          {autoConfirm
            ? "Nothing waiting on you. Auto-confirm is on — new bookings go straight to confirmed."
            : "Nothing waiting on you. New requests will appear here for review."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 p-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-2.5"
            >
              <div className="flex items-center gap-2">
                <Avatar email={row.artistEmail} name={row.artistName} />
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-xs"
                    style={{ fontWeight: 700 }}
                  >
                    {row.artistName}
                  </div>
                  <div className="truncate font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                    {humanWhen(row.startsAt)} · {row.durationMin}m
                    {row.packageName ? ` · ${row.packageName}` : ""}
                  </div>
                </div>
              </div>
              {row.message ? (
                <p className="mt-2 line-clamp-3 text-[0.7rem] leading-snug text-[rgb(var(--fg-secondary))]">
                  {row.message}
                </p>
              ) : null}
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  disabled={pendingId === row.id}
                  onClick={() => {
                    act(row, "confirm");
                  }}
                  className="inline-flex h-7 flex-1 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--fg-primary))] px-2 text-[0.66rem] text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:opacity-50"
                  style={{ fontWeight: 700 }}
                >
                  {row.needsPayment ? "Approve" : "Accept"}
                </button>
                <button
                  type="button"
                  disabled={pendingId === row.id}
                  onClick={() => {
                    act(row, "reject");
                  }}
                  className="inline-flex h-7 flex-1 items-center justify-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-transparent px-2 text-[0.66rem] text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:opacity-50"
                  style={{ fontWeight: 600 }}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Avatar({ email, name }: { email: string; name: string }) {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  // Deterministic gradient pick from the email so the same artist gets
  // the same avatar across sessions. Pure CSS — uses brand tokens.
  const idx = hashCode(email) % GRADIENTS.length;
  const grad = GRADIENTS[idx] ?? GRADIENTS[0] ?? "";
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[0.6rem] text-[rgb(var(--fg-inverse))]"
      style={{ background: grad, fontWeight: 700 }}
    >
      {initials || "?"}
    </span>
  );
}

const GRADIENTS = [
  "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-accent)) 100%)",
  "linear-gradient(135deg, rgb(var(--fg-primary)) 0%, rgb(var(--brand-primary)) 100%)",
  "linear-gradient(135deg, rgb(var(--brand-accent)) 0%, rgb(var(--fg-primary)) 100%)",
  "linear-gradient(135deg, rgb(var(--brand-primary)/0.85) 0%, rgb(var(--fg-primary)/0.85) 100%)",
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function humanWhen(iso: string): string {
  const dt = new Date(iso);
  const now = new Date();
  const diffMs = dt.getTime() - now.getTime();
  const diffH = Math.round(diffMs / (1000 * 60 * 60));
  const diffD = Math.round(diffH / 24);
  if (diffH < 0) return "past";
  if (diffH < 24) {
    return dt.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (diffD < 7) {
    return dt.toLocaleDateString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
