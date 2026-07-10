/* ===================================================================
   Skitza — mobile purchase flow · SECTION 4 SCREENS (Book)
   S10 Pick date & time · S11 Session confirmed + My sessions · S12 Cancel/reschedule
=================================================================== */
const { useState: useS4 } = React;
const SB4 = 60,
  HI4 = 30;

/* producer availability (single timezone · Israel, v1). Sunday-first weeks. */
const JUNE_AVAIL = {
  9: ["10:00", "13:00"],
  11: ["11:30", "14:00", "16:30"],
  12: ["10:00", "15:00"],
  15: ["12:00", "17:00"],
  18: ["11:00", "14:30"],
  19: ["16:00"],
  22: ["10:00", "13:00", "15:30"],
  24: ["14:00"],
  26: ["11:00", "16:30"],
  29: ["10:00", "12:30"],
};
/* firstDow = weekday of the 1st (Sun=0). June 2026 starts Mon(1); July starts Wed(3). */
const CAL_MONTHS = [
  { label: "June", year: 2026, firstDow: 1, days: 30, today: 8, avail: JUNE_AVAIL },
  { label: "July", year: 2026, firstDow: 3, days: 31, today: 0, avail: {} },
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/* the booked session shown on S11 / S12 */
const BOOKED = { dow: "Wed", date: "Jun 11", time: "14:00" };

/* ====================================================================
   S10 — PICK DATE & TIME  (funnel · Gate 3)
   gate: 'request' (approval on) | 'instant' (auto-book)
   state: 'pick' | 'loading' | 'noslots' | 'held'
==================================================================== */
function S10Book({ productId = "g1", gate = "request", state = "pick", back, onConfirm }) {
  const product = productById(productId);
  const held = state === "held";
  const [mi, setMi] = useS4(state === "noslots" ? 1 : 0);
  const month = CAL_MONTHS[mi];
  const [sel, setSel] = useS4(state === "noslots" ? null : 11);
  const [time, setTime] = useS4(held ? "14:00" : null);

  const isAvail = (d) => !!month.avail[d] && d >= month.today;
  const slots = sel != null ? month.avail[sel] || [] : [];
  const monthEmpty = Object.keys(month.avail).length === 0;
  const pickDay = (d) => {
    setSel(d);
    setTime(null);
  };
  const changeMonth = (delta) => {
    const n = mi + delta;
    if (n < 0 || n >= CAL_MONTHS.length) return;
    setMi(n);
    setSel(null);
    setTime(null);
  };

  const cells = [];
  for (let i = 0; i < month.firstDow; i++) cells.push(null);
  for (let d = 1; d <= month.days; d++) cells.push(d);

  const navBtn = (disabled) => ({
    all: "unset",
    cursor: disabled ? "default" : "pointer",
    width: 32,
    height: 32,
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: disabled ? "rgb(17 16 9 / .22)" : "rgb(17 16 9)",
    background: "rgb(17 16 9 / .04)",
  });

  const footer = (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        padding: `14px 18px ${HI4 + 10}px`,
        background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.96) 24%)",
      }}
    >
      {held ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginBottom: 11,
              fontFamily: "Outfit",
              fontSize: 12.5,
              color: "rgb(140 95 6)",
            }}
          >
            <span className="eq" style={{ color: "rgb(var(--brand-primary))" }}>
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              Holding {BOOKED.dow} {BOOKED.date} · {BOOKED.time} while {GILI.name} confirms
            </span>
          </div>
          <SecondaryCTA onClick={() => onConfirm(true)}>See it in My sessions</SecondaryCTA>
        </>
      ) : (
        <PrimaryCTA
          onClick={() => time && onConfirm(gate === "request")}
          disabled={!time}
          glow={!!time}
          sub={time ? `${month.label} ${sel} · ${time}` : "Pick a time to continue"}
        >
          {gate === "request" ? "Request this slot" : "Book this slot"} <Ic.arrowR />
        </PrimaryCTA>
      )}
    </div>
  );

  return (
    <Screen
      footer={footer}
      footerH={held ? 150 : 132}
      header={() => (
        <TopBar
          title="Pick a time"
          sub={gate === "request" ? "REQUEST · GILI CONFIRMS" : "INSTANT BOOK"}
          onBack={back}
        />
      )}
    >
      <div style={{ height: SB4 + 46 }} />

      <div style={{ padding: "14px 20px 0" }}>
        <h1
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: "-0.035em",
            margin: 0,
            color: "rgb(17 16 9)",
            lineHeight: 1.12,
          }}
        >
          When works for you?
        </h1>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 9,
            fontFamily: "Outfit",
            fontSize: 13,
            color: "rgb(var(--fg-muted))",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Ic.clock />
            {product.name}
          </span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{product.duration.includes("hour") ? product.duration : "In person"}</span>
        </div>
      </div>

      {/* month calendar */}
      <div style={{ padding: "18px 20px 0" }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 18,
            padding: "15px 16px 16px",
            boxShadow: "0 1px 2px rgba(17,16,9,.04), 0 14px 32px -22px rgba(17,16,9,.2)",
          }}
        >
          {/* month nav */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <button
              onClick={() => changeMonth(-1)}
              disabled={mi === 0}
              className={mi === 0 ? "" : "sk-pop"}
              style={navBtn(mi === 0)}
            >
              <Ic.chevL />
            </button>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 16.5,
                letterSpacing: "-0.02em",
                color: "rgb(17 16 9)",
              }}
            >
              {month.label} {month.year}
            </div>
            <button
              onClick={() => changeMonth(1)}
              disabled={mi >= CAL_MONTHS.length - 1}
              className={mi >= CAL_MONTHS.length - 1 ? "" : "sk-pop"}
              style={navBtn(mi >= CAL_MONTHS.length - 1)}
            >
              <Ic.chevR />
            </button>
          </div>
          {/* weekday header */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 3 }}>
            {WEEKDAYS.map((w, i) => (
              <div
                key={i}
                style={{
                  textAlign: "center",
                  fontFamily: "JetBrains Mono",
                  fontSize: 10,
                  color: "rgb(var(--fg-muted))",
                  padding: "3px 0",
                }}
              >
                {w}
              </div>
            ))}
          </div>
          {/* day grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((d, idx) => {
              if (d == null) return <div key={idx} />;
              const avail = isAvail(d);
              const clickable = avail && !held;
              const on = sel === d;
              return (
                <button
                  key={idx}
                  disabled={!clickable}
                  onClick={clickable ? () => pickDay(d) : undefined}
                  className={clickable ? "sk-pop" : ""}
                  style={{
                    all: "unset",
                    boxSizing: "border-box",
                    cursor: clickable ? "pointer" : "default",
                    pointerEvents: clickable ? "auto" : "none",
                    height: 42,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3,
                    borderRadius: 11,
                    background: on ? "rgb(17 16 9)" : "transparent",
                    boxShadow: on ? "0 6px 14px -6px rgba(17,16,9,.5)" : "none",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "Outfit",
                      fontWeight: on ? 700 : 600,
                      fontSize: 14.5,
                      lineHeight: 1,
                      color: on ? "#fff" : avail ? "rgb(17 16 9)" : "rgb(17 16 9 / .24)",
                    }}
                  >
                    {d}
                  </span>
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: avail
                        ? on
                          ? "rgb(var(--brand-primary))"
                          : "rgb(34 197 94)"
                        : "transparent",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        {/* legend */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginTop: 11,
            fontFamily: "Outfit",
            fontSize: 11,
            color: "rgb(var(--fg-muted))",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              style={{ width: 6, height: 6, borderRadius: 999, background: "rgb(34 197 94)" }}
            />{" "}
            Available
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 4, background: "rgb(17 16 9)" }} />{" "}
            Selected
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: 0.65 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                border: "1px solid rgb(17 16 9 / .25)",
              }}
            />{" "}
            Unavailable
          </span>
        </div>
      </div>

      {/* time slots */}
      <div style={{ padding: "20px 20px 0" }}>
        <Eyebrow style={{ marginBottom: 12 }}>
          {sel != null ? `${month.label} ${sel} · available times` : "Available times"}
        </Eyebrow>
        {state === "loading" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <Sk key={i} h={50} r={14} />
            ))}
          </div>
        ) : sel != null && slots.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {slots.map((t) => {
              const on = time === t;
              return (
                <button
                  key={t}
                  onClick={() => setTime(t)}
                  disabled={held}
                  className={held ? "" : "sk-pop"}
                  style={{
                    all: "unset",
                    cursor: held ? "default" : "pointer",
                    boxSizing: "border-box",
                    textAlign: "center",
                    padding: "15px 0",
                    borderRadius: 14,
                    fontFamily: "Outfit",
                    fontWeight: 700,
                    fontSize: 15.5,
                    background: on ? "rgb(var(--brand-primary))" : "#fff",
                    color: on ? "#1a1407" : "rgb(17 16 9)",
                    border: `1.5px solid ${on ? "rgb(var(--brand-primary))" : "rgb(var(--border-subtle))"}`,
                    boxShadow: on
                      ? "0 0 0 4px rgb(var(--brand-primary) / .14)"
                      : "0 1px 2px rgba(17,16,9,.04)",
                    opacity: held && !on ? 0.5 : 1,
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              background: "#fff",
              border: "1px dashed rgb(var(--border-strong, 200 192 178))",
              borderRadius: 16,
              padding: "26px 18px",
              textAlign: "center",
            }}
          >
            <span
              style={{
                width: 46,
                height: 46,
                borderRadius: 999,
                background: "rgb(17 16 9 / .05)",
                color: "rgb(var(--fg-muted))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <Ic.cal style={{ width: 21, height: 21 }} />
            </span>
            <div
              style={{ fontFamily: "Syne", fontWeight: 700, fontSize: 15, color: "rgb(17 16 9)" }}
            >
              {monthEmpty ? `Nothing open in ${month.label}` : "Pick a day"}
            </div>
            <div
              style={{
                fontFamily: "Outfit",
                fontSize: 13,
                color: "rgb(var(--fg-muted))",
                marginTop: 4,
              }}
            >
              {monthEmpty
                ? `${GILI.name} adds new times weekly — try another month.`
                : "Tap a highlighted day above to see open times."}
            </div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 14,
            fontFamily: "Outfit",
            fontSize: 11.5,
            color: "rgb(var(--fg-muted))",
          }}
        >
          <Ic.pin /> All times {GILI.city} (GMT+3). Reminders go out 24h &amp; 1h before.
        </div>
      </div>
    </Screen>
  );
}

/* ====================================================================
   S11 — SESSION CONFIRMED + MY SESSIONS  (standing · tab bar)
   state: 'confirmed' | 'held' | 'empty'
==================================================================== */
function S11Sessions({ productId = "g1", state = "confirmed", go, openSession, toast }) {
  const product = productById(productId);
  const tabbar = (
    <BottomTabBar
      active="book"
      onNav={(t) => {
        const m = { home: "s6", music: "s13", book: "s11", store: "s2" };
        if (m[t]) go({ screen: m[t] });
      }}
    />
  );
  const held = state === "held";
  const empty = state === "empty";
  const totalSessions = product.sessions; // finite number, or falsy = unlimited
  const unlimitedSessions = !totalSessions;
  const booked = empty ? 0 : 1;
  const remaining = unlimitedSessions ? Infinity : totalSessions - booked;
  const showDots = !unlimitedSessions && totalSessions <= 6;
  const pct = unlimitedSessions ? 0 : Math.round((booked / totalSessions) * 100);

  const sessions = empty
    ? []
    : [
        {
          id: "s1",
          dow: BOOKED.dow,
          date: BOOKED.date,
          time: BOOKED.time,
          held,
          product: product.name,
        },
      ];

  return (
    <Screen
      footer={tabbar}
      footerH={92}
      header={(top) => <StickyNav scrolled={top} title="My sessions" start={150} end={210} />}
    >
      <div style={{ height: SB4 + 14 }} />

      {!empty && (
        <div style={{ padding: "0 20px" }}>
          <div
            style={{
              background: held ? "rgb(245 158 11 / .09)" : "rgb(34 197 94 / .08)",
              border: `1px solid ${held ? "rgb(245 158 11 / .3)" : "rgb(34 197 94 / .3)"}`,
              borderRadius: 20,
              padding: "22px 20px",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "relative",
                width: 60,
                height: 60,
                margin: "0 auto 14px",
                borderRadius: 999,
                background: held ? "rgb(245 158 11)" : "rgb(34 197 94)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                boxShadow: `0 12px 28px -10px ${held ? "rgba(245,158,11,.6)" : "rgba(34,197,94,.55)"}`,
              }}
            >
              {held ? <Ic.clock style={{ width: 26, height: 26 }} /> : <Ic.checkFill />}
            </div>
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 10,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: held ? "rgb(146 95 6)" : "rgb(21 110 60)",
                marginBottom: 8,
              }}
            >
              {held ? "Holding your time" : "You're booked"}
            </div>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 27,
                letterSpacing: "-0.035em",
                color: "rgb(17 16 9)",
                lineHeight: 1.05,
              }}
            >
              {BOOKED.dow}, {BOOKED.date}
            </div>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 27,
                letterSpacing: "-0.035em",
                color: "rgb(17 16 9)",
                lineHeight: 1.05,
              }}
            >
              at {BOOKED.time}
            </div>
            <div
              style={{
                fontFamily: "Outfit",
                fontSize: 13,
                color: "rgb(var(--fg-muted))",
                marginTop: 8,
              }}
            >
              {held ? `${GILI.name} will confirm shortly.` : `${product.name} with ${GILI.name}`}
            </div>
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "11px 18px",
                  borderRadius: 999,
                  background: "rgb(17 16 9 / .04)",
                  border: "1px solid rgb(var(--border-subtle))",
                  color: "rgb(var(--fg-muted))",
                  fontFamily: "Outfit",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                <Ic.calPlus /> Add to calendar{" "}
                <Chip tone="plain" style={{ marginLeft: 2 }}>
                  Soon
                </Chip>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* active booking · book another session (multi-session products) */}
      {!empty && (
        <div style={{ padding: "20px 20px 0" }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid rgb(var(--border-subtle))",
              borderRadius: 18,
              padding: "16px 17px",
              boxShadow: "0 1px 2px rgba(17,16,9,.04)",
            }}
          >
            <Eyebrow gold style={{ marginBottom: 7 }}>
              Active booking
            </Eyebrow>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 16.5,
                letterSpacing: "-0.025em",
                color: "rgb(17 16 9)",
                lineHeight: 1.15,
              }}
            >
              {product.name}
            </div>

            {/* adaptive session progress: dots (≤6) · bar (7+) · count (unlimited) */}
            <div style={{ marginTop: 11 }}>
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 11.5,
                    color: "rgb(var(--fg-muted))",
                  }}
                >
                  <b style={{ color: "rgb(17 16 9)", fontWeight: 700 }}>{booked}</b>
                  {unlimitedSessions
                    ? ` session${booked !== 1 ? "s" : ""} booked`
                    : ` of ${totalSessions} booked`}
                </span>
                {unlimitedSessions ? (
                  <Chip tone="ok">Ongoing</Chip>
                ) : showDots ? (
                  <div style={{ display: "flex", gap: 5 }}>
                    {Array.from({ length: totalSessions }).map((_, i) => (
                      <span
                        key={i}
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 999,
                          background: i < booked ? "rgb(34 197 94)" : "#fff",
                          border: `1.5px solid ${i < booked ? "rgb(34 197 94)" : "rgb(200 192 178)"}`,
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <span
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 11,
                      color: "rgb(140 95 6)",
                      fontWeight: 600,
                    }}
                  >
                    {pct}%
                  </span>
                )}
              </div>
              {!unlimitedSessions && !showDots && (
                <div
                  style={{
                    height: 7,
                    borderRadius: 999,
                    background: "rgb(17 16 9 / .07)",
                    overflow: "hidden",
                    marginTop: 9,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(5, pct)}%`,
                      borderRadius: 999,
                      background: "linear-gradient(90deg, rgb(34 197 94), rgb(21 130 70))",
                    }}
                  />
                </div>
              )}
            </div>

            <div style={{ marginTop: 15 }}>
              {remaining > 0 ? (
                <PrimaryCTA
                  onClick={() => go({ screen: "s10" })}
                  glow={false}
                  sub={
                    unlimitedSessions
                      ? "Book as many as your plan allows"
                      : `${remaining} session${remaining > 1 ? "s" : ""} left on this booking`
                  }
                >
                  <Ic.calPlus /> Book another session
                </PrimaryCTA>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "13px",
                    borderRadius: 14,
                    background: "rgb(34 197 94 / .1)",
                    color: "rgb(21 110 60)",
                    fontFamily: "Outfit",
                    fontWeight: 600,
                    fontSize: 13.5,
                  }}
                >
                  <Ic.check /> All sessions booked
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* My sessions list */}
      <div style={{ padding: "22px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <Eyebrow gold>
            <span style={{ width: 18, height: 1, background: "currentColor" }} />
            My sessions
          </Eyebrow>
          <span
            style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "rgb(var(--fg-muted))" }}
          >
            {sessions.length}
          </span>
        </div>
        {empty ? (
          <div
            style={{
              background: "#fff",
              border: "1px dashed rgb(var(--border-strong, 200 192 178))",
              borderRadius: 16,
              padding: "30px 18px",
              textAlign: "center",
            }}
          >
            <span
              style={{
                width: 50,
                height: 50,
                borderRadius: 999,
                background: "rgb(17 16 9 / .05)",
                color: "rgb(var(--fg-muted))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 13,
              }}
            >
              <Ic.calPlus style={{ width: 23, height: 23 }} />
            </span>
            <div
              style={{ fontFamily: "Syne", fontWeight: 700, fontSize: 16, color: "rgb(17 16 9)" }}
            >
              No bookings yet
            </div>
            <div
              style={{
                fontFamily: "Outfit",
                fontSize: 13,
                color: "rgb(var(--fg-muted))",
                marginTop: 5,
                marginBottom: 16,
                textWrap: "pretty",
              }}
            >
              Buy a session with {GILI.name} first — then you can pick your times here.
            </div>
            <div style={{ maxWidth: 210, margin: "0 auto" }}>
              <PrimaryCTA onClick={() => go({ screen: "s2" })} glow={false}>
                <Ic.store style={{ width: 17, height: 17 }} /> Browse the store
              </PrimaryCTA>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => openSession(s)}
                className="sk-lift"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  boxSizing: "border-box",
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "15px 16px",
                  background: "#fff",
                  border: "1px solid rgb(var(--border-subtle))",
                  borderRadius: 16,
                  boxShadow: "0 1px 2px rgba(17,16,9,.04)",
                }}
              >
                <div
                  style={{
                    width: 50,
                    flexShrink: 0,
                    textAlign: "center",
                    padding: "8px 0",
                    borderRadius: 12,
                    background: "rgb(17 16 9 / .04)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 9,
                      letterSpacing: "0.08em",
                      color: "rgb(var(--fg-muted))",
                    }}
                  >
                    {s.dow.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontFamily: "Syne",
                      fontWeight: 800,
                      fontSize: 19,
                      color: "rgb(17 16 9)",
                      lineHeight: 1,
                    }}
                  >
                    {s.date.split(" ")[1]}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "Syne",
                      fontWeight: 700,
                      fontSize: 15.5,
                      letterSpacing: "-0.02em",
                      color: "rgb(17 16 9)",
                    }}
                  >
                    {s.product}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 3,
                      fontFamily: "JetBrains Mono",
                      fontSize: 11,
                      color: "rgb(var(--fg-muted))",
                    }}
                  >
                    <Ic.clock /> {s.time} · {GILI.name}
                  </div>
                </div>
                {s.held ? (
                  <StatusPill tone="pending">Pending</StatusPill>
                ) : (
                  <StatusPill tone="ok">Confirmed</StatusPill>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}

/* ====================================================================
   S12 — CANCEL / RESCHEDULE  (funnel · per-product time policy)
   policy: 'within' (self-serve) | 'outside' (locked, message producer)
==================================================================== */
function S12Manage({ productId = "g1", policy = "within", back, onReschedule, toast }) {
  const product = productById(productId);
  const within = policy === "within";
  const WINDOW = 24; // hours-before, per product

  return (
    <Screen footerH={0} header={() => <TopBar title="Session" sub="MANAGE" onBack={back} />}>
      <div style={{ height: SB4 + 46 }} />

      {/* session detail */}
      <div style={{ padding: "16px 20px 0" }}>
        <div
          style={{
            background: "rgb(17 16 9)",
            borderRadius: 20,
            padding: "20px",
            color: "rgb(247 243 236)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(120% 90% at 85% 0%, rgb(212 150 10 / .2), transparent 55%)",
            }}
          />
          <div style={{ position: "relative" }}>
            <StatusPill tone="ok">Confirmed</StatusPill>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 30,
                letterSpacing: "-0.04em",
                color: "#fff",
                lineHeight: 1.02,
                marginTop: 14,
              }}
            >
              {BOOKED.dow}, {BOOKED.date}
            </div>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 30,
                letterSpacing: "-0.04em",
                color: "#fff",
                lineHeight: 1.02,
              }}
            >
              at {BOOKED.time}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginTop: 14,
                paddingTop: 14,
                borderTop: "1px solid rgba(247,243,236,.14)",
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: skSwatch(GILI.hue),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "Syne",
                  fontWeight: 800,
                  fontSize: 11,
                }}
              >
                {GILI.initials}
              </span>
              <div>
                <div
                  style={{ fontFamily: "Outfit", fontWeight: 600, fontSize: 13.5, color: "#fff" }}
                >
                  {product.name}
                </div>
                <div
                  style={{ fontFamily: "Outfit", fontSize: 11.5, color: "rgba(247,243,236,.65)" }}
                >
                  with {GILI.name} · {GILI.city}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* policy note */}
      <div style={{ padding: "16px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            padding: "14px 16px",
            background: within ? "rgb(34 197 94 / .08)" : "rgb(245 158 11 / .1)",
            border: `1px solid ${within ? "rgb(34 197 94 / .26)" : "rgb(245 158 11 / .3)"}`,
            borderRadius: 14,
          }}
        >
          <span style={{ color: within ? "rgb(21 110 60)" : "rgb(146 95 6)", marginTop: 1 }}>
            {within ? <Ic.check /> : <Ic.clock />}
          </span>
          <div
            style={{
              fontFamily: "Outfit",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: within ? "rgb(21 90 52)" : "rgb(120 82 6)",
            }}
          >
            {within
              ? `You can change this yourself up to ${WINDOW}h before. ${GILI.name} will be notified.`
              : `Too close to the session — within ${WINDOW}h. Message ${GILI.name} directly to change it.`}
          </div>
        </div>
      </div>

      {/* actions */}
      <div style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 11 }}>
        {within ? (
          <>
            <PrimaryCTA onClick={onReschedule} glow={false}>
              <Ic.swap /> Reschedule
            </PrimaryCTA>
            <button
              onClick={() => toast && toast("Cancel flow — confirm step out of scope")}
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                boxSizing: "border-box",
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                padding: "15px 22px",
                borderRadius: 16,
                fontFamily: "Outfit",
                fontWeight: 600,
                fontSize: 15,
                background: "#fff",
                color: "rgb(176 38 30)",
                border: "1px solid rgb(220 38 38 / .3)",
              }}
            >
              <Ic.xcirc /> Cancel session
            </button>
          </>
        ) : (
          <>
            <div style={{ opacity: 0.55, pointerEvents: "none" }}>
              <div
                style={{
                  boxSizing: "border-box",
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 9,
                  padding: "15px 22px",
                  borderRadius: 16,
                  fontFamily: "Outfit",
                  fontWeight: 700,
                  fontSize: 15,
                  background: "rgb(17 16 9 / .07)",
                  color: "rgb(var(--fg-muted))",
                }}
              >
                <Ic.swap /> Reschedule
              </div>
            </div>
            <PrimaryCTA
              onClick={() => toast && toast(`Opening chat with ${GILI.name} — out of scope`)}
              glow={false}
            >
              <Ic.message /> <span>Message {GILI.name}</span>
            </PrimaryCTA>
          </>
        )}
      </div>

      <div style={{ padding: "16px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            fontFamily: "Outfit",
            fontSize: 11.5,
            color: "rgb(var(--fg-muted))",
            lineHeight: 1.45,
          }}
        >
          <span style={{ marginTop: 1 }}>
            <Ic.shield />
          </span>
          <span>
            The time policy controls changes only. Refunds and deposits follow your signed
            agreement, off-app.
          </span>
        </div>
      </div>
    </Screen>
  );
}

Object.assign(window, { S10Book, S11Sessions, S12Manage });
