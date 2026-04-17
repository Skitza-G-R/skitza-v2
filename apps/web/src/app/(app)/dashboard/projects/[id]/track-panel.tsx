"use client";

import { type SyntheticEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AudioUploader } from "~/components/audio/audio-uploader";
import { WaveformPlayer } from "~/components/audio/waveform-player";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { addTrack, addVersion, postProducerReply, resolveComment } from "../actions";

interface Version {
  id: string;
  trackId: string;
  label: string;
  // Nullable while a multipart upload is still pending; audio.completeMultipart
  // patches the row once the last part uploads. UI renders the uploader in the
  // player slot whenever audioUrl is null.
  audioUrl: string | null;
  uploadedAt: Date;
}

interface Track {
  id: string;
  title: string;
  artist: string | null;
  position: number;
}

interface CommentRow {
  id: string;
  versionId: string;
  authorName: string;
  body: string;
  timestampMs: number;
  resolvedAt: Date | null;
  fromProducer: boolean;
  createdAt: Date;
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m)}:${String(ss).padStart(2, "0")}`;
}

export function TrackPanel({
  projectId,
  tracks,
  versions,
  comments,
}: {
  projectId: string;
  tracks: Track[];
  versions: Version[];
  comments: CommentRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // Add-track form state
  const [showTrack, setShowTrack] = useState(false);
  const [newTrackTitle, setNewTrackTitle] = useState("");
  const [newTrackArtist, setNewTrackArtist] = useState("");

  // Add-version form state (per track). No URL input: we create the row
  // with audioUrl=null, then AudioUploader fills it in the player slot.
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [newVersionLabel, setNewVersionLabel] = useState("");

  // Which version is the producer currently viewing per track
  const initialSelected = Object.fromEntries(
    tracks.map((t) => {
      const latest = versions.find((v) => v.trackId === t.id);
      return [t.id, latest?.id ?? null];
    }),
  );
  const [selected, setSelected] = useState<Record<string, string | null>>(initialSelected);

  function onCreateTrack(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = newTrackTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const res = await addTrack({
        projectId,
        title,
        ...(newTrackArtist.trim() ? { artist: newTrackArtist.trim() } : {}),
      });
      if (res.ok) {
        toast(`Track "${title}" added.`, "success");
        setNewTrackTitle("");
        setNewTrackArtist("");
        setShowTrack(false);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onCreateVersion(e: SyntheticEvent<HTMLFormElement>, trackId: string) {
    e.preventDefault();
    const label = newVersionLabel.trim();
    if (!label) return;
    startTransition(async () => {
      // Create the row with audioUrl=null. The render loop below will
      // notice the null audioUrl and swap the player for an AudioUploader,
      // which fills the row via audio.completeMultipart on drop.
      const res = await addVersion({ projectId, trackId, label, audioUrl: null });
      if (res.ok) {
        toast(`Version "${label}" added — drop your file to upload.`, "success");
        setNewVersionLabel("");
        setVersionFor(null);
        // Auto-select the freshly-created version so the in-place
        // AudioUploader renders immediately (audioUrl is null on the new
        // row, which flips the player slot to the drop zone). Without
        // this, the producer would have to click the new pill manually.
        setSelected((s) => ({ ...s, [trackId]: res.data.id }));
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onResolve(id: string, resolved: boolean) {
    startTransition(async () => {
      const res = await resolveComment({ projectId, id, resolved });
      if (res.ok) {
        toast(resolved ? "Comment resolved." : "Re-opened.", "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="space-y-6">
      {tracks.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-10 text-center">
          <p className="font-display text-lg" style={{ fontWeight: 700 }}>
            No tracks yet.
          </p>
          <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
            Add the first track to start collecting versions + feedback.
          </p>
        </div>
      ) : null}

      {tracks.map((t, idx) => {
        const tVersions = versions.filter((v) => v.trackId === t.id);
        const selectedId = selected[t.id] ?? tVersions[0]?.id ?? null;
        const selectedVersion = tVersions.find((v) => v.id === selectedId) ?? tVersions[0] ?? null;
        const cmts = selectedVersion
          ? comments.filter((c) => c.versionId === selectedVersion.id)
          : [];
        return (
          <article
            key={t.id}
            className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
          >
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  Track {String(idx + 1).padStart(2, "0")}
                </p>
                <h3
                  className="mt-1 font-display text-xl tracking-tight"
                  style={{ fontWeight: 700 }}
                >
                  {t.title}
                </h3>
                {t.artist ? (
                  <p className="mt-0.5 text-sm text-[rgb(var(--fg-secondary))]">{t.artist}</p>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setVersionFor((v) => (v === t.id ? null : t.id));
                }}
                disabled={pending}
              >
                + Version
              </Button>
            </header>

            {/* Version stack switcher */}
            {tVersions.length > 0 ? (
              <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                {tVersions.map((v, vi) => {
                  const isSelected = v.id === selectedId;
                  const isLatest = vi === 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSelected((s) => ({ ...s, [t.id]: v.id }));
                      }}
                      className={[
                        "whitespace-nowrap rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-xs transition-colors",
                        isSelected
                          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
                          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                      ].join(" ")}
                    >
                      {v.label}
                      {isLatest ? " ·  latest" : ""}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mb-4 text-sm text-[rgb(var(--fg-secondary))]">
                No versions yet. Add the first one with + Version.
              </p>
            )}

            {/* Player — or uploader if the version is still pending audio */}
            {selectedVersion ? (
              <div className="mb-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-3">
                {selectedVersion.audioUrl ? (
                  <WaveformPlayer src={selectedVersion.audioUrl} label={t.title} />
                ) : (
                  <AudioUploader
                    trackVersionId={selectedVersion.id}
                    onComplete={() => {
                      toast("Upload complete.", "success");
                      router.refresh();
                    }}
                  />
                )}
                <p className="mt-2 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                  <span className="text-[rgb(var(--fg-secondary))]">{selectedVersion.label}</span>
                  {" · "}
                  {selectedVersion.audioUrl
                    ? `uploaded ${new Date(selectedVersion.uploadedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                    : "upload pending"}
                </p>
              </div>
            ) : null}

            {/* Inline add-version form. Label only — we create the row
                with audioUrl=null; the player slot flips to the uploader
                automatically once the new version is selected. */}
            {versionFor === t.id ? (
              <form
                onSubmit={(e) => {
                  onCreateVersion(e, t.id);
                }}
                className="mb-4 grid gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3 sm:grid-cols-[1fr_auto_auto]"
              >
                <div>
                  <Label htmlFor={`label-${t.id}`}>Label</Label>
                  <Input
                    id={`label-${t.id}`}
                    type="text"
                    value={newVersionLabel}
                    onChange={(e) => {
                      setNewVersionLabel(e.target.value);
                    }}
                    placeholder="Mix v2"
                    required
                    maxLength={40}
                    autoFocus
                  />
                </div>
                <Button type="submit" disabled={pending}>
                  {pending ? "…" : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setVersionFor(null);
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </form>
            ) : null}

            {/* Comments for selected version */}
            {selectedVersion ? (
              <div className="space-y-3">
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  {cmts.length === 0 ? "No comments yet" : `${String(cmts.length)} comment${cmts.length === 1 ? "" : "s"}`}
                </p>
                {cmts.map((c) => (
                  <div
                    key={c.id}
                    className={[
                      "rounded-[var(--radius-md)] border px-3 py-2",
                      c.resolvedAt
                        ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] opacity-60"
                        : c.fromProducer
                          ? "border-[rgb(var(--brand-accent)/0.35)] bg-[rgb(var(--brand-accent)/0.06)]"
                          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[rgb(var(--brand-primary))]">
                          {formatMs(c.timestampMs)}
                        </span>
                        <span className="text-xs text-[rgb(var(--fg-secondary))]">
                          {c.authorName}
                        </span>
                        {c.fromProducer ? (
                          <Badge variant="accent">You</Badge>
                        ) : null}
                        {c.resolvedAt ? (
                          <Badge variant="active" dot>
                            Resolved
                          </Badge>
                        ) : null}
                      </div>
                      {!c.resolvedAt ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onResolve(c.id, true);
                          }}
                          disabled={pending}
                        >
                          Resolve
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onResolve(c.id, false);
                          }}
                          disabled={pending}
                        >
                          Re-open
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">{c.body}</p>
                  </div>
                ))}
                <ProducerReplyForm
                  projectId={projectId}
                  versionId={selectedVersion.id}
                  onDone={() => {
                    router.refresh();
                  }}
                />
              </div>
            ) : null}
          </article>
        );
      })}

      {/* Add-track toggle */}
      {!showTrack ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setShowTrack(true);
          }}
        >
          + Add track
        </Button>
      ) : (
        <form
          onSubmit={onCreateTrack}
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="newTrackTitle">Title</Label>
              <Input
                id="newTrackTitle"
                type="text"
                value={newTrackTitle}
                onChange={(e) => {
                  setNewTrackTitle(e.target.value);
                }}
                placeholder="Midnight Drive"
                required
                maxLength={120}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="newTrackArtist">Artist (optional)</Label>
              <Input
                id="newTrackArtist"
                type="text"
                value={newTrackArtist}
                onChange={(e) => {
                  setNewTrackArtist(e.target.value);
                }}
                placeholder="feat. Someone"
                maxLength={120}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "…" : "Add track"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowTrack(false);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ProducerReplyForm({
  projectId,
  versionId,
  onDone,
}: {
  projectId: string;
  versionId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [timestampSec, setTimestampSec] = useState("0");

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    const secs = Math.max(0, Number(timestampSec) || 0);
    startTransition(async () => {
      const res = await postProducerReply({
        projectId,
        versionId,
        body: text,
        timestampMs: Math.round(secs * 1000),
      });
      if (res.ok) {
        toast("Reply posted.", "success");
        setBody("");
        setTimestampSec("0");
        onDone();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3 sm:grid-cols-[6rem_1fr_auto]"
    >
      <Input
        type="number"
        step={1}
        min={0}
        value={timestampSec}
        onChange={(e) => {
          setTimestampSec(e.target.value);
        }}
        aria-label="Timestamp seconds"
        className="text-right font-mono"
      />
      <Input
        type="text"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
        placeholder="Your reply at that timestamp…"
        required
        maxLength={2000}
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "…" : "Post"}
      </Button>
    </form>
  );
}
