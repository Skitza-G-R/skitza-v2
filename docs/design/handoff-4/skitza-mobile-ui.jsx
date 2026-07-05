/* ===================================================================
   Skitza — mobile purchase flow · SHARED UI
   Warm Skitza chrome that lives inside the iOS frame.
=================================================================== */
const { useState: useStateUI } = React;

/* Round / squircle avatar with the producer's cover gradient */
function Avatar({ p, size = 44, square = false, ring = false }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: square ? Math.max(8, size * 0.3) : size,
        background: skSwatch(p.hue),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontFamily: "Syne",
        fontWeight: 800,
        letterSpacing: "-0.04em",
        fontSize: size * 0.36,
        position: "relative",
        overflow: "hidden",
        boxShadow: ring
          ? "0 0 0 3px rgba(255,255,255,.92), 0 8px 22px -8px rgba(17,16,9,.45)"
          : "0 1px 2px rgba(0,0,0,.12)",
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 80% at 30% 18%, rgba(255,255,255,.34), transparent 60%)",
        }}
      />
      <span style={{ position: "relative" }}>{p.initials}</span>
    </span>
  );
}

/* Mono eyebrow / catalog label */
function Eyebrow({ children, gold = false, style = {} }) {
  return (
    <div
      style={{
        fontFamily: "JetBrains Mono",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: gold ? "rgb(var(--brand-primary))" : "rgb(var(--fg-muted))",
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* Status pill */
function Pill({ tone = "neutral", children }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/* Small mono chip */
function Chip({ children, tone, style = {} }) {
  const tones = {
    amber: {
      bg: "rgb(var(--brand-primary) / .14)",
      fg: "rgb(140 95 6)",
      bd: "rgb(var(--brand-primary) / .32)",
    },
    dark: { bg: "rgb(17 16 9)", fg: "rgb(var(--brand-primary))", bd: "transparent" },
    ok: { bg: "rgb(34 197 94 / .12)", fg: "rgb(34 130 70)", bd: "rgb(34 197 94 / .28)" },
    plain: { bg: "#fff", fg: "rgb(var(--fg-muted))", bd: "rgb(var(--border-subtle))" },
  };
  const t = tones[tone] || tones.plain;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 999,
        fontFamily: "JetBrains Mono",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* Glass round button for floating chrome (back / share / close over covers) */
function GlassRound({ children, onClick, dark = false, size = 38 }) {
  return (
    <button
      onClick={onClick}
      className="sk-pop"
      style={{
        all: "unset",
        cursor: "pointer",
        width: size,
        height: size,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: dark ? "rgba(20,18,12,.34)" : "rgba(255,255,255,.86)",
        color: dark ? "#fff" : "rgb(17 16 9)",
        backdropFilter: "blur(14px) saturate(160%)",
        WebkitBackdropFilter: "blur(14px) saturate(160%)",
        boxShadow: dark ? "0 2px 10px rgba(0,0,0,.25)" : "0 2px 10px rgba(17,16,9,.12)",
        border: dark ? "0.5px solid rgba(255,255,255,.18)" : "0.5px solid rgba(17,16,9,.06)",
      }}
    >
      {children}
    </button>
  );
}

/* Full-width primary CTA used at the bottom of funnel screens */
function PrimaryCTA({ children, onClick, disabled = false, glow = true, sub = null }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={disabled ? "" : "sk-pop"}
      style={{
        all: "unset",
        boxSizing: "border-box",
        width: "100%",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        position: "relative",
        overflow: "hidden",
        padding: "16px 22px",
        borderRadius: 16,
        textAlign: "center",
        fontFamily: "Outfit",
        fontWeight: 700,
        fontSize: 16,
        background: disabled ? "rgb(17 16 9 / .07)" : "rgb(var(--brand-primary))",
        color: disabled ? "rgb(var(--fg-muted) / .8)" : "#1a1407",
        boxShadow: disabled
          ? "none"
          : glow
            ? "0 0 0 4px rgb(var(--brand-primary) / .16), 0 14px 30px -10px rgb(var(--brand-primary) / .7)"
            : "none",
      }}
    >
      {!disabled && <span className="sk-sheen" aria-hidden="true" />}
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 9 }}>
        {children}
      </span>
      {sub && (
        <span
          style={{
            position: "relative",
            fontFamily: "JetBrains Mono",
            fontSize: 10,
            fontWeight: 500,
            opacity: 0.72,
            letterSpacing: "0.04em",
          }}
        >
          {sub}
        </span>
      )}
    </button>
  );
}

function SecondaryCTA({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="sk-pop"
      style={{
        all: "unset",
        boxSizing: "border-box",
        width: "100%",
        cursor: "pointer",
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
        color: "rgb(17 16 9)",
        border: "1px solid rgb(var(--border-strong, 200 192 178))",
        boxShadow: "0 1px 2px rgba(17,16,9,.05)",
      }}
    >
      {children}
    </button>
  );
}

/* A portfolio track row with play/pause (S1) */
function TrackRow({ track, idx, playing, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="sk-row"
      style={{
        all: "unset",
        cursor: "pointer",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "11px 6px",
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          borderRadius: 12,
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
          background: skSwatch(track.hue),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          boxShadow: "0 4px 12px -4px rgba(17,16,9,.3)",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            background: playing ? "rgba(17,16,9,.32)" : "rgba(17,16,9,.12)",
            transition: "background .2s",
          }}
        />
        <span style={{ position: "relative" }}>{playing ? <Ic.pause /> : <Ic.play />}</span>
      </span>
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
          {track.title}
        </div>
        <div
          style={{
            fontFamily: "Outfit",
            fontSize: 12.5,
            color: "rgb(var(--fg-muted))",
            marginTop: 1,
          }}
        >
          {track.artist}
        </div>
      </div>
      {playing ? (
        <span className="eq" style={{ color: "rgb(var(--brand-primary))" }}>
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : (
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: "rgb(var(--fg-muted))",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {track.len}
        </span>
      )}
    </button>
  );
}

/* Bottom tab bar — standing app screens. onNav(tabId) makes tabs navigate. */
function BottomTabBar({ active = "store", onNav }) {
  const tabs = [
    { id: "home", label: "Home", icon: Ic.home },
    { id: "music", label: "Music", icon: Ic.music },
    { id: "book", label: "Book", icon: Ic.book },
    { id: "store", label: "Store", icon: Ic.store },
    { id: "settings", label: "Settings", icon: Ic.gear },
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        paddingBottom: 26,
        paddingTop: 9,
        background: "rgba(247,243,236,.86)",
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        borderTop: "1px solid rgb(17 16 9 / .07)",
        display: "grid",
        gridTemplateColumns: "repeat(5,1fr)",
      }}
    >
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onNav && onNav(t.id)}
            className={onNav ? "sk-pop" : ""}
            style={{
              all: "unset",
              cursor: onNav ? "pointer" : "default",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              color: on ? "rgb(var(--brand-primary))" : "rgb(var(--fg-muted) / .85)",
            }}
          >
            <t.icon style={{ width: 23, height: 23 }} />
            <span
              style={{
                fontFamily: "Outfit",
                fontSize: 10,
                fontWeight: on ? 700 : 500,
                color: on ? "rgb(140 95 6)" : "rgb(var(--fg-muted))",
              }}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* Skeleton block */
function Sk({ w = "100%", h = 14, r = 8, style = {} }) {
  return <div className="sk-shimmer" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/* ──────────────────────────────────────────────────────────────────
   StickyNav — collapsing header that catches the status bar.
   At rest (over the cover) it's transparent with dark-glass round
   buttons. As you scroll it fades to a solid cream bar with a centered
   title, so the iOS clock/battery always sit on a clean background.
   `scrolled` = live scrollTop in px.
────────────────────────────────────────────────────────────────── */
const SB_SAFE = 60; /* status-bar safe area, matches screens */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function StickyNav({
  scrolled = 0,
  title,
  sub,
  onBack,
  backIcon = "chev",
  action = null,
  start = 46,
  end = 116,
  navH = 46,
}) {
  const p = Math.min(1, Math.max(0, (scrolled - start) / (end - start)));
  const ease = p * p * (3 - 2 * p); /* smoothstep */
  // back/heart buttons crossfade dark-glass → light solid
  const btnBg = `rgba(${lerp(20, 255, ease)},${lerp(18, 255, ease)},${lerp(12, 255, ease)},${lerp(0.34, 0.92, ease)})`;
  const iconCol = `rgb(${lerp(255, 17, ease)},${lerp(255, 16, ease)},${lerp(255, 9, ease)})`;
  const RoundBtn = ({ children, onClick }) => (
    <button
      onClick={onClick}
      className="sk-pop"
      style={{
        all: "unset",
        cursor: "pointer",
        width: 38,
        height: 38,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: btnBg,
        color: iconCol,
        backdropFilter: "blur(14px) saturate(160%)",
        WebkitBackdropFilter: "blur(14px) saturate(160%)",
        boxShadow: `0 2px 10px rgba(0,0,0,${lerp(0.22, 0.08, ease)})`,
        border: `0.5px solid rgba(17,16,9,${lerp(0.0, 0.06, ease)})`,
      }}
    >
      {children}
    </button>
  );
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: SB_SAFE + navH,
        pointerEvents: "none",
      }}
    >
      {/* solid backing fades in */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(247,243,236,.88)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          borderBottom: "1px solid rgb(17 16 9 / .08)",
          opacity: ease,
          transition: "opacity .1s linear",
        }}
      />
      {/* nav row */}
      <div
        style={{
          position: "absolute",
          top: SB_SAFE - 8,
          left: 14,
          right: 14,
          height: navH,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pointerEvents: "auto",
        }}
      >
        {onBack ? (
          <RoundBtn onClick={onBack}>{backIcon === "close" ? <Ic.close /> : <Ic.chevL />}</RoundBtn>
        ) : (
          <span style={{ width: 38 }} />
        )}
        {/* collapsing title */}
        <div
          style={{
            position: "absolute",
            left: 56,
            right: 56,
            textAlign: "center",
            opacity: ease,
            transform: `translateY(${lerp(7, 0, ease)}px)`,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: "-0.02em",
              color: "rgb(17 16 9)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
          {sub && (
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 9,
                letterSpacing: "0.08em",
                color: "rgb(var(--fg-muted))",
                marginTop: 1,
              }}
            >
              {sub}
            </div>
          )}
        </div>
        {action ? (
          <RoundBtn onClick={action.onClick}>{action.icon}</RoundBtn>
        ) : (
          <span style={{ width: 38 }} />
        )}
      </div>
    </div>
  );
}

/* Solid top bar for funnel screens that have no cover (S4 etc.) */
function TopBar({ title, sub, onBack, action = null }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: SB_SAFE + 46,
        background: "rgba(247,243,236,.9)",
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        borderBottom: "1px solid rgb(17 16 9 / .07)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: SB_SAFE - 8,
          left: 14,
          right: 14,
          height: 46,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {onBack ? (
          <button
            onClick={onBack}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              width: 38,
              height: 38,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fff",
              color: "rgb(17 16 9)",
              border: "1px solid rgb(17 16 9 / .08)",
              boxShadow: "0 1px 2px rgba(17,16,9,.06)",
            }}
          >
            <Ic.chevL />
          </button>
        ) : (
          <span style={{ width: 38 }} />
        )}
        <div style={{ position: "absolute", left: 56, right: 56, textAlign: "center" }}>
          <div
            style={{
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: "-0.02em",
              color: "rgb(17 16 9)",
            }}
          >
            {title}
          </div>
          {sub && (
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 9,
                letterSpacing: "0.08em",
                color: "rgb(var(--fg-muted))",
                marginTop: 1,
              }}
            >
              {sub}
            </div>
          )}
        </div>
        {action ? (
          <button
            onClick={action.onClick}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              width: 38,
              height: 38,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fff",
              color: "rgb(17 16 9)",
              border: "1px solid rgb(17 16 9 / .08)",
            }}
          >
            {action.icon}
          </button>
        ) : (
          <span style={{ width: 38 }} />
        )}
      </div>
    </div>
  );
}

/* Status pill — warm tints, matches the handoff's status system */
function StatusPill({ tone = "pending", children, dot = true }) {
  const tones = {
    pending: { bg: "rgb(245 158 11 / .14)", fg: "rgb(146 95 6)", dot: "rgb(245 158 11)" },
    ok: { bg: "rgb(34 197 94 / .15)", fg: "rgb(21 110 60)", dot: "rgb(34 197 94)" },
    danger: { bg: "rgb(220 38 38 / .1)", fg: "rgb(176 38 30)", dot: "rgb(220 38 38)" },
    neutral: { bg: "rgb(17 16 9 / .06)", fg: "rgb(var(--fg-muted))", dot: "rgb(var(--fg-muted))" },
  };
  const t = tones[tone] || tones.pending;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 12px 6px 10px",
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        fontFamily: "Outfit",
        fontWeight: 600,
        fontSize: 12.5,
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: t.dot,
            animation: tone === "pending" ? "sk-breathe 2s ease-in-out infinite" : "none",
          }}
        />
      )}
      {children}
    </span>
  );
}

/* 4-node journey stepper for the Home status card.
   stage: 'request' | 'pay' | 'book' | 'done'; declined flag tints node 1. */
function Stepper({ stage = "request", declined = false }) {
  const steps = [
    { id: "request", label: "Request" },
    { id: "pay", label: "Pay" },
    { id: "book", label: "Sessions" },
    { id: "done", label: "Delivered" },
  ];
  const order = ["request", "pay", "book", "done"];
  const cur = order.indexOf(stage);
  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      {steps.map((s, i) => {
        const done = i < cur;
        const active = i === cur;
        const isDeclined = declined && i === 0;
        const ringCol = isDeclined
          ? "rgb(220 38 38)"
          : done
            ? "rgb(34 197 94)"
            : active
              ? "rgb(var(--brand-primary))"
              : "rgb(17 16 9 / .14)";
        const fill = isDeclined
          ? "rgb(220 38 38)"
          : done
            ? "rgb(34 197 94)"
            : active
              ? "rgb(var(--brand-primary))"
              : "#fff";
        return (
          <React.Fragment key={s.id}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                flex: "0 0 auto",
                width: 52,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: done || active || isDeclined ? fill : "#fff",
                  border: `2px solid ${ringCol}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  position: "relative",
                }}
              >
                {active && !isDeclined && (
                  <span
                    style={{
                      position: "absolute",
                      inset: -5,
                      borderRadius: 999,
                      border: "2px solid rgb(var(--brand-primary) / .3)",
                      animation: "sk-pulse 1.8s ease-out infinite",
                    }}
                  />
                )}
                {done && (
                  <span style={{ display: "flex" }}>
                    <Ic.check />
                  </span>
                )}
                {isDeclined && (
                  <span
                    style={{ fontFamily: "Outfit", fontWeight: 800, fontSize: 13, lineHeight: 1 }}
                  >
                    !
                  </span>
                )}
                {active && !isDeclined && (
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: "#fff" }} />
                )}
              </span>
              <span
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 8.5,
                  letterSpacing: "0.04em",
                  color: done || active ? "rgb(17 16 9)" : "rgb(var(--fg-muted))",
                  fontWeight: active ? 700 : 500,
                  textTransform: "uppercase",
                }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                style={{
                  flex: 1,
                  height: 2,
                  borderRadius: 2,
                  marginTop: 10,
                  background: i < cur ? "rgb(34 197 94)" : "rgb(17 16 9 / .1)",
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* Inline checkbox row */
function CheckRow({ checked, onToggle, children }) {
  return (
    <button
      onClick={onToggle}
      className="sk-pop"
      style={{
        all: "unset",
        cursor: "pointer",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "15px 16px",
        background: "#fff",
        border: `1.5px solid ${checked ? "rgb(var(--brand-primary))" : "rgb(200 192 178)"}`,
        borderRadius: 14,
        transition: "border-color .18s",
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          flexShrink: 0,
          borderRadius: 7,
          background: checked ? "rgb(var(--brand-primary))" : "#fff",
          border: `2px solid ${checked ? "rgb(var(--brand-primary))" : "rgb(200 192 178)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#1a1407",
          transition: "all .18s",
        }}
      >
        {checked && <Ic.check />}
      </span>
      <span
        style={{
          fontFamily: "Outfit",
          fontSize: 14,
          fontWeight: 500,
          color: "rgb(17 16 9)",
          lineHeight: 1.4,
          textAlign: "left",
        }}
      >
        {children}
      </span>
    </button>
  );
}

Object.assign(window, { StickyNav, TopBar, StatusPill, Stepper, CheckRow });

Object.assign(window, {
  Avatar,
  Eyebrow,
  Pill,
  Chip,
  GlassRound,
  PrimaryCTA,
  SecondaryCTA,
  TrackRow,
  BottomTabBar,
  Sk,
});
