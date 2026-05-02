/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Calendar tab. 1:1 port of the mockup's
// CalendarTab (sample-app/index.html lines 2854-3074). Two views:
// Schedule (week grid + intro requests sidebar) and Availability
// (working-hours editor + session defaults).
//
// Wired logic:
// - Sessions in the week grid come from booking.upcoming() — real
//   confirmed bookings in the next 7 days, mapped to (dayIndex, hour)
//   coordinates relative to "this week starting Sun"
// - Intro requests sidebar comes from booking.list({status:"pending"})
// - Availability editor: pre-populated from booking.availability.list()
//   + booking.availability.getSettings(); Save persists via the
//   updateAvailability Server Action.
// - Buffer minutes are still local-only (no DB column for that yet).

import { Fragment, type CSSProperties, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Avatar, Card, Icon } from "./primitives";
import { initialsOf } from "./data-mapping";
import { hoursByDayToBlocks, type HoursByDay } from "./availability-shape";
import { updateAvailability } from "./calendar-actions";

export type CalendarSession = {
  id: string;
  title: string;
  time: string; // e.g. "14:00–16:00"
  client: string;
  project: string;
  dayIndex: number; // 0..6 (Sun..Sat)
  hour: number; // 9..18
  len: number; // hours
  status: "confirmed" | "pending";
};

export type IntroRequest = {
  id: string;
  who: string;
  when: string;
  message: string;
  avatar: string; // grad-* class
};

export type CalendarData = {
  sessions: CalendarSession[];
  introRequests: IntroRequest[];
  weekLabel: string; // e.g. "Week of May 3, 2026"
  todayIdx: number; // 0..6
  initialHoursByDay: HoursByDay;
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function CalendarTab({ data }: { data: CalendarData }) {
  const router = useRouter();
  const [view, setView] = useState<"week" | "availability">("week");
  const days: ReadonlyArray<"Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat"> = [
    "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
  ] as const;
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const todayIdx = data.todayIdx;

  // Synthesized weekday-of-month dates (1..31). The mockup hard-codes
  // these — we match by computing 7 dates relative to today.
  const dates: number[] = (() => {
    const out: number[] = [];
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      out.push(d.getDate());
    }
    return out;
  })();

  // Availability-editor state. Pre-populated from server data;
  // edits roundtrip via the updateAvailability Server Action.
  // Session length lives on each product (different per package), so
  // there's no producer-wide default to manage here. Buffer minutes
  // stay local — no DB column for that yet.
  const [hoursByDay, setHoursByDay] = useState<HoursByDay>(data.initialHoursByDay);
  const [buffer, setBuffer] = useState(15);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const tz = "Asia/Jerusalem · GMT+3";

  const dirty =
    JSON.stringify(hoursByDay) !== JSON.stringify(data.initialHoursByDay);

  const onSaveAvailability = () => {
    setStatus({ kind: "saving" });
    startTransition(() => {
      void (async () => {
        const blocks = hoursByDayToBlocks(hoursByDay);
        const result = await updateAvailability({ blocks });
        if (result.ok) {
          setStatus({ kind: "saved" });
          router.refresh();
          window.setTimeout(() => {
            setStatus((cur) => (cur.kind === "saved" ? { kind: "idle" } : cur));
          }, 1800);
        } else {
          setStatus({ kind: "error", message: result.error });
        }
      })();
    });
  };

  const TIME_OPTS: string[] = [];
  for (let h = 6; h <= 23; h++)
    for (let m = 0; m < 60; m += 30)
      TIME_OPTS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

  const setDay = (
    key: "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat",
    patch: Partial<{ on: boolean; start: string; end: string }>,
  ) => setHoursByDay((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const copyMonToAll = () =>
    setHoursByDay((p) => ({
      Sun: p.Sun,
      Mon: p.Mon,
      Tue: { ...p.Mon },
      Wed: { ...p.Mon },
      Thu: { ...p.Mon },
      Fri: { ...p.Mon },
      Sat: p.Sat,
    }));

  const totalHours = (Object.values(hoursByDay) as Array<{ on: boolean; start: string; end: string }>).reduce(
    (a, dInfo) => {
      if (!dInfo.on) return a;
      const [shStr, smStr] = dInfo.start.split(":");
      const [ehStr, emStr] = dInfo.end.split(":");
      const sh = Number(shStr);
      const sm = Number(smStr);
      const eh = Number(ehStr);
      const em = Number(emStr);
      return a + Math.max(0, eh + em / 60 - sh - sm / 60);
    },
    0,
  );
  const fullDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const fullDayLabels: Record<(typeof fullDays)[number], string> = {
    Sun: "Sunday",
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
    Sat: "Saturday",
  };

  const selectCss: CSSProperties = {
    all: "unset",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "JetBrains Mono",
    fontWeight: 600,
    color: "rgb(var(--fg-default))",
    padding: "8px 10px",
    border: "1px solid rgb(var(--border-subtle))",
    borderRadius: 8,
    background: "rgb(var(--bg-background))",
    boxSizing: "border-box",
    minWidth: 88,
    textAlign: "center",
    appearance: "menulist",
  };

  return (
    <div
      data-screen-label="04 Calendar"
      className="custom-scrollbar"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(16px, 3vw, 32px)",
        maxWidth: 1180,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <header
        className="reveal-up stagger-1"
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="label-tiny" style={{ display: "block", marginBottom: 6 }}>
            {data.weekLabel}
          </span>
          <h1
            className="font-syne"
            style={{
              fontSize: "clamp(34px, 4.5vw, 52px)",
              fontWeight: 800,
              letterSpacing: "-0.035em",
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Calendar
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "rgb(var(--fg-muted))" }}>
            {data.sessions.length} sessions this week · {data.introRequests.length} intro
            requests
          </p>
        </div>
        <div
          style={{
            display: "inline-flex",
            padding: 4,
            borderRadius: 10,
            background: "rgb(var(--bg-elevated))",
            border: "1px solid rgb(var(--border-subtle))",
          }}
        >
          {(
            [
              ["week", "Schedule"],
              ["availability", "Availability"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "7px 16px",
                borderRadius: 7,
                fontSize: 12.5,
                fontWeight: 700,
                background: view === k ? "rgb(var(--bg-background))" : "transparent",
                color: view === k ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      {view === "week" ? (
        <div
          className="reveal-up stagger-2"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 280px",
            gap: 14,
          }}
        >
          <Card padded={false}>
            <div className="custom-scrollbar" style={{ overflowX: "auto" }}>
              <div
                style={{
                  minWidth: 700,
                  display: "grid",
                  gridTemplateColumns: "40px repeat(7, 1fr)",
                }}
              >
                <div />
                {days.map((day, i) => (
                  <div
                    key={day}
                    style={{
                      padding: "10px 8px",
                      textAlign: "center",
                      borderBottom: "1px solid rgb(var(--border-subtle))",
                      borderLeft:
                        i === 0
                          ? "none"
                          : "1px solid rgb(var(--border-subtle) / 0.5)",
                    }}
                  >
                    <div className="label-tiny">{day}</div>
                    <div
                      style={{
                        marginTop: 3,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        background:
                          i === todayIdx ? "rgb(var(--fg-default))" : "transparent",
                        color:
                          i === todayIdx
                            ? "rgb(var(--bg-background))"
                            : "rgb(var(--fg-default))",
                        fontSize: 13,
                        fontWeight: 700,
                        fontFamily: "JetBrains Mono",
                      }}
                    >
                      {dates[i]}
                    </div>
                  </div>
                ))}

                {hours.map((h) => (
                  <Fragment key={h}>
                    <div
                      style={{
                        fontSize: 9.5,
                        color: "rgb(var(--fg-faint))",
                        textAlign: "right",
                        padding: "14px 6px 0 0",
                        fontFamily: "JetBrains Mono",
                        borderTop: "1px solid rgb(var(--border-subtle) / 0.4)",
                      }}
                    >
                      {h.toString().padStart(2, "0")}:00
                    </div>
                    {days.map((_, di) => {
                      const session = data.sessions.find(
                        (s) => s.dayIndex === di && s.hour === h,
                      );
                      return (
                        <div
                          key={di}
                          style={{
                            position: "relative",
                            height: 56,
                            borderTop: "1px solid rgb(var(--border-subtle) / 0.4)",
                            borderLeft:
                              di === 0
                                ? "none"
                                : "1px solid rgb(var(--border-subtle) / 0.5)",
                            background:
                              di === todayIdx
                                ? "rgb(var(--brand-primary) / 0.025)"
                                : "transparent",
                          }}
                        >
                          {session && (
                            <div
                              className="sk-pop"
                              style={{
                                position: "absolute",
                                top: 4,
                                left: 4,
                                right: 4,
                                height: session.len * 56 - 8,
                                borderRadius: 8,
                                background:
                                  session.status === "pending"
                                    ? "rgb(var(--brand-primary))"
                                    : "rgb(var(--bg-sidebar))",
                                color:
                                  session.status === "pending" ? "#111009" : "#fff",
                                padding: "6px 8px",
                                fontSize: 10.5,
                                overflow: "hidden",
                                cursor: "pointer",
                                boxShadow: "0 2px 8px rgba(17,16,9,0.12)",
                                zIndex: 2,
                              }}
                            >
                              <div
                                className="truncate"
                                style={{ fontWeight: 700, marginBottom: 2 }}
                              >
                                {session.title}
                              </div>
                              <div
                                className="truncate"
                                style={{
                                  opacity: 0.7,
                                  fontFamily: "JetBrains Mono",
                                  fontSize: 9,
                                }}
                              >
                                {session.time}
                              </div>
                              <div
                                className="truncate"
                                style={{ opacity: 0.7, marginTop: 1 }}
                              >
                                {session.client}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card title="Intro Requests" icon={<Icon name="user-plus" size={14} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4 }}>
                {data.introRequests.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      background: "rgb(var(--bg-elevated))",
                      border: "1px solid rgb(var(--border-subtle))",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 6,
                      }}
                    >
                      <Avatar initials={initialsOf(r.who)} grad={r.avatar} size={28} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="truncate" style={{ fontSize: 12, fontWeight: 700 }}>
                          {r.who}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "rgb(var(--fg-muted))",
                            fontFamily: "JetBrains Mono",
                          }}
                        >
                          {r.when}
                        </div>
                      </div>
                    </div>
                    <p
                      style={{
                        margin: "0 0 8px",
                        fontSize: 11.5,
                        color: "rgb(var(--fg-muted))",
                        lineHeight: 1.4,
                      }}
                    >
                      {r.message}
                    </p>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="sk-pop"
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          flex: 1,
                          textAlign: "center",
                          padding: "7px 10px",
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 700,
                          background: "rgb(var(--fg-default))",
                          color: "rgb(var(--bg-background))",
                        }}
                      >
                        Accept
                      </button>
                      <button
                        className="sk-pop"
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          flex: 1,
                          textAlign: "center",
                          padding: "7px 10px",
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 600,
                          background: "transparent",
                          color: "rgb(var(--fg-muted))",
                          border: "1px solid rgb(var(--border-subtle))",
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
                {data.introRequests.length === 0 && (
                  <div
                    style={{
                      padding: 16,
                      fontSize: 12,
                      color: "rgb(var(--fg-muted))",
                      textAlign: "center",
                    }}
                  >
                    No intro requests yet.
                  </div>
                )}
              </div>
            </Card>

            <Card title="Today" icon={<Icon name="calendar" size={14} />}>
              <div style={{ padding: 4 }}>
                {(() => {
                  const next = data.sessions.find((s) => s.dayIndex === todayIdx);
                  if (next) return <NextSessionPreview session={next} />;
                  return null;
                })()}
                {data.sessions.find((s) => s.dayIndex === todayIdx) ? null : (
                  <div
                    style={{
                      padding: 14,
                      fontSize: 12,
                      color: "rgb(var(--fg-muted))",
                      textAlign: "center",
                    }}
                  >
                    Nothing on today.
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div
          className="reveal-up stagger-2"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 300px",
            gap: 14,
          }}
        >
          <Card
            title="Working Hours"
            icon={<Icon name="clock" size={14} />}
            action={
              <button
                onClick={copyMonToAll}
                className="sk-pop"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "rgb(var(--brand-primary))",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Copy Mon to weekdays
              </button>
            }
          >
            <div style={{ padding: "4px 4px 12px" }}>
              {fullDays.map((key, i) => {
                const dInfo = hoursByDay[key];
                return (
                  <div
                    key={key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "44px 110px 1fr auto",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      borderBottom:
                        i === fullDays.length - 1
                          ? "none"
                          : "1px solid rgb(var(--border-subtle) / 0.5)",
                      opacity: dInfo.on ? 1 : 0.55,
                    }}
                  >
                    <button
                      onClick={() => setDay(key, { on: !dInfo.on })}
                      className="sk-pop"
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        width: 36,
                        height: 22,
                        borderRadius: 11,
                        background: dInfo.on
                          ? "rgb(var(--brand-primary))"
                          : "rgb(var(--border-strong))",
                        position: "relative",
                        transition: "background 180ms ease",
                      }}
                      aria-label={dInfo.on ? "Disable" : "Enable"}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 2,
                          left: dInfo.on ? 16 : 2,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "#fff",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                          transition: "left 180ms ease",
                        }}
                      />
                    </button>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                      {fullDayLabels[key]}
                    </span>
                    {dInfo.on ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <select
                          style={selectCss}
                          value={dInfo.start}
                          onChange={(e) => setDay(key, { start: e.target.value })}
                        >
                          {TIME_OPTS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <span style={{ fontSize: 12, color: "rgb(var(--fg-muted))" }}>
                          —
                        </span>
                        <select
                          style={selectCss}
                          value={dInfo.end}
                          onChange={(e) => setDay(key, { end: e.target.value })}
                        >
                          {TIME_OPTS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span
                        style={{
                          fontSize: 12,
                          color: "rgb(var(--fg-faint))",
                          fontStyle: "italic",
                        }}
                      >
                        Closed
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        color: "rgb(var(--fg-muted))",
                        fontFamily: "JetBrains Mono",
                        minWidth: 36,
                        textAlign: "right",
                      }}
                    >
                      {dInfo.on
                        ? (() => {
                            const [shStr, smStr] = dInfo.start.split(":");
                            const [ehStr, emStr] = dInfo.end.split(":");
                            const sh = Number(shStr);
                            const sm = Number(smStr);
                            const eh = Number(ehStr);
                            const em = Number(emStr);
                            return `${(eh + em / 60 - sh - sm / 60).toFixed(1)}h`;
                          })()
                        : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card title="Session Defaults" icon={<Icon name="settings" size={14} />}>
              <div
                style={{
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div>
                  <div className="label-tiny" style={{ marginBottom: 8 }}>
                    Buffer between sessions
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {[0, 15, 30, 60].map((m) => (
                      <button
                        key={m}
                        onClick={() => setBuffer(m)}
                        className="sk-pop"
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          padding: "7px 11px",
                          borderRadius: 7,
                          fontSize: 11.5,
                          fontWeight: 700,
                          fontFamily: "JetBrains Mono",
                          background:
                            buffer === m
                              ? "rgb(var(--fg-default))"
                              : "rgb(var(--bg-elevated))",
                          color:
                            buffer === m
                              ? "rgb(var(--bg-background))"
                              : "rgb(var(--fg-default))",
                          border: "1px solid rgb(var(--border-subtle))",
                        }}
                      >
                        {m === 0 ? "None" : `${String(m)}m`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="label-tiny" style={{ marginBottom: 8 }}>
                    Timezone
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontFamily: "JetBrains Mono",
                      padding: "9px 11px",
                      borderRadius: 8,
                      background: "rgb(var(--bg-elevated))",
                      border: "1px solid rgb(var(--border-subtle))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{tz}</span>
                    <Icon name="chevron-down" size={12} style={{ color: "rgb(var(--fg-muted))" }} />
                  </div>
                </div>
              </div>
            </Card>

            <Card title="This Week" icon={<Icon name="zap" size={14} />}>
              <div
                style={{
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    className="tabular"
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 28,
                      fontWeight: 800,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {totalHours.toFixed(1)}h
                  </div>
                  <div style={{ fontSize: 11, color: "rgb(var(--fg-muted))" }}>
                    open per week
                  </div>
                  <div style={{ fontSize: 11, color: "rgb(var(--fg-muted))", marginTop: 4 }}>
                    Each product sets its own session length when you create it.
                  </div>
                </div>
                {status.kind === "error" && (
                  <p
                    role="alert"
                    style={{
                      fontSize: 11,
                      color: "rgb(var(--fg-danger))",
                      margin: 0,
                      lineHeight: 1.35,
                    }}
                  >
                    {status.message}
                  </p>
                )}
                {status.kind === "saved" && (
                  <p
                    role="status"
                    style={{
                      fontSize: 11,
                      color: "rgb(var(--fg-success))",
                      margin: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "rgb(var(--fg-success))",
                      }}
                    />
                    Saved
                  </p>
                )}
                <button
                  type="button"
                  onClick={onSaveAvailability}
                  disabled={pending || !dirty}
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: pending || !dirty ? "not-allowed" : "pointer",
                    marginTop: 4,
                    textAlign: "center",
                    padding: "9px 14px",
                    borderRadius: 8,
                    background: "rgb(var(--fg-default))",
                    color: "rgb(var(--bg-background))",
                    fontSize: 11.5,
                    fontWeight: 700,
                    opacity: pending || !dirty ? 0.6 : 1,
                  }}
                >
                  {pending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function NextSessionPreview({ session }: { session: CalendarSession }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgb(var(--brand-primary) / 0.08)",
        border: "1px solid rgb(var(--brand-primary) / 0.25)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "rgb(var(--brand-primary))",
          marginBottom: 4,
        }}
      >
        NEXT
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 2 }}>{session.title}</div>
      <div style={{ fontSize: 11.5, color: "rgb(var(--fg-muted))" }}>
        {session.time} · {session.client}
      </div>
    </div>
  );
}
