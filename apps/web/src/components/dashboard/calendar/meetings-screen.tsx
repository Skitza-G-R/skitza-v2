"use client";

import { useState, useTransition } from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { formatMoney } from "~/lib/format/money";

import {
  confirmBooking,
  rejectBooking,
} from "../../../app/(producer)/dashboard/calendar/calendar-actions";

// Phase 4 — Calendar Meetings screen.
//
// Mirrors `notes/producer-screens-2.jsx` ProducerCalendarScreen:
//   1. "Booking requests · N" amber-eyebrow section. Each row is a
//      tappable card that opens a bottom-Sheet review modal with the
//      full booking detail + Accept / Decline buttons.
//   2. "Upcoming · N" section. Each row is a dated session card —
//      brand-primary month-eyebrow + Syne extrabold day + mono time
//      on the left, title + client + meta on the right.
//
// Functionality:
// - confirmBooking / rejectBooking server actions reused as-is from
//   the prior MeetingsPanel — visual rebuild, behaviour-preserving.
// - Bottom-Sheet review uses the Phase 4 Sheet primitive (PR #57).

export interface MeetingsScreenRow {
  id: string;
  artistName: string;
  artistEmail?: string | null;
  startsAt: string; // ISO
  durationMin: number;
  packageName: string | null;
  priceCents?: number | null;
  currency?: string | null;
  message?: string | null;
}

interface MeetingsScreenProps {
  pending: MeetingsScreenRow[];
  upcoming: MeetingsScreenRow[];
}

export function MeetingsScreen({ pending, upcoming }: MeetingsScreenProps) {
  const [pendingRows, setPendingRows] = useState<MeetingsScreenRow[]>(pending);

  return (
    <div className="flex flex-col gap-6">
      {/* PENDING APPROVALS */}
      {pendingRows.length > 0 ? (
        <section aria-labelledby="approvals-heading">
          <h2
            id="approvals-heading"
            className="mb-3 px-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]"
          >
            Booking requests · {pendingRows.length}
          </h2>
          <div className="flex flex-col gap-2">
            {pendingRows.map((row) => (
              <ApprovalCard
                key={row.id}
                row={row}
                onResolve={(id) => {
                  setPendingRows((prev) => prev.filter((r) => r.id !== id));
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* UPCOMING SESSIONS */}
      <section aria-labelledby="upcoming-heading">
        <h2
          id="upcoming-heading"
          className="mb-3 px-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Upcoming · {upcoming.length}
        </h2>
        {upcoming.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
            No confirmed sessions in the next two weeks.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {upcoming.map((row) => (
              <UpcomingCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// — Approval card (clickable → opens Sheet) —

function ApprovalCard({
  row,
  onResolve,
}: {
  row: MeetingsScreenRow;
  onResolve: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const startsAt = new Date(row.startsAt);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="sk-press flex flex-col gap-2.5 rounded-[var(--radius-lg)] border-[1.5px] border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--bg-elevated))] p-3.5 text-left"
      >
        <div className="flex items-start gap-3">
          <ClientAvatar name={row.artistName} size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold leading-tight text-[rgb(var(--fg-default))]">
                {row.artistName}
              </p>
              <span className="pill pill-brand">
                <span className="ping-dot inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
                new
              </span>
            </div>
            {row.packageName ? (
              <p className="mt-0.5 text-[12px] text-[rgb(var(--fg-muted))]">
                {row.packageName}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-[var(--radius-md)] bg-[rgb(var(--bg-background))] px-3 py-2">
          <span className="font-mono text-[12px] text-[rgb(var(--fg-muted))] tabular-nums">
            {formatDateTime(startsAt)}
          </span>
          {row.priceCents != null && row.currency ? (
            <span className="font-mono text-[12px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
              {formatMoney(row.priceCents, row.currency)}
            </span>
          ) : (
            <span className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">
              {String(row.durationMin)} min
            </span>
          )}
        </div>
      </button>
      <ReviewSheet
        row={row}
        open={open}
        onOpenChange={setOpen}
        onResolve={onResolve}
      />
    </>
  );
}

// — Review sheet (bottom sheet w/ accept/decline) —

function ReviewSheet({
  row,
  open,
  onOpenChange,
  onResolve,
}: {
  row: MeetingsScreenRow;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onResolve: (id: string) => void;
}) {
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  const startsAt = new Date(row.startsAt);

  function act(kind: "confirm" | "reject") {
    startTransition(async () => {
      const res =
        kind === "confirm"
          ? await confirmBooking({ id: row.id })
          : await rejectBooking({ id: row.id });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      setOutcome(kind === "confirm" ? "accepted" : "declined");
      // Let the success state read for ~1.5s before notifying the
      // parent to drop the row from the list.
      setTimeout(() => {
        onResolve(row.id);
        onOpenChange(false);
        setOutcome(null);
      }, 1500);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!outcome) onOpenChange(next);
      }}
    >
      <SheetContent>
        {outcome ? (
          <div className="flex flex-col items-center gap-4 px-2 pt-4 pb-1 text-center">
            <div
              className={[
                "flex h-14 w-14 items-center justify-center rounded-full",
                outcome === "accepted"
                  ? "bg-[rgb(var(--fg-success)/0.15)] text-[rgb(var(--fg-success))]"
                  : "bg-[rgb(var(--fg-muted)/0.12)] text-[rgb(var(--fg-muted))]",
              ].join(" ")}
            >
              {outcome === "accepted" ? <CheckIcon /> : <XIcon />}
            </div>
            <SheetTitle className="text-xl">
              {outcome === "accepted" ? "Booking confirmed" : "Declined"}
            </SheetTitle>
            <SheetDescription className="text-balance">
              {outcome === "accepted"
                ? `${row.artistName} will get a confirmation and the deposit invoice.`
                : `${row.artistName} will get a polite decline.`}
            </SheetDescription>
          </div>
        ) : (
          <>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]">
              Booking request
            </p>
            <div className="flex items-center gap-3">
              <ClientAvatar name={row.artistName} size={48} />
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-xl">{row.artistName}</SheetTitle>
                {row.artistEmail ? (
                  <SheetDescription className="text-xs">
                    {row.artistEmail}
                  </SheetDescription>
                ) : null}
              </div>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3.5">
              <DetailRow label="Service" value={row.packageName ?? "Session request"} />
              <DetailRow label="When" value={formatDateTime(startsAt)} />
              <DetailRow
                label="Duration"
                value={`${String(Math.round(row.durationMin / 60 * 10) / 10)}h`}
              />
              {row.priceCents != null && row.currency ? (
                <DetailRow
                  label="Price"
                  value={formatMoney(row.priceCents, row.currency)}
                  emphasis
                  last
                />
              ) : null}
            </div>

            {row.message ? (
              <div>
                <p className="mb-1.5 px-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
                  Their message
                </p>
                <p className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3.5 py-3 text-[13.5px] leading-relaxed text-[rgb(var(--fg-default))]">
                  {row.message}
                </p>
              </div>
            ) : null}

            <div className="mt-1 flex gap-2">
              <SheetClose asChild>
                <button
                  type="button"
                  onClick={() => {
                    act("reject");
                  }}
                  className="sk-press flex-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-transparent px-4 py-3 text-sm font-semibold text-[rgb(var(--fg-default))]"
                >
                  Decline
                </button>
              </SheetClose>
              <button
                type="button"
                onClick={() => {
                  act("confirm");
                }}
                className="sk-press flex flex-[2] items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-3 text-sm font-bold text-[rgb(var(--bg-sidebar))]"
              >
                <CheckIcon size={13} /> Accept booking
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  value,
  emphasis,
  last,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center justify-between py-2 text-[13px]",
        last ? "" : "border-b border-[rgb(var(--border-subtle))]",
      ].join(" ")}
    >
      <span className="text-[rgb(var(--fg-muted))]">{label}</span>
      <span
        className={[
          emphasis ? "font-mono font-extrabold tabular-nums" : "font-semibold",
          "text-[rgb(var(--fg-default))]",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

// — Upcoming card —

function UpcomingCard({ row }: { row: MeetingsScreenRow }) {
  const startsAt = new Date(row.startsAt);
  return (
    <article className="flex gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3">
      <div className="w-12 shrink-0 pt-0.5 text-center">
        <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] text-[rgb(var(--brand-primary))]">
          {monthShort(startsAt)}
        </p>
        <p className="my-0.5 font-display text-[22px] font-extrabold leading-none tracking-[-0.03em] text-[rgb(var(--fg-default))] tabular-nums">
          {String(startsAt.getDate())}
        </p>
        <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))] tabular-nums">
          {formatTimeShort(startsAt)}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold leading-tight text-[rgb(var(--fg-default))]">
          {row.packageName ?? "Session"}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <ClientAvatar name={row.artistName} size={18} />
          <span className="text-[12px] text-[rgb(var(--fg-muted))]">{row.artistName}</span>
        </div>
        <p className="mt-1 font-mono text-[10.5px] text-[rgb(var(--fg-muted))] tabular-nums">
          {String(row.durationMin)} min
        </p>
      </div>
    </article>
  );
}

// — Helpers —

function ClientAvatar({ name, size }: { name: string; size: number }) {
  const initials = producerInitials(name);
  const gradient = producerGradient(name);
  const fontSize = Math.max(9, Math.round(size * 0.4));
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-display font-extrabold text-white"
      style={{
        width: size,
        height: size,
        background: gradient,
        fontSize,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}

function formatDateTime(d: Date): string {
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${month} ${String(d.getDate())} · ${formatTimeShort(d)}`;
}

function formatTimeShort(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function monthShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

function CheckIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}
