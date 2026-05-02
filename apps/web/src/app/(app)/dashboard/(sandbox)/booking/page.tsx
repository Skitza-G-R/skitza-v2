import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { blocksToHoursByDay } from "../../_design-test/availability-shape";
import {
  CalendarTab,
  type CalendarSession,
  type IntroRequest,
} from "../../_design-test/calendar-tab";

// Calendar tab. Shell lives in (sandbox)/layout.tsx; this page
// fetches its own week-view + intro-requests + availability data
// and returns the inner tab body.

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
  const [upcoming, pending, availabilityBlocks] = await Promise.all([
    caller.booking.upcoming({ days: 14 }),
    caller.booking.list({ status: "pending" }),
    caller.booking.availability.list(),
  ]);

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

  const initialHoursByDay = blocksToHoursByDay(availabilityBlocks);

  return (
    <CalendarTab
      data={{
        sessions,
        introRequests,
        weekLabel,
        todayIdx,
        initialHoursByDay,
      }}
    />
  );
}
