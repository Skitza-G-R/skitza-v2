import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  CalendarTab,
  type CalendarSession,
  type IntroRequest,
} from "../_design-test/calendar-tab";
import { initialsOf } from "../_design-test/data-mapping";
import { DesignShell } from "../_design-test/design-shell";
import { buildPaletteData } from "../_design-test/palette-data";
import type { Producer } from "../_design-test/shell";

// gili/design-test branch — Calendar tab. Wires the mockup's
// week-view session grid + intro requests sidebar against real
// `booking.upcoming()` + `booking.list({status:"pending"})` data.
//
// On main this route is the booking-config page (availability,
// packages, blackouts, gcal sync). On the design-test branch we
// replace it with the new design's Calendar tab — the original UI
// is still on main if needed.

const GRAD_PALETTE = [
  "grad-rose",
  "grad-amber",
  "grad-slate",
  "grad-violet",
  "grad-indigo",
  "grad-emerald",
  "grad-sky",
] as const;

function gradFor(idx: number): string {
  return GRAD_PALETTE[idx % GRAD_PALETTE.length] ?? "grad-amber";
}

function fmt2(n: number): string {
  return String(n).padStart(2, "0");
}

export default async function CalendarPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [me, upcoming, pending, paletteData] = await Promise.all([
    caller.producer.me(),
    caller.booking.upcoming({ days: 14 }),
    caller.booking.list({ status: "pending" }),
    buildPaletteData(caller),
  ]);

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  // Week boundaries — Sunday at 00:00 local through following Saturday.
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const todayIdx = today.getDay();

  const sessions: CalendarSession[] = upcoming
    .filter((b) => b.startsAt >= weekStart && b.startsAt < weekEnd)
    .map((b) => {
      const dt = b.startsAt;
      const dayIndex = dt.getDay();
      const hour = dt.getHours();
      const len = Math.max(0.5, b.durationMin / 60);
      const startMin = dt.getMinutes();
      const endTotal = hour * 60 + startMin + b.durationMin;
      const endHour = Math.floor(endTotal / 60);
      const endMin = endTotal % 60;
      return {
        id: b.id,
        title: b.packageName ?? "Session",
        time: `${fmt2(hour)}:${fmt2(startMin)}–${fmt2(endHour)}:${fmt2(endMin)}`,
        client: b.artistName,
        project: "",
        dayIndex,
        hour,
        len,
        status: "confirmed" as const,
      };
    });

  const introRequests: IntroRequest[] = pending.map((b, i) => {
    const dt = b.startsAt;
    return {
      id: b.id,
      who: b.artistName,
      when: `${dt.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "2-digit",
      })} · ${fmt2(dt.getHours())}:${fmt2(dt.getMinutes())}`,
      message:
        b.notes ??
        `Inquiry for ${b.packageNameSnapshot ?? "a session"}.`,
      avatar: gradFor(i),
    };
  });

  const weekLabel = `Week of ${weekStart.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;

  return (
    <DesignShell producer={producer} paletteData={paletteData}>
      <CalendarTab
        data={{ sessions, introRequests, weekLabel, todayIdx }}
      />
    </DesignShell>
  );
}
