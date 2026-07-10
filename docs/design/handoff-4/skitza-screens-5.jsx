/* ===================================================================
   Skitza — mobile purchase flow · SECTION 5 SCREENS (Receive)
   S13 Music library — downloads LOCKED · S14 — UNLOCKED
   One component, driven by `state`: locked | overdue | unlocked | downloading
=================================================================== */
const { useState: useS5 } = React;
const SB5 = 60,
  HI5 = 30;

const LIBRARY = {
  project: "Slow Tide",
  hue: 30,
  delivered: "Delivered Jun 4",
  songs: [
    { id: "master", title: "Slow Tide", tag: "Master", len: "3:12", size: "WAV · 38 MB", hue: 30 },
    {
      id: "inst",
      title: "Slow Tide",
      tag: "Instrumental",
      len: "3:12",
      size: "WAV · 36 MB",
      hue: 44,
    },
    {
      id: "stems",
      title: "Slow Tide",
      tag: "Stems · 12 tracks",
      len: "ZIP",
      size: "240 MB",
      hue: 18,
    },
  ],
};

function MusicLibrary({ productId = "g1", state = "locked", go, toast }) {
  const product = productById(productId);
  const unlocked = state === "unlocked" || state === "downloading";
  const overdue = state === "overdue";
  const downloading = state === "downloading";
  const total = product.price;
  const paid = unlocked ? total : Math.round(total / 2);
  const [playing, setPlaying] = useS5(null);

  const tabbar = (
    <BottomTabBar
      active="music"
      onNav={(t) => {
        const m = { home: "s6", music: "s13", book: "s11", store: "s2" };
        if (m[t]) go({ screen: m[t] });
      }}
    />
  );

  return (
    <Screen
      footer={tabbar}
      footerH={92}
      header={(top) => <StickyNav scrolled={top} title={LIBRARY.project} start={150} end={210} />}
    >
      <div style={{ height: SB5 + 14 }} />

      {/* project header */}
      <div style={{ padding: "0 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              flexShrink: 0,
              background: skCover(LIBRARY.hue),
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 8px 22px -8px rgba(17,16,9,.4)",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(120% 80% at 30% 18%, rgba(255,255,255,.32), transparent 60%)",
              }}
            />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow gold style={{ marginBottom: 5 }}>
              My music
            </Eyebrow>
            <h1
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 23,
                letterSpacing: "-0.03em",
                margin: 0,
                color: "rgb(17 16 9)",
                lineHeight: 1.05,
              }}
            >
              {LIBRARY.project}
            </h1>
            <div
              style={{
                fontFamily: "Outfit",
                fontSize: 12.5,
                color: "rgb(var(--fg-muted))",
                marginTop: 3,
              }}
            >
              {GILI.name} · {LIBRARY.delivered}
            </div>
          </div>
        </div>
      </div>

      {/* payment banner */}
      <div style={{ padding: "18px 20px 0" }}>
        {unlocked ? (
          <div
            style={{
              background: "rgb(34 197 94 / .08)",
              border: "1px solid rgb(34 197 94 / .3)",
              borderRadius: 16,
              padding: "15px 16px",
              display: "flex",
              alignItems: "center",
              gap: 13,
            }}
          >
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 999,
                flexShrink: 0,
                background: "rgb(34 197 94)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ic.check />
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "Syne",
                  fontWeight: 700,
                  fontSize: 14.5,
                  color: "rgb(21 110 60)",
                }}
              >
                Paid in full — these are yours
              </div>
              <div
                style={{ fontFamily: "Outfit", fontSize: 12, color: "rgb(40 36 30)", marginTop: 1 }}
              >
                Download anything, anytime.
              </div>
            </div>
            <button
              onClick={() => toast && toast("Downloading all 3 files (prototype)")}
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 14px",
                borderRadius: 999,
                background: "rgb(17 16 9)",
                color: "rgb(var(--brand-primary))",
                fontFamily: "Outfit",
                fontWeight: 700,
                fontSize: 12.5,
                flexShrink: 0,
              }}
            >
              <Ic.calPlus style={{ width: 0, height: 0 }} /> Download all
            </button>
          </div>
        ) : (
          <div
            style={{
              background: "rgb(17 16 9)",
              borderRadius: 18,
              padding: "17px 18px",
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
                  "radial-gradient(120% 90% at 88% 0%, rgb(212 150 10 / .2), transparent 55%)",
              }}
            />
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
                <span style={{ color: "rgb(var(--brand-primary))" }}>
                  <Ic.lock />
                </span>
                <span
                  style={{ fontFamily: "Outfit", fontWeight: 600, fontSize: 13.5, color: "#fff" }}
                >
                  Downloads unlock when you're paid in full
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 7,
                  fontFamily: "JetBrains Mono",
                  fontSize: 11.5,
                  color: "rgba(247,243,236,.8)",
                }}
              >
                <span>
                  <b style={{ color: "#fff" }}>{ils(paid)}</b> of {ils(total)} paid
                </span>
                <span>{Math.round((paid / total) * 100)}%</span>
              </div>
              <div
                style={{
                  height: 7,
                  borderRadius: 999,
                  background: "rgba(247,243,236,.14)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(paid / total) * 100}%`,
                    borderRadius: 999,
                    background:
                      "linear-gradient(90deg, rgb(var(--brand-primary)), rgb(176 104 48))",
                  }}
                />
              </div>
              {overdue && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    marginTop: 12,
                    padding: "10px 12px",
                    background: "rgb(220 38 38 / .16)",
                    borderRadius: 11,
                  }}
                >
                  <span style={{ color: "rgb(248 180 180)", marginTop: 1 }}>
                    <Ic.alert style={{ width: 15, height: 15 }} />
                  </span>
                  <span
                    style={{
                      fontFamily: "Outfit",
                      fontSize: 12,
                      color: "rgb(252 220 220)",
                      lineHeight: 1.45,
                    }}
                  >
                    A payment is overdue — future sessions are paused until it's settled.
                  </span>
                </div>
              )}
              <div style={{ marginTop: 13 }}>
                <button
                  onClick={() => go({ screen: "s8" })}
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    boxSizing: "border-box",
                    width: "100%",
                    textAlign: "center",
                    padding: "13px",
                    borderRadius: 13,
                    background: "rgb(var(--brand-primary))",
                    color: "#1a1407",
                    fontFamily: "Outfit",
                    fontWeight: 700,
                    fontSize: 14.5,
                  }}
                >
                  Complete payment
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* song list */}
      <div style={{ padding: "20px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <Eyebrow>{LIBRARY.songs.length} files · stream anytime</Eyebrow>
          {!unlocked && (
            <Chip tone="plain">
              <Ic.lock /> Download locked
            </Chip>
          )}
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 1px 2px rgba(17,16,9,.04)",
          }}
        >
          {LIBRARY.songs.map((song, i) => {
            const isPlaying = playing === song.id;
            const isDownloading = downloading && song.id === "master";
            return (
              <div
                key={song.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "13px 15px",
                  borderBottom:
                    i === LIBRARY.songs.length - 1 ? "none" : "1px solid rgb(var(--border-subtle))",
                }}
              >
                {/* play / stream */}
                <button
                  onClick={() => setPlaying(isPlaying ? null : song.id)}
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    width: 44,
                    height: 44,
                    borderRadius: 11,
                    flexShrink: 0,
                    background: skSwatch(song.hue),
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    boxShadow: "0 4px 12px -5px rgba(17,16,9,.3)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: isPlaying ? "rgba(17,16,9,.34)" : "rgba(17,16,9,.14)",
                    }}
                  />
                  <span style={{ position: "relative" }}>
                    {isPlaying ? <Ic.pause /> : <Ic.play />}
                  </span>
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      style={{
                        fontFamily: "Syne",
                        fontWeight: 700,
                        fontSize: 15,
                        letterSpacing: "-0.02em",
                        color: "rgb(17 16 9)",
                      }}
                    >
                      {song.title}
                    </span>
                    {isPlaying && (
                      <span className="eq" style={{ color: "rgb(var(--brand-primary))" }}>
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 10.5,
                      color: "rgb(var(--fg-muted))",
                      marginTop: 2,
                    }}
                  >
                    {song.tag} · {song.size}
                  </div>
                </div>
                {/* download / lock / progress */}
                {isDownloading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span
                      style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: "rgb(140 95 6)" }}
                    >
                      62%
                    </span>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 999,
                        border: "2px solid rgb(var(--brand-primary) / .2)",
                        borderTopColor: "rgb(var(--brand-primary))",
                        display: "inline-block",
                      }}
                      className="sk-spin"
                    />
                  </div>
                ) : unlocked ? (
                  <button
                    onClick={() => toast && toast(`Downloading ${song.tag} (prototype)`)}
                    className="sk-pop"
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      width: 38,
                      height: 38,
                      borderRadius: 999,
                      flexShrink: 0,
                      background: "rgb(var(--brand-primary) / .14)",
                      color: "rgb(140 95 6)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path
                        d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : (
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 999,
                      flexShrink: 0,
                      background: "rgb(17 16 9 / .04)",
                      color: "rgb(var(--fg-muted) / .7)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ic.lock />
                  </span>
                )}
              </div>
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
          <Ic.spark />{" "}
          {unlocked
            ? "Yours to keep — downloaded files never expire."
            : "You can stream everything now. Downloading needs full payment."}
        </div>
      </div>
    </Screen>
  );
}

Object.assign(window, { MusicLibrary });
