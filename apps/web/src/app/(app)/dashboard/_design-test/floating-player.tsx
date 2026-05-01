/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — FloatingPlayer. 1:1 port of the mockup's
// FloatingPlayer (sample-app/index.html lines 939-1013), variant
// `playerStyle="waveform"` only. Reads from the global PlayerContext;
// renders nothing when no track is loaded. Persists across page
// navigation because PlayerProvider lives in dashboard/layout.tsx.

import { useRouter } from "next/navigation";

import { fmtTime } from "./song-time";
import { Icon, Waveform } from "./primitives";
import { usePlayer } from "./player-context";

export function FloatingPlayer() {
  const router = useRouter();
  const { state, toggle, scrub, close } = usePlayer();

  if (state.current === null) return null;
  const track = state.current;
  const sec = track.durationSec * state.progress;

  const onExpand = () => {
    router.push(`/dashboard/music/${track.id}`);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: 248,
        right: 24,
        maxWidth: 820,
        margin: "0 auto",
        zIndex: 40,
        pointerEvents: "auto",
      }}
      className="fade-scale"
      data-testid="dt-floating-player"
    >
      <div
        style={{
          background: "rgb(var(--bg-sidebar))",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          padding: 12,
          display: "flex",
          alignItems: "center",
          gap: 16,
          boxShadow:
            "0 18px 48px rgba(0,0,0,0.42), 0 4px 12px rgba(0,0,0,0.18)",
          backdropFilter: "blur(20px)",
          color: "#fff",
        }}
      >
        <button
          onClick={onExpand}
          style={{
            all: "unset",
            display: "flex",
            alignItems: "center",
            gap: 11,
            minWidth: 200,
            cursor: "pointer",
          }}
          aria-label="Open song page"
        >
          <div
            className={track.grad}
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              position: "relative",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {state.playing && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.32)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                {[0, 0.18, 0.36].map((d, i) => (
                  <span
                    key={i}
                    className="eq-bar"
                    style={{
                      width: 2,
                      background: "#fff",
                      borderRadius: 1,
                      height: "60%",
                      animationDelay: `${String(d)}s`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                textAlign: "left",
              }}
              className="truncate"
            >
              {track.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgb(var(--brand-primary))",
                fontWeight: 600,
                textAlign: "left",
              }}
              className="truncate"
            >
              {track.project}
            </div>
          </div>
        </button>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 5,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 18,
            }}
          >
            <button
              style={{
                all: "unset",
                cursor: "pointer",
                color: "rgba(255,255,255,0.5)",
              }}
              className="sk-pop"
              aria-label="Skip back"
              onClick={() =>
                scrub(Math.max(0, state.progress - 0.05))
              }
            >
              <Icon name="skip-back" size={15} />
            </button>
            <button
              onClick={toggle}
              style={{
                all: "unset",
                cursor: "pointer",
                width: 32,
                height: 32,
                borderRadius: 16,
                background: "#fff",
                color: "#111009",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 14px rgba(255,255,255,0.18)",
              }}
              className="sk-pop"
              aria-label={state.playing ? "Pause" : "Play"}
            >
              <Icon
                name={state.playing ? "pause" : "play"}
                size={14}
                strokeWidth={2.6}
              />
            </button>
            <button
              style={{
                all: "unset",
                cursor: "pointer",
                color: "rgba(255,255,255,0.5)",
              }}
              className="sk-pop"
              aria-label="Skip forward"
              onClick={() =>
                scrub(Math.min(1, state.progress + 0.05))
              }
            >
              <Icon name="skip-forward" size={15} />
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 10,
              fontFamily: "JetBrains Mono",
              color: "rgba(255,255,255,0.42)",
            }}
          >
            <span
              className="tabular"
              style={{ width: 32, textAlign: "right" }}
            >
              {fmtTime(sec)}
            </span>
            <div style={{ flex: 1 }}>
              <Waveform
                bars={56}
                progress={state.progress}
                height={20}
                dark
                onScrub={scrub}
                seed={track.id.charCodeAt(0)}
              />
            </div>
            <span className="tabular" style={{ width: 32 }}>
              {track.duration}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            paddingLeft: 8,
            marginLeft: 4,
            borderLeft: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <button
            onClick={onExpand}
            title="Open song page"
            aria-label="Open song page"
            style={{
              all: "unset",
              cursor: "pointer",
              width: 30,
              height: 30,
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.55)",
            }}
            className="sk-pop"
          >
            <Icon name="maximize-2" size={14} />
          </button>
          <button
            onClick={close}
            title="Close player"
            aria-label="Close player"
            style={{
              all: "unset",
              cursor: "pointer",
              width: 30,
              height: 30,
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.7)",
              background: "rgba(255,255,255,0.06)",
            }}
            className="sk-pop"
          >
            <Icon name="x" size={15} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}
