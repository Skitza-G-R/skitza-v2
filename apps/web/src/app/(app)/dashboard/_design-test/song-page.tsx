/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Song Page (desktop variant). 1:1 port of the
// mockup's SongPage (sample-app/index.html lines 2653-2840).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { BackButton, Breadcrumbs } from "./nav-chrome";
import { useIsTrackPlaying, usePlayer } from "./player-context";
import {
  Avatar,
  Card,
  Icon,
  Waveform,
  type WaveformCommentMarker,
} from "./primitives";
import { fmtTime, secFromProgress } from "./song-time";
import type { VisibleComment } from "./song-comments";

export type SongPageData = {
  track: {
    id: string;
    trackId: string;
    projectId: string;
    title: string;
    project: string;
    client: string;
    duration: string;
    durationSec: number;
    uploaded: string;
    grad: string;
    versions: string[];
    activeVersion: string;
  };
  comments: VisibleComment[];
};

export function SongPage({ data }: { data: SongPageData }) {
  const t = data.track;
  const router = useRouter();
  const { state, play, toggle, scrub } = usePlayer();
  const isPlaying = useIsTrackPlaying(t.id);
  const progress =
    state.current !== null && state.current.id === t.id ? state.progress : 0;

  const [activeVersion, setActiveVersion] = useState(t.activeVersion);
  const [draft, setDraft] = useState("");
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [fav, setFav] = useState(false);

  const allComments = data.comments;
  const visibleComments = showResolved
    ? allComments
    : allComments.filter((c) => !resolved[c.id]);

  const sec = secFromProgress(progress, t.durationSec);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target;
      if (tgt instanceof HTMLElement) {
        const tag = tgt.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (state.current?.id === t.id) {
          toggle();
        } else {
          play({
            id: t.id,
            title: t.title,
            project: t.project,
            duration: t.duration,
            durationSec: t.durationSec,
            grad: t.grad,
          });
        }
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        scrub(Math.min(1, progress + 0.05));
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        scrub(Math.max(0, progress - 0.05));
      } else if (e.code === "KeyL") {
        setFav((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [progress, t, play, toggle, scrub, state.current?.id]);

  const onPlayHero = () => {
    if (state.current?.id === t.id) {
      toggle();
    } else {
      play({
        id: t.id,
        title: t.title,
        project: t.project,
        duration: t.duration,
        durationSec: t.durationSec,
        grad: t.grad,
      });
    }
  };

  const waveformMarkers: WaveformCommentMarker[] = visibleComments.map((c) => ({
    id: c.id,
    at: c.at,
    onClick: () => {
      scrub(c.at / Math.max(1, t.durationSec));
    },
  }));

  return (
    <div
      data-screen-label={`Song — ${t.title}`}
      className="custom-scrollbar"
      style={{ flex: 1, overflowY: "auto" }}
    >
      <div
        className={t.grad}
        style={{
          position: "relative",
          color: "#fff",
          padding: "clamp(20px, 3vw, 32px) clamp(16px, 3vw, 32px) 24px",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <BackButton onClick={() => router.push("/dashboard/music")} label="Back" />
              <Breadcrumbs
                items={[
                  {
                    label: "Music Library",
                    onClick: () => router.push("/dashboard/music"),
                  },
                  { label: t.title, current: true },
                ]}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                width: 110,
                height: 110,
                borderRadius: 14,
                background: "rgba(0,0,0,0.18)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
                position: "relative",
              }}
            >
              <Icon name="audio-waveform" size={42} strokeWidth={1.5} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  opacity: 0.78,
                }}
              >
                Song · {t.project}
              </span>
              <h1
                className="font-syne"
                style={{
                  fontSize: "clamp(28px, 4vw, 48px)",
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  margin: "4px 0 8px",
                  lineHeight: 1,
                  textShadow: "0 2px 14px rgba(0,0,0,0.18)",
                }}
              >
                {t.title}
              </h1>
              <div
                style={{
                  fontSize: 13,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  alignItems: "center",
                  opacity: 0.92,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Icon name="user" size={12} />
                  {t.client}
                </span>
                <span>·</span>
                <span className="tabular" style={{ fontFamily: "JetBrains Mono" }}>
                  {t.duration}
                </span>
                <span>·</span>
                <span>uploaded {t.uploaded}</span>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 14,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    opacity: 0.72,
                    marginRight: 4,
                  }}
                >
                  Version
                </span>
                {t.versions.map((v) => (
                  <button
                    key={v}
                    onClick={() => setActiveVersion(v)}
                    className="sk-pop"
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      padding: "4px 10px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      fontFamily: "JetBrains Mono",
                      borderRadius: 12,
                      background:
                        activeVersion === v ? "#fff" : "rgba(255,255,255,0.14)",
                      color: activeVersion === v ? "#111009" : "#fff",
                      border:
                        "1px solid " +
                        (activeVersion === v ? "#fff" : "rgba(255,255,255,0.22)"),
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 6,
                flexShrink: 0,
                alignItems: "center",
              }}
            >
              <button
                onClick={onPlayHero}
                className="sk-pop"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "11px 18px",
                  borderRadius: 24,
                  background: "#fff",
                  color: "#111009",
                  fontSize: 13,
                  fontWeight: 800,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  boxShadow: "0 6px 18px rgba(0,0,0,0.24)",
                }}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                <Icon
                  name={isPlaying ? "pause" : "play"}
                  size={14}
                  strokeWidth={2.6}
                />{" "}
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button
                onClick={() => setFav((f) => !f)}
                className="sk-pop"
                title={fav ? "In Favorites" : "Add to Favorites"}
                aria-label={fav ? "Unfavorite" : "Favorite"}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  background: fav ? "#fff" : "rgba(255,255,255,0.14)",
                  color: fav ? "rgb(var(--brand-primary-dark))" : "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid " + (fav ? "#fff" : "rgba(255,255,255,0.22)"),
                }}
              >
                <Icon name="star" size={15} strokeWidth={2.4} />
              </button>
              <button
                title="Share with artist"
                aria-label="Share"
                className="sk-pop"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(255,255,255,0.22)",
                }}
              >
                <Icon name="share-2" size={15} />
              </button>
              <button
                title="Download"
                aria-label="Download"
                className="sk-pop"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(255,255,255,0.22)",
                }}
              >
                <Icon name="download" size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(16px, 3vw, 28px)" }}>
        <Card padded={false} className="reveal-up stagger-2">
          <div
            style={{
              padding: "20px 22px 18px",
              background: "rgb(var(--bg-elevated) / 0.6)",
            }}
          >
            <div style={{ paddingTop: 8 }}>
              <Waveform
                bars={96}
                progress={progress}
                height={88}
                comments={waveformMarkers}
                durationSec={t.durationSec}
                onScrub={scrub}
                seed={t.id.charCodeAt(0)}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 10,
                fontSize: 11,
                fontFamily: "JetBrains Mono",
                color: "rgb(var(--fg-muted))",
                alignItems: "center",
              }}
            >
              <span className="tabular">{fmtTime(sec)}</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={() => scrub(Math.max(0, progress - 0.05))}
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    color: "rgb(var(--fg-muted))",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Skip back 5%"
                  aria-label="Skip back 5%"
                >
                  <Icon name="chevron-left" size={14} />
                </button>
                <button
                  onClick={onPlayHero}
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: "rgb(var(--fg-default))",
                    color: "rgb(var(--bg-default))",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  <Icon
                    name={isPlaying ? "pause" : "play"}
                    size={15}
                    strokeWidth={2.6}
                  />
                </button>
                <button
                  onClick={() => scrub(Math.min(1, progress + 0.05))}
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    color: "rgb(var(--fg-muted))",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Skip ahead 5%"
                  aria-label="Skip ahead 5%"
                >
                  <Icon name="chevron-right" size={14} />
                </button>
              </div>
              <span className="tabular">{t.duration}</span>
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 10,
                color: "rgb(var(--fg-faint))",
                textAlign: "center",
                fontFamily: "JetBrains Mono",
                letterSpacing: "0.05em",
              }}
            >
              SPACE play/pause · ←/→ skip · L favorite
            </div>
          </div>
        </Card>

        <div className="reveal-up stagger-3" style={{ marginTop: 18 }}>
          <Card
            title={`Notes at timestamp · ${String(visibleComments.length)}${
              allComments.length !== visibleComments.length
                ? ` of ${String(allComments.length)}`
                : ""
            }`}
            icon={<Icon name="message-circle" size={14} />}
            action={
              allComments.some((c) => resolved[c.id]) ? (
                <button
                  onClick={() => setShowResolved((s) => !s)}
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "rgb(var(--fg-muted))",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {showResolved ? "Hide resolved" : "Show resolved"}
                </button>
              ) : null
            }
          >
            <div style={{ padding: 8 }}>
              {visibleComments.length === 0 ? (
                <div
                  style={{
                    padding: 30,
                    textAlign: "center",
                    color: "rgb(var(--fg-muted))",
                    fontSize: 13,
                  }}
                >
                  No notes yet. Click the waveform to drop one at a specific timestamp.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {visibleComments.map((c) => {
                    const isResolved = !!resolved[c.id];
                    return (
                      <div
                        key={c.id}
                        className="sk-row"
                        style={{
                          display: "flex",
                          gap: 12,
                          padding: "10px 12px",
                          borderRadius: 10,
                          alignItems: "flex-start",
                          background: c.mine
                            ? "rgb(var(--brand-primary) / 0.06)"
                            : "transparent",
                          opacity: isResolved ? 0.55 : 1,
                        }}
                      >
                        <Avatar
                          initials={c.initials}
                          grad={c.mine ? "grad-amber" : "grad-slate"}
                          size={32}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 3,
                              flexWrap: "wrap",
                            }}
                          >
                            <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                              {c.who}
                            </span>
                            <button
                              onClick={() =>
                                scrub(c.at / Math.max(1, t.durationSec))
                              }
                              className="pill pill-brand tabular sk-pop"
                              style={{
                                fontSize: 9.5,
                                fontFamily: "JetBrains Mono",
                                cursor: "pointer",
                                border: "none",
                              }}
                            >
                              @{fmtTime(c.at)}
                            </button>
                            <span
                              style={{
                                fontSize: 10.5,
                                color: "rgb(var(--fg-faint))",
                              }}
                            >
                              {c.when}
                            </span>
                            {isResolved && (
                              <span
                                className="pill pill-success"
                                style={{ fontSize: 9 }}
                              >
                                ✓ RESOLVED
                              </span>
                            )}
                          </div>
                          <p
                            style={{
                              margin: 0,
                              fontSize: 13,
                              color: "rgb(var(--fg-default))",
                              lineHeight: 1.5,
                              textDecoration: isResolved ? "line-through" : "none",
                            }}
                          >
                            {c.text}
                          </p>
                          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                            <button
                              onClick={() =>
                                scrub(c.at / Math.max(1, t.durationSec))
                              }
                              className="sk-pop"
                              style={{
                                all: "unset",
                                cursor: "pointer",
                                fontSize: 10.5,
                                fontWeight: 600,
                                color: "rgb(var(--fg-muted))",
                              }}
                            >
                              Jump to
                            </button>
                            <button
                              className="sk-pop"
                              style={{
                                all: "unset",
                                cursor: "pointer",
                                fontSize: 10.5,
                                fontWeight: 600,
                                color: "rgb(var(--fg-muted))",
                              }}
                            >
                              Reply
                            </button>
                            <button
                              onClick={() =>
                                setResolved((p) => ({
                                  ...p,
                                  [c.id]: !p[c.id],
                                }))
                              }
                              className="sk-pop"
                              style={{
                                all: "unset",
                                cursor: "pointer",
                                fontSize: 10.5,
                                fontWeight: 600,
                                color: isResolved
                                  ? "rgb(var(--brand-primary-dark))"
                                  : "rgb(var(--fg-success))",
                              }}
                            >
                              {isResolved ? "Reopen" : "Resolve"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid rgb(var(--border-subtle))",
                  background: "rgb(var(--bg-elevated))",
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <span
                  className="pill pill-brand tabular"
                  style={{
                    fontSize: 9.5,
                    fontFamily: "JetBrains Mono",
                    flexShrink: 0,
                  }}
                >
                  @{fmtTime(sec)}
                </span>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a note at this timestamp…"
                  style={{
                    all: "unset",
                    flex: 1,
                    fontSize: 13,
                    fontFamily: "inherit",
                    color: "rgb(var(--fg-default))",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft) {
                      setDraft("");
                    }
                  }}
                />
                <button
                  onClick={() => setDraft("")}
                  className="sk-pop"
                  disabled={!draft}
                  style={{
                    all: "unset",
                    cursor: draft ? "pointer" : "not-allowed",
                    padding: "7px 14px",
                    borderRadius: 8,
                    background: draft
                      ? "rgb(var(--fg-default))"
                      : "rgb(var(--border-subtle))",
                    color: draft
                      ? "rgb(var(--bg-default))"
                      : "rgb(var(--fg-faint))",
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  Post
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
