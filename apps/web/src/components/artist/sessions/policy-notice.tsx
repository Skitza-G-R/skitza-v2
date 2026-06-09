// PolicyNotice (S12) — one calm line shown only when a session is too close
// to its start for self-serve cancel/reschedule. The time-policy gates the
// ACTION, not money (refunds follow the signed agreement, off-app). We keep
// this quiet and muted, not a scary red wall — the artist just messages the
// producer directly. Pure presentational; the producer's name is woven in.

import { ClockIcon } from "~/components/artist/funnel/funnel-icons";

export function PolicyNotice({ producerName }: { producerName: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-[var(--radius-lg)] px-3.5 py-3 text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]"
      style={{
        background: "rgb(var(--bg-sunken))",
        border: "1px solid rgb(var(--border-subtle))",
      }}
    >
      <span className="mt-[2px] shrink-0">
        <ClockIcon />
      </span>
      <span>
        Too close to the session — message {producerName} to change it.
      </span>
    </div>
  );
}
