/* ===================================================================
   Skitza — mobile purchase flow · SECTION 1 SCREENS
   S1 Invite landing · S2 Store browse · S3 Product detail
=================================================================== */
const { useState: useS, useEffect: useE, useRef: useR } = React;

const SB = 60; /* status-bar safe area */
const HI = 30; /* home-indicator safe area */
const CREAM = "rgb(247 243 236)";

/* shared scroll shell with a pinned footer + optional collapsing header.
   `header` is a render fn that receives live scrollTop (px). */
function Screen({ children, footer, footerH = 0, bg = CREAM, header }) {
  const ref = useR(null);
  const [top, setTop] = useS(0);
  useE(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div style={{ position: "relative", height: "100%", background: bg, overflow: "hidden" }}>
      <div
        ref={ref}
        className="screen-scroll no-scroll"
        style={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          overflowX: "hidden",
          paddingBottom: footer ? footerH : HI + 8,
        }}
      >
        <div className="sk-screen-enter">{children}</div>
      </div>
      {header && header(top)}
      {footer}
    </div>
  );
}

/* ====================================================================
   S1 — INVITE LANDING  /join/gili-studio
==================================================================== */
function S1Invite({ variant = "cover", loading = false, go }) {
  const [playing, setPlaying] = useS(null);
  const toggle = (id) => setPlaying((p) => (p === id ? null : id));

  const footer = (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        padding: `14px 18px ${HI + 10}px`,
        background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.94) 26%)",
      }}
    >
      <PrimaryCTA onClick={() => go("store")} sub="Private invite · only you can see this">
        Book a session <Ic.arrowR />
      </PrimaryCTA>
    </div>
  );

  const thresh = { editorial: [196, 262], cover: [300, 372], minimal: [176, 238] }[variant] || [
    200, 270,
  ];
  const header = (top) => (
    <StickyNav
      scrolled={top}
      title={GILI.name}
      sub="PRIVATE INVITE"
      onBack={() => {}}
      backIcon="close"
      action={{ icon: <Ic.share /> }}
      start={thresh[0]}
      end={thresh[1]}
    />
  );

  if (loading)
    return (
      <Screen footer={footer} footerH={150} header={header}>
        <S1Skeleton variant={variant} />
      </Screen>
    );

  const Tracks = (
    <div style={{ padding: "4px 20px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <Eyebrow gold>
          <span style={{ width: 18, height: 1, background: "currentColor" }} />
          Listen first
        </Eyebrow>
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 10,
            color: "rgb(var(--fg-muted))",
            letterSpacing: "0.08em",
          }}
        >
          {TRACKS.length} tracks
        </span>
      </div>
      <div>
        {TRACKS.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            idx={i}
            playing={playing === t.id}
            onToggle={() => toggle(t.id)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <Screen footer={footer} footerH={150} header={header}>
      {variant === "cover" && <S1HeroCover />}
      {variant === "editorial" && <S1HeroEditorial />}
      {variant === "minimal" && <S1HeroMinimal />}
      {Tracks}
      <div style={{ padding: "20px 20px 8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 14,
          }}
        >
          <span style={{ color: "rgb(var(--brand-primary))" }}>
            <Ic.spark />
          </span>
          <span
            style={{
              fontFamily: "Outfit",
              fontSize: 12.5,
              color: "rgb(var(--fg-muted))",
              lineHeight: 1.5,
            }}
          >
            Hand-picked invite. Book a session and Gili reviews your request personally — usually
            within a day.
          </span>
        </div>
      </div>
    </Screen>
  );
}

/* S1 hero — variant A: cover photo + overlapping logo, identity on the sheet */
function S1HeroCover() {
  return (
    <div>
      <div
        style={{
          height: 326,
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
              "linear-gradient(180deg, rgba(255,255,255,.18) 0%, transparent 22%, rgba(17,16,9,.06) 60%, rgba(247,243,236,1) 100%)",
          }}
        />
        <div style={{ position: "absolute", left: 22, bottom: 38, color: "#fff" }}>
          <div
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 9.5,
              letterSpacing: "0.16em",
              opacity: 0.82,
            }}
          >
            PRIVATE INVITE · STUDIO Nº {GILI.id.toUpperCase()}
          </div>
        </div>
      </div>
      <div style={{ padding: "0 20px", marginTop: -42, position: "relative", zIndex: 2 }}>
        <Avatar p={GILI} size={84} square ring />
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <h1
            style={{
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: "-0.035em",
              margin: 0,
              color: "rgb(17 16 9)",
              lineHeight: 1,
            }}
          >
            {GILI.name}
          </h1>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "JetBrains Mono",
              fontSize: 12,
              color: "rgb(140 95 6)",
              fontWeight: 600,
            }}
          >
            <Ic.star style={{ color: "rgb(var(--brand-primary))" }} />
            {GILI.rating}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 7,
            fontFamily: "Outfit",
            fontSize: 13,
            color: "rgb(var(--fg-muted))",
            flexWrap: "nowrap",
            whiteSpace: "nowrap",
          }}
        >
          <span>{GILI.tagline}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
          >
            <Ic.pin />
            {GILI.city}
          </span>
        </div>
        <p
          style={{
            fontFamily: "Outfit",
            fontSize: 14.5,
            color: "rgb(61 55 48)",
            lineHeight: 1.55,
            margin: "14px 0 4px",
            textWrap: "pretty",
          }}
        >
          {GILI.bio}
        </p>
      </div>
    </div>
  );
}

/* S1 hero — variant B: editorial, name over the cover */
function S1HeroEditorial() {
  return (
    <div>
      <div
        style={{
          height: 300,
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
              "linear-gradient(180deg, rgba(17,16,9,.32) 0%, transparent 34%, rgba(17,16,9,.58) 100%)",
          }}
        />
        <div style={{ position: "absolute", left: 22, right: 22, bottom: 22, color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
            <Avatar p={GILI} size={44} square />
            <span
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 9.5,
                letterSpacing: "0.18em",
                color: "rgba(255,255,255,.86)",
                textTransform: "uppercase",
              }}
            >
              Private invite · Nº {GILI.id.toUpperCase()}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              fontFamily: "JetBrains Mono",
              fontSize: 11,
              color: "rgba(255,255,255,.86)",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Ic.star style={{ color: "rgb(var(--brand-primary))" }} />
              {GILI.rating}
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{GILI.reviews} reviews</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Ic.pin />
              {GILI.city}
            </span>
          </div>
          <h1
            style={{
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 38,
              letterSpacing: "-0.04em",
              margin: 0,
              lineHeight: 0.94,
            }}
          >
            {GILI.name}
          </h1>
        </div>
      </div>
      <div style={{ padding: "18px 20px 4px" }}>
        <p
          style={{
            fontFamily: "Outfit",
            fontSize: 15,
            color: "rgb(61 55 48)",
            lineHeight: 1.55,
            margin: 0,
            textWrap: "pretty",
          }}
        >
          {GILI.bio}
        </p>
      </div>
    </div>
  );
}

/* S1 hero — variant C: minimal, centered, quiet record-shop */
function S1HeroMinimal() {
  return (
    <div>
      <div
        style={{
          height: 168,
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
              "linear-gradient(180deg, rgba(255,255,255,.16), transparent 50%, rgba(247,243,236,1) 100%)",
          }}
        />
      </div>
      <div
        style={{
          padding: "0 26px",
          marginTop: -46,
          position: "relative",
          zIndex: 2,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Avatar p={GILI} size={92} ring />
        <h1
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 28,
            letterSpacing: "-0.035em",
            margin: "16px 0 0",
            color: "rgb(17 16 9)",
          }}
        >
          {GILI.name}
        </h1>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            fontFamily: "JetBrains Mono",
            fontSize: 11.5,
            color: "rgb(var(--fg-muted))",
          }}
        >
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "rgb(140 95 6)" }}
          >
            <Ic.star style={{ color: "rgb(var(--brand-primary))" }} />
            {GILI.rating}
          </span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{GILI.tagline}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Ic.pin />
            {GILI.city}
          </span>
        </div>
        <p
          style={{
            fontFamily: "Outfit",
            fontSize: 14.5,
            color: "rgb(61 55 48)",
            lineHeight: 1.55,
            margin: "14px 8px 4px",
            textWrap: "pretty",
          }}
        >
          {GILI.bio}
        </p>
      </div>
    </div>
  );
}

function S1Skeleton({ variant }) {
  return (
    <div>
      <div
        style={{ height: variant === "minimal" ? 168 : 310, background: "rgb(17 16 9 / .05)" }}
        className="sk-shimmer"
      />
      <div style={{ padding: "0 20px", marginTop: -42 }}>
        <Sk w={84} h={84} r={24} />
        <div style={{ marginTop: 16 }}>
          <Sk w={180} h={26} r={8} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Sk w={220} h={13} />
        </div>
        <div style={{ marginTop: 10 }}>
          <Sk w="90%" h={13} />
        </div>
      </div>
      <div style={{ padding: "26px 20px 0", display: "flex", flexDirection: "column", gap: 18 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Sk w={46} h={46} r={12} />
            <div style={{ flex: 1 }}>
              <Sk w="55%" h={14} />
              <div style={{ marginTop: 8 }}>
                <Sk w="35%" h={11} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ====================================================================
   S2 — STORE BROWSE  (standing screen · bottom tab bar)
==================================================================== */
function S2Store({ loading = false, openProduct, go }) {
  const flagship = productById(FLAGSHIP_ID);
  const rest = PRODUCTS.filter((p) => p.id !== FLAGSHIP_ID);

  const tabbar = (
    <BottomTabBar
      active="store"
      onNav={(t) => {
        const m = { home: "s6", music: "s13", book: "s11", store: "s2" };
        if (m[t]) go({ screen: m[t] });
      }}
    />
  );
  const header = (top) => (
    <StickyNav
      scrolled={top}
      title={GILI.name}
      sub="STORE"
      onBack={() => go({ screen: "s1" })}
      backIcon="chev"
      action={{ icon: <Ic.share /> }}
      start={44}
      end={104}
    />
  );

  if (loading)
    return (
      <Screen footer={tabbar} footerH={92} header={header}>
        <S2Skeleton />
      </Screen>
    );

  return (
    <Screen footer={tabbar} footerH={92} header={header}>
      {/* Producer hero band */}
      <div
        style={{
          height: 150,
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
      </div>
      <div style={{ padding: "0 20px", marginTop: -34, position: "relative", zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 13 }}>
          <Avatar p={GILI} size={64} square ring />
          <div style={{ paddingBottom: 2 }}>
            <h1
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 23,
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
                marginTop: 4,
                fontFamily: "JetBrains Mono",
                fontSize: 11,
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
              <span>{PRODUCTS.length} listings</span>
            </div>
          </div>
        </div>
      </div>

      {/* Focal / flagship product */}
      <div style={{ padding: "20px 20px 6px" }}>
        <Eyebrow gold style={{ marginBottom: 10 }}>
          <span style={{ width: 18, height: 1, background: "currentColor" }} />
          Signature offer
        </Eyebrow>
        <FocalCard product={flagship} onOpen={() => openProduct(flagship.id)} />
      </div>

      {/* Also from */}
      <div style={{ padding: "14px 20px 8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <Eyebrow>Also from {GILI.name}</Eyebrow>
          <span
            style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "rgb(var(--fg-muted))" }}
          >
            {rest.length}
          </span>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 18,
            overflow: "hidden",
          }}
        >
          {rest.map((p, i) => (
            <ProductRow
              key={p.id}
              product={p}
              last={i === rest.length - 1}
              onOpen={() => openProduct(p.id)}
            />
          ))}
        </div>
      </div>
    </Screen>
  );
}

function FocalCard({ product, onOpen }) {
  return (
    <button
      onClick={onOpen}
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
        boxShadow: "0 1px 2px rgba(17,16,9,.04), 0 18px 40px -22px rgba(17,16,9,.22)",
      }}
    >
      <div
        style={{
          height: 130,
          background: skCover(product.id === "g1" ? 44 : GILI.hue),
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(120% 90% at 26% 16%, rgba(255,255,255,.26), transparent 58%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 14,
            fontFamily: "JetBrains Mono",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.16em",
            color: "rgba(255,255,255,.82)",
          }}
        >
          {product.sku}
        </div>
        {product.badge && (
          <span style={{ position: "absolute", top: 11, right: 12 }}>
            <Chip tone="dark">{product.badge}</Chip>
          </span>
        )}
        <div
          style={{
            position: "absolute",
            left: 14,
            bottom: 12,
            color: "#fff",
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: "-0.035em",
          }}
        >
          {GILI.initials}
        </div>
      </div>
      <div style={{ padding: "17px 18px 18px" }}>
        <div
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 21,
            letterSpacing: "-0.03em",
            color: "rgb(17 16 9)",
            lineHeight: 1.1,
          }}
        >
          {product.name}
        </div>
        <div
          style={{
            fontFamily: "Outfit",
            fontSize: 13,
            color: "rgb(var(--fg-muted))",
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          {product.tagline}
        </div>
        <div style={{ display: "flex", gap: 7, marginTop: 13, flexWrap: "wrap" }}>
          <Chip>
            <Ic.clock />
            {product.duration}
          </Chip>
          <Chip>
            <Ic.shield />
            {product.deposit}% deposit
          </Chip>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 16,
            paddingTop: 15,
            borderTop: "1px dashed rgb(var(--border-subtle))",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 9.5,
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
                fontSize: 28,
                letterSpacing: "-0.035em",
                color: "rgb(17 16 9)",
                lineHeight: 1,
              }}
            >
              {ils(product.price)}
            </div>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "11px 18px",
              borderRadius: 999,
              background: "rgb(17 16 9)",
              color: "rgb(var(--brand-primary))",
              fontFamily: "Outfit",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            View <Ic.chevR />
          </span>
        </div>
      </div>
    </button>
  );
}

function ProductRow({ product, last, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="sk-row"
      style={{
        all: "unset",
        cursor: "pointer",
        boxSizing: "border-box",
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderBottom: last ? "none" : "1px solid rgb(var(--border-subtle))",
      }}
    >
      <span
        style={{
          width: 50,
          height: 50,
          borderRadius: 13,
          flexShrink: 0,
          background: skSwatch(GILI.hue),
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontFamily: "Syne",
          fontWeight: 800,
          fontSize: 15,
          boxShadow: "0 4px 12px -5px rgba(17,16,9,.3)",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(120% 80% at 30% 18%, rgba(255,255,255,.3), transparent 60%)",
          }}
        />
        <span style={{ position: "relative" }}>{GILI.initials}</span>
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
          {product.name}
        </div>
        <div
          style={{
            fontFamily: "Outfit",
            fontSize: 12,
            color: "rgb(var(--fg-muted))",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {product.tagline}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: "-0.03em",
            color: "rgb(17 16 9)",
          }}
        >
          {ils(product.price)}
        </div>
        {product.badge && (
          <div style={{ marginTop: 3 }}>
            <span
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 9,
                color: "rgb(140 95 6)",
                fontWeight: 600,
              }}
            >
              {product.badge}
            </span>
          </div>
        )}
      </div>
      <span style={{ color: "rgb(var(--fg-muted) / .6)", flexShrink: 0 }}>
        <Ic.chevR />
      </span>
    </button>
  );
}

function S2Skeleton() {
  return (
    <div>
      <div style={{ height: 150, background: "rgb(17 16 9 / .05)" }} className="sk-shimmer" />
      <div
        style={{
          padding: "0 20px",
          marginTop: -34,
          display: "flex",
          gap: 13,
          alignItems: "flex-end",
        }}
      >
        <Sk w={64} h={64} r={20} />
        <div style={{ paddingBottom: 4 }}>
          <Sk w={150} h={22} />
          <div style={{ marginTop: 8 }}>
            <Sk w={100} h={12} />
          </div>
        </div>
      </div>
      <div style={{ padding: "24px 20px 0" }}>
        <Sk w={120} h={11} />
        <div style={{ marginTop: 12, borderRadius: 20, overflow: "hidden" }}>
          <Sk w="100%" h={130} r={0} />
          <div
            style={{
              padding: 18,
              background: "#fff",
              border: "1px solid rgb(var(--border-subtle))",
              borderTop: "none",
              borderRadius: "0 0 20px 20px",
            }}
          >
            <Sk w="70%" h={20} />
            <div style={{ marginTop: 10 }}>
              <Sk w="90%" h={12} />
            </div>
            <div style={{ marginTop: 18 }}>
              <Sk w={110} h={28} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================
   S3 — PRODUCT DETAIL + REQUEST TO BOOK  (funnel · back arrow)
==================================================================== */
function S3Detail({ productId = "g1", variant = "inline", pending = false, back, requestBook }) {
  const product = productById(productId);

  const footer = (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        padding: `14px 18px ${HI + 10}px`,
        background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.95) 24%)",
      }}
    >
      {pending ? (
        <>
          <PrimaryCTA disabled>Request to book</PrimaryCTA>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              marginTop: 10,
              fontFamily: "Outfit",
              fontSize: 12.5,
              color: "rgb(140 95 6)",
            }}
          >
            <Ic.clock /> You have a request in review — finish that first.
          </div>
        </>
      ) : (
        <PrimaryCTA onClick={requestBook} sub="Price locks now · no payment yet">
          Request to book <Ic.arrowR />
        </PrimaryCTA>
      )}
    </div>
  );

  const header = (top) => (
    <StickyNav
      scrolled={top}
      title={product.name}
      sub={product.sku}
      onBack={back}
      backIcon="chev"
      action={{ icon: <Ic.heart /> }}
    />
  );

  return (
    <Screen footer={footer} footerH={pending ? 150 : 138} header={header}>
      {/* slim cover */}
      <div
        style={{
          height: 138,
          background: skCover(product.id === "g1" ? 44 : GILI.hue),
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(17,16,9,.18), transparent 50%, rgba(247,243,236,1) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 18,
            bottom: 12,
            fontFamily: "JetBrains Mono",
            fontSize: 9.5,
            letterSpacing: "0.16em",
            color: "rgba(255,255,255,.8)",
          }}
        >
          {product.sku} · {GILI.name.toUpperCase()}
        </div>
      </div>

      {pending && (
        <div
          style={{
            margin: "14px 20px 0",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 14px",
            background: "rgb(var(--brand-primary) / .1)",
            border: "1px solid rgb(var(--brand-primary) / .26)",
            borderRadius: 14,
          }}
        >
          <span style={{ color: "rgb(140 95 6)", marginTop: 1 }}>
            <Ic.clock />
          </span>
          <span
            style={{
              fontFamily: "Outfit",
              fontSize: 12.5,
              color: "rgb(120 82 6)",
              lineHeight: 1.5,
            }}
          >
            A request is already in review with Gili. You can pick this up once that one’s settled.
          </span>
        </div>
      )}

      {/* price / title block — varies */}
      <div style={{ padding: "18px 20px 0" }}>
        {variant === "inline" && <S3HeadInline product={product} />}
        {variant === "ticket" && <S3HeadTicket product={product} />}
        {variant === "hero" && <S3HeadHero product={product} />}
      </div>

      {/* producer mini row */}
      <div style={{ padding: "18px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 14,
          }}
        >
          <Avatar p={GILI} size={40} square />
          <div style={{ flex: 1 }}>
            <div
              style={{ fontFamily: "Outfit", fontWeight: 600, fontSize: 14, color: "rgb(17 16 9)" }}
            >
              {GILI.name}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 2,
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
              <span>{GILI.reviews} reviews</span>
            </div>
          </div>
          <span
            style={{
              fontFamily: "Outfit",
              fontSize: 12.5,
              fontWeight: 600,
              color: "rgb(140 95 6)",
            }}
          >
            Store
          </span>
        </div>
      </div>

      {/* what's included */}
      <div style={{ padding: "20px 20px 0" }}>
        <Eyebrow style={{ marginBottom: 12 }}>What’s included</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {product.includes.map((line, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: "rgb(var(--brand-primary) / .14)",
                  color: "rgb(140 95 6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                }}
              >
                <Ic.check />
              </span>
              <span
                style={{
                  fontFamily: "Outfit",
                  fontSize: 14,
                  color: "rgb(40 36 30)",
                  lineHeight: 1.5,
                }}
              >
                {line}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 18,
            marginTop: 16,
            flexWrap: "wrap",
            fontFamily: "Outfit",
            fontSize: 12.5,
            color: "rgb(var(--fg-muted))",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Ic.clock />
            {product.duration}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Ic.refresh />
            {product.revisions} revisions
          </span>
        </div>
      </div>

      {/* payment plan hint */}
      <div style={{ padding: "20px 20px 0" }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 16,
            padding: "16px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Eyebrow>
              <Ic.layers />
              Payment
            </Eyebrow>
            <Chip tone="plain">Set after approval</Chip>
          </div>
          <div
            style={{
              fontFamily: "Outfit",
              fontSize: 13.5,
              color: "rgb(40 36 30)",
              lineHeight: 1.5,
              marginTop: 10,
            }}
          >
            Pay in <b style={{ fontWeight: 700 }}>full</b>, or on a{" "}
            <b style={{ fontWeight: 700 }}>plan</b> — Gili sets which options this offer allows once
            they approve your request.
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
            <Chip>Full · {ils(product.price)}</Chip>
            {product.planHint.includes("50") && <Chip>50–50 · {ils(product.price / 2)} now</Chip>}
            {product.planHint === "Milestones" && <Chip>Milestones</Chip>}
          </div>
        </div>
      </div>

      {/* price-lock note */}
      <div style={{ padding: "14px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            padding: "13px 15px",
            background: "rgb(17 16 9)",
            borderRadius: 16,
            color: "rgb(247 243 236)",
          }}
        >
          <span style={{ color: "rgb(var(--brand-primary))", marginTop: 1 }}>
            <Ic.lock />
          </span>
          <span style={{ fontFamily: "Outfit", fontSize: 12.5, lineHeight: 1.55 }}>
            Your price locks now — <b style={{ color: "#fff" }}>{ils(product.price)}</b> stays fixed
            once you request. No money moves yet; this just sends a request to Gili.
          </span>
        </div>
      </div>
    </Screen>
  );
}

/* S3 head — variant A: title + price inline */
function S3HeadInline({ product }) {
  return (
    <div>
      {product.badge && (
        <div style={{ marginBottom: 10 }}>
          <Chip tone="amber">{product.badge}</Chip>
        </div>
      )}
      <h1
        style={{
          fontFamily: "Syne",
          fontWeight: 800,
          fontSize: 27,
          letterSpacing: "-0.035em",
          margin: 0,
          color: "rgb(17 16 9)",
          lineHeight: 1.08,
          textWrap: "pretty",
        }}
      >
        {product.name}
      </h1>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
        <span
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: "-0.035em",
            color: "rgb(17 16 9)",
          }}
        >
          {ils(product.price)}
        </span>
        <span style={{ fontFamily: "Outfit", fontSize: 13, color: "rgb(var(--fg-muted))" }}>
          {product.sessions > 1 ? `${product.sessions} sessions` : "one project"}
        </span>
      </div>
      <p
        style={{
          fontFamily: "Outfit",
          fontSize: 14.5,
          color: "rgb(61 55 48)",
          lineHeight: 1.55,
          margin: "12px 0 0",
          textWrap: "pretty",
        }}
      >
        {product.tagline}
      </p>
    </div>
  );
}

/* S3 head — variant B: receipt-ticket price band */
function S3HeadTicket({ product }) {
  return (
    <div>
      {product.badge && (
        <div style={{ marginBottom: 10 }}>
          <Chip tone="amber">{product.badge}</Chip>
        </div>
      )}
      <h1
        style={{
          fontFamily: "Syne",
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: "-0.035em",
          margin: 0,
          color: "rgb(17 16 9)",
          lineHeight: 1.1,
          textWrap: "pretty",
        }}
      >
        {product.name}
      </h1>
      <p
        style={{
          fontFamily: "Outfit",
          fontSize: 14,
          color: "rgb(61 55 48)",
          lineHeight: 1.5,
          margin: "10px 0 0",
        }}
      >
        {product.tagline}
      </p>
      <div
        style={{
          marginTop: 16,
          background: "#fff",
          border: "1px solid rgb(var(--border-subtle))",
          borderRadius: 16,
          padding: "16px 18px",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 10px 28px -18px rgba(17,16,9,.25)",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 9.5,
              color: "rgb(var(--fg-muted))",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Ic.lock />
            Locks at request
          </div>
          <div
            style={{
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 36,
              letterSpacing: "-0.04em",
              color: "rgb(17 16 9)",
              lineHeight: 1,
              marginTop: 6,
            }}
          >
            {ils(product.price)}
          </div>
        </div>
        <div
          style={{
            textAlign: "right",
            fontFamily: "JetBrains Mono",
            fontSize: 10,
            color: "rgb(var(--fg-muted))",
            lineHeight: 1.7,
          }}
        >
          <div>{product.sessions > 1 ? `${product.sessions} sessions` : "1 project"}</div>
          <div>{product.deposit}% deposit</div>
        </div>
      </div>
    </div>
  );
}

/* S3 head — variant C: giant price hero */
function S3HeadHero({ product }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "JetBrains Mono",
          fontSize: 10,
          color: "rgb(var(--fg-muted))",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
        }}
      >
        {product.name}
      </div>
      <div
        style={{
          fontFamily: "Syne",
          fontWeight: 800,
          fontSize: 60,
          letterSpacing: "-0.045em",
          color: "rgb(17 16 9)",
          lineHeight: 0.92,
          marginTop: 8,
        }}
      >
        {ils(product.price)}
      </div>
      <div style={{ display: "flex", gap: 7, marginTop: 14, flexWrap: "wrap" }}>
        {product.badge && <Chip tone="amber">{product.badge}</Chip>}
        <Chip>{product.sessions > 1 ? `${product.sessions} sessions` : "1 project"}</Chip>
        <Chip>
          <Ic.lock />
          Locks at request
        </Chip>
      </div>
      <p
        style={{
          fontFamily: "Outfit",
          fontSize: 14.5,
          color: "rgb(61 55 48)",
          lineHeight: 1.55,
          margin: "14px 0 0",
          textWrap: "pretty",
        }}
      >
        {product.tagline}
      </p>
    </div>
  );
}

Object.assign(window, { S1Invite, S2Store, S3Detail });
