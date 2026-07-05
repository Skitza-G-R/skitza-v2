/* ===================================================================
   Skitza — STORE (S2) · three browse directions
   ladder (editorial, tiered) · shelf (record-shop) · compare (decision-first)
   Overrides window.S2Store (loaded after skitza-screens.jsx).
=================================================================== */
const { useState: useStore } = React;
const SB_S2 = 60,
  HI_S2 = 30;

/* per-product browse meta (distinct cover hue, tier, outcome, social proof, demo track) */
const STORE_META = {
  g1: {
    hue: 44,
    tier: "Signature",
    outcome: "A finished, release-ready single",
    booked: 24,
    track: "Slow Tide",
  },
  g2: {
    hue: 30,
    tier: "Start here",
    outcome: "Walk out with your stems",
    booked: 41,
    track: "Room 4 AM",
  },
  g3: {
    hue: 12,
    tier: "The craft",
    outcome: "A broadcast-ready master",
    booked: 33,
    track: "Golden Hour",
  },
  g4: {
    hue: 340,
    tier: "Bundle",
    outcome: "Five finished singles",
    booked: 7,
    track: "Closer Still",
  },
};
const metaOf = (p) =>
  STORE_META[p.id] || { hue: GILI.hue, tier: "", outcome: "", booked: 0, track: "" };
const planLabel = (p) =>
  (p.plans || []).includes("split")
    ? "or 50–50"
    : (p.plans || []).includes("milestones")
      ? "or milestones"
      : "pay in full";

/* ── shared bits ─────────────────────────────────────────────── */
function PlayBadge({ on, onClick, size = 30, dark = false }) {
  return (
    <span
      role="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="sk-pop"
      style={{
        cursor: "pointer",
        width: size,
        height: size,
        borderRadius: 999,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: dark ? "rgba(20,18,12,.42)" : "rgba(255,255,255,.9)",
        color: dark ? "#fff" : "rgb(17 16 9)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 2px 8px rgba(17,16,9,.18)",
      }}
    >
      {on ? (
        <span className="eq" style={{ color: dark ? "#fff" : "rgb(140 95 6)" }}>
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : (
        <Ic.play style={{ width: size * 0.42, height: size * 0.42 }} />
      )}
    </span>
  );
}

function SpecChips({ product }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <Chip>{product.sessions > 1 ? `${product.sessions} sessions` : "1 session"}</Chip>
      <Chip>
        <Ic.clock />
        {product.duration.split("·")[0].trim()}
      </Chip>
      <Chip>
        <Ic.shield />
        {product.deposit}% deposit
      </Chip>
    </div>
  );
}

function PricePlan({ product, big = false }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "JetBrains Mono",
          fontSize: 9,
          color: "rgb(var(--fg-muted))",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        From
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <span
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: big ? 28 : 21,
            letterSpacing: "-0.035em",
            color: "rgb(17 16 9)",
            lineHeight: 1,
          }}
        >
          {ils(product.price)}
        </span>
      </div>
    </div>
  );
}

function SocialProof({ product, style = {} }) {
  const m = metaOf(product);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "JetBrains Mono",
        fontSize: 10,
        color: "rgb(var(--fg-muted))",
        ...style,
      }}
    >
      <span
        style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "rgb(140 95 6)" }}
      >
        <Ic.star style={{ color: "rgb(var(--brand-primary))" }} />
        {GILI.rating}
      </span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span>{m.booked} booked</span>
    </span>
  );
}

/* producer hero shared across directions */
function StoreHero({ tag }) {
  return (
    <div>
      <div
        style={{
          height: 132,
          background: skCover(GILI.hue),
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,.14), transparent 55%, rgba(247,243,236,1) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: SB_S2 + 4,
            left: 20,
            right: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Eyebrow style={{ color: "rgba(255,255,255,.92)" }}>Store · {tag}</Eyebrow>
          <GlassRound dark size={34}>
            <Ic.share />
          </GlassRound>
        </div>
      </div>
      <div style={{ padding: "0 20px", marginTop: -30, position: "relative", zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 13 }}>
          <Avatar p={GILI} size={62} square ring />
          <div style={{ paddingBottom: 2, flex: 1 }}>
            <h1
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 22,
                letterSpacing: "-0.03em",
                margin: 0,
                color: "rgb(17 16 9)",
              }}
            >
              {GILI.name}
            </h1>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginTop: 3,
                fontFamily: "JetBrains Mono",
                fontSize: 10.5,
                color: "rgb(var(--fg-muted))",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  color: "rgb(140 95 6)",
                }}
              >
                <Ic.star style={{ color: "rgb(var(--brand-primary))" }} />
                {GILI.rating}
              </span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>Booking June</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>replies in ~1 day</span>
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 13,
            padding: "9px 13px",
            background: "rgb(var(--brand-primary) / .1)",
            border: "1px solid rgb(var(--brand-primary) / .24)",
            borderRadius: 12,
          }}
        >
          <span style={{ color: "rgb(140 95 6)" }}>
            <Ic.spark />
          </span>
          <span style={{ fontFamily: "Outfit", fontSize: 12.5, color: "rgb(120 82 6)" }}>
            Hand-picked for {ARTIST.first} — Gili only takes a few projects a month.
          </span>
        </div>
      </div>
    </div>
  );
}

/* product cover block (distinct hue, sku, tier badge, play) */
function CoverBlock({ product, height, playing, onPlay, rounded = false }) {
  const m = metaOf(product);
  return (
    <div
      style={{
        height,
        background: skCover(m.hue),
        position: "relative",
        overflow: "hidden",
        borderRadius: rounded ? 16 : 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 14,
          fontFamily: "JetBrains Mono",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color: "rgba(255,255,255,.85)",
        }}
      >
        {product.sku}
      </div>
      <span style={{ position: "absolute", top: 11, right: 12 }}>
        <Chip tone="dark">{m.tier}</Chip>
      </span>
      <div
        style={{
          position: "absolute",
          left: 14,
          bottom: 12,
          fontFamily: "Syne",
          fontWeight: 800,
          fontSize: 24,
          letterSpacing: "-0.035em",
          color: "#fff",
        }}
      >
        {GILI.initials}
      </div>
      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{ fontFamily: "JetBrains Mono", fontSize: 9.5, color: "rgba(255,255,255,.85)" }}
        >
          {playing ? "Now playing" : `Hear ${m.track}`}
        </span>
        <PlayBadge on={playing} onClick={onPlay} dark size={32} />
      </div>
    </div>
  );
}

/* ── A · LADDER (editorial, tiered) ──────────────────────────── */
function LadderView({ products, openProduct, playing, setPlay }) {
  const flagship = products.find((p) => p.id === FLAGSHIP_ID);
  const groups = [
    { label: "Start here", items: products.filter((p) => p.id === "g2") },
    { label: "Signature", items: products.filter((p) => p.id === "g1") },
    { label: "Go further", items: products.filter((p) => p.id === "g3" || p.id === "g4") },
  ];
  return (
    <div style={{ padding: "20px 20px 0" }}>
      {groups.map((g, gi) => (
        <div key={g.label} style={{ marginBottom: gi === groups.length - 1 ? 0 : 22 }}>
          <Eyebrow gold={g.label === "Signature"} style={{ marginBottom: 11 }}>
            <span style={{ width: 16, height: 1, background: "currentColor" }} />
            {g.label}
          </Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {g.items.map((p) => {
              const big = p.id === FLAGSHIP_ID;
              const m = metaOf(p);
              return (
                <button
                  key={p.id}
                  onClick={() => openProduct(p.id)}
                  className="sk-lift"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    background: "#fff",
                    border: `1px solid ${big ? "rgb(var(--brand-primary) / .35)" : "rgb(var(--border-subtle))"}`,
                    borderRadius: 20,
                    overflow: "hidden",
                    boxShadow: big
                      ? "0 1px 2px rgba(17,16,9,.04), 0 20px 44px -24px rgba(17,16,9,.3)"
                      : "0 1px 2px rgba(17,16,9,.04)",
                  }}
                >
                  <CoverBlock
                    product={p}
                    height={big ? 124 : 96}
                    playing={playing === p.id}
                    onPlay={() => setPlay(playing === p.id ? null : p.id)}
                  />
                  <div style={{ padding: big ? "16px 17px 17px" : "14px 16px 15px" }}>
                    <div
                      style={{
                        fontFamily: "Syne",
                        fontWeight: 800,
                        fontSize: big ? 21 : 17.5,
                        letterSpacing: "-0.03em",
                        color: "rgb(17 16 9)",
                        lineHeight: 1.1,
                      }}
                    >
                      {p.name}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        marginTop: 6,
                        fontFamily: "Outfit",
                        fontSize: 12.5,
                        color: "rgb(61 55 48)",
                      }}
                    >
                      <Ic.arrowR style={{ width: 14, height: 14, color: "rgb(140 95 6)" }} />
                      {m.outcome}
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <SpecChips product={p} />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "space-between",
                        marginTop: 15,
                        paddingTop: 14,
                        borderTop: "1px dashed rgb(var(--border-subtle))",
                      }}
                    >
                      <div>
                        <PricePlan product={p} big={big} />
                        <div style={{ marginTop: 7 }}>
                          <SocialProof product={p} />
                        </div>
                      </div>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "11px 17px",
                          borderRadius: 999,
                          background: big ? "rgb(var(--brand-primary))" : "rgb(17 16 9)",
                          color: big ? "#1a1407" : "rgb(var(--brand-primary))",
                          fontFamily: "Outfit",
                          fontWeight: 700,
                          fontSize: 13.5,
                        }}
                      >
                        View <Ic.chevR />
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── B · SHELF (record-shop, cover-forward) ──────────────────── */
function ShelfView({ products, openProduct, playing, setPlay }) {
  const flagship = products.find((p) => p.id === FLAGSHIP_ID);
  const rest = products.filter((p) => p.id !== FLAGSHIP_ID);
  return (
    <div style={{ padding: "18px 20px 0" }}>
      <Eyebrow gold style={{ marginBottom: 11 }}>
        <span style={{ width: 16, height: 1, background: "currentColor" }} />
        Signature
      </Eyebrow>
      <button
        onClick={() => openProduct(flagship.id)}
        className="sk-lift"
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          background: "#fff",
          border: "1px solid rgb(var(--border-subtle))",
          borderRadius: 20,
          overflow: "hidden",
          position: "relative",
          marginBottom: 22,
          boxShadow: "0 1px 2px rgba(17,16,9,.04), 0 20px 44px -24px rgba(17,16,9,.32)",
        }}
      >
        <div
          style={{ height: 178, background: skCover(metaOf(flagship).hue), position: "relative" }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(17,16,9,.12) 0%, transparent 34%, rgba(17,16,9,.6) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 13,
              left: 15,
              right: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "rgba(255,255,255,.85)",
              }}
            >
              {flagship.sku} · {metaOf(flagship).tier.toUpperCase()}
            </span>
            <PlayBadge
              on={playing === flagship.id}
              onClick={() => setPlay(playing === flagship.id ? null : flagship.id)}
              dark
              size={34}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: 15,
              color: "#fff",
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
            }}
          >
            {flagship.name}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "15px 17px 16px",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 9,
                color: "rgb(var(--fg-muted))",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              From
            </div>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 27,
                letterSpacing: "-0.04em",
                color: "rgb(17 16 9)",
                lineHeight: 1,
                marginTop: 2,
              }}
            >
              {ils(flagship.price)}
            </div>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 20px",
              borderRadius: 999,
              background: "rgb(var(--brand-primary))",
              color: "#1a1407",
              fontFamily: "Outfit",
              fontWeight: 700,
              fontSize: 14.5,
            }}
          >
            View <Ic.chevR />
          </span>
        </div>
      </button>

      <Eyebrow style={{ marginBottom: 11 }}>The rest of the shelf</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {rest.map((p) => {
          const m = metaOf(p);
          return (
            <button
              key={p.id}
              onClick={() => openProduct(p.id)}
              className="sk-lift"
              style={{
                all: "unset",
                cursor: "pointer",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  aspectRatio: "1",
                  borderRadius: 16,
                  background: skCover(m.hue),
                  position: "relative",
                  overflow: "hidden",
                  boxShadow: "0 10px 24px -12px rgba(17,16,9,.4)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(180deg, transparent 38%, rgba(17,16,9,.68) 100%)",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    top: 10,
                    left: 11,
                    fontFamily: "JetBrains Mono",
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    color: "rgba(255,255,255,.85)",
                  }}
                >
                  {m.tier.toUpperCase()}
                </span>
                <div style={{ position: "absolute", right: 9, bottom: 9 }}>
                  <PlayBadge
                    on={playing === p.id}
                    onClick={() => setPlay(playing === p.id ? null : p.id)}
                    dark
                    size={30}
                  />
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 12,
                    right: 46,
                    bottom: 11,
                    fontFamily: "Syne",
                    fontWeight: 800,
                    fontSize: 16,
                    letterSpacing: "-0.02em",
                    color: "#fff",
                    lineHeight: 1.1,
                    textWrap: "balance",
                  }}
                >
                  {p.name}
                </div>
              </div>
              <div style={{ padding: "10px 2px 0" }}>
                <div
                  style={{
                    fontFamily: "Syne",
                    fontWeight: 800,
                    fontSize: 16,
                    letterSpacing: "-0.03em",
                    color: "rgb(17 16 9)",
                  }}
                >
                  {ils(p.price)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── C · COMPARE (decision-first) ────────────────────────────── */
function CompareView({ products, openProduct }) {
  const order = ["g2", "g1", "g3", "g4"];
  const list = order.map((id) => products.find((p) => p.id === id)).filter(Boolean);
  return (
    <div style={{ padding: "20px 20px 0" }}>
      <Eyebrow style={{ marginBottom: 6 }}>Compare offers</Eyebrow>
      <p
        style={{
          fontFamily: "Outfit",
          fontSize: 13,
          color: "rgb(var(--fg-muted))",
          margin: "0 0 14px",
          lineHeight: 1.5,
        }}
      >
        Same room, different depth — from a first session to a finished record.
      </p>
      <div
        style={{
          background: "#fff",
          border: "1px solid rgb(var(--border-subtle))",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(17,16,9,.04)",
        }}
      >
        {list.map((p, i) => {
          const m = metaOf(p);
          const flag = p.id === FLAGSHIP_ID;
          return (
            <button
              key={p.id}
              onClick={() => openProduct(p.id)}
              className="sk-row"
              style={{
                all: "unset",
                cursor: "pointer",
                boxSizing: "border-box",
                width: "100%",
                display: "block",
                padding: "15px 16px",
                borderBottom:
                  i === list.length - 1 ? "none" : "1px solid rgb(var(--border-subtle))",
                background: flag ? "rgb(var(--brand-primary) / .06)" : "transparent",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      flexShrink: 0,
                      background: skCover(m.hue),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontFamily: "Syne",
                      fontWeight: 800,
                      fontSize: 13,
                    }}
                  >
                    {GILI.initials}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{
                          fontFamily: "Syne",
                          fontWeight: 700,
                          fontSize: 15,
                          letterSpacing: "-0.02em",
                          color: "rgb(17 16 9)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {p.name}
                      </span>
                      {flag && <Chip tone="amber">Popular</Chip>}
                    </div>
                    <div
                      style={{
                        fontFamily: "JetBrains Mono",
                        fontSize: 10,
                        color: "rgb(var(--fg-muted))",
                        marginTop: 3,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {m.tier.toUpperCase()}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    style={{
                      fontFamily: "Syne",
                      fontWeight: 800,
                      fontSize: 17,
                      letterSpacing: "-0.03em",
                      color: "rgb(17 16 9)",
                    }}
                  >
                    {ils(p.price)}
                  </div>
                  <div
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 9,
                      color: "rgb(var(--fg-muted))",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    from
                  </div>
                </div>
              </div>
              {/* aligned spec columns */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 6,
                  marginTop: 12,
                }}
              >
                {[
                  { k: "Sessions", v: p.sessions > 1 ? `${p.sessions}` : "1" },
                  { k: "Revisions", v: `${p.revisions}` },
                  { k: "Deposit", v: `${p.deposit}%` },
                ].map((col) => (
                  <div
                    key={col.k}
                    style={{
                      background: "rgb(17 16 9 / .03)",
                      borderRadius: 10,
                      padding: "7px 9px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "JetBrains Mono",
                        fontSize: 8.5,
                        color: "rgb(var(--fg-muted))",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      {col.k}
                    </div>
                    <div
                      style={{
                        fontFamily: "Syne",
                        fontWeight: 800,
                        fontSize: 15,
                        color: "rgb(17 16 9)",
                        marginTop: 2,
                      }}
                    >
                      {col.v}
                    </div>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 12,
          fontFamily: "Outfit",
          fontSize: 11.5,
          color: "rgb(var(--fg-muted))",
        }}
      >
        <Ic.spark /> Not sure? The 3-hour session is the easiest way to try Gili's room.
      </div>
    </div>
  );
}

/* ── S2 shell ────────────────────────────────────────────────── */
function S2Store({ loading = false, openProduct, go, variant = "ladder" }) {
  const [playing, setPlaying] = useStore(null);
  const products = PRODUCTS;
  const tabbar = (
    <BottomTabBar
      active="store"
      onNav={(t) => {
        const m = { home: "s6", music: "s13", book: "s11", store: "s2" };
        if (m[t]) go({ screen: m[t] });
      }}
    />
  );
  const tag = variant === "ladder" ? "tiers" : variant === "shelf" ? "shelf" : "compare";

  if (loading) {
    return (
      <Screen footer={tabbar} footerH={92}>
        <div style={{ height: 132, background: "rgb(17 16 9 / .05)" }} className="sk-shimmer" />
        <div style={{ padding: "0 20px", marginTop: -30, display: "flex", gap: 13 }}>
          <Sk w={62} h={62} r={18} />
          <div style={{ paddingTop: 30 }}>
            <Sk w={150} h={20} />
          </div>
        </div>
        <div style={{ padding: "28px 20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          {[0, 1, 2].map((i) => (
            <Sk key={i} h={150} r={20} />
          ))}
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      footer={tabbar}
      footerH={92}
      header={(top) => (
        <StickyNav scrolled={top} title={`${GILI.name} · Store`} start={44} end={104} />
      )}
    >
      <StoreHero tag={tag} />
      {variant === "ladder" && (
        <LadderView
          products={products}
          openProduct={openProduct}
          playing={playing}
          setPlay={setPlaying}
        />
      )}
      {variant === "shelf" && (
        <ShelfView
          products={products}
          openProduct={openProduct}
          playing={playing}
          setPlay={setPlaying}
        />
      )}
      {variant === "compare" && <CompareView products={products} openProduct={openProduct} />}
    </Screen>
  );
}

Object.assign(window, { S2Store });
