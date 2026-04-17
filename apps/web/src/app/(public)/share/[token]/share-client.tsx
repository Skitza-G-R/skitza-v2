"use client";

import { type SyntheticEvent, useRef, useState, useTransition } from "react";

import { WaveformPlayer } from "~/components/audio/waveform-player";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { submitArtistComment } from "./actions";

export interface Track {
  id: string;
  title: string;
  artist: string | null;
  position: number;
}

export interface Version {
  id: string;
  trackId: string;
  label: string;
  audioUrl: string;
  uploadedAt: Date;
}

export interface Comment {
  id: string;
  versionId: string;
  authorName: string;
  body: string;
  timestampMs: number;
  resolvedAt: Date | null;
  fromProducer: boolean;
  createdAt: Date;
}

export interface Project {
  id: string;
  title: string;
  artistName: string;
  producerName: string;
  producerSlug: string;
  depositPaid: boolean;
  finalPaid: boolean;
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m)}:${String(ss).padStart(2, "0")}`;
}

interface Props {
  token: string;
  project: Project;
  tracks: Track[];
  versions: Version[];
  comments: Comment[];
}

export function ShareClient({ token, project, tracks, versions, comments }: Props) {
  const [pending, startTransition] = useTransition();

  // Remember selected version per track. Defaults to latest (first in
  // versions array, already desc-sorted by uploadedAt).
  const initialSelected = Object.fromEntries(
    tracks.map((t) => [t.id, versions.find((v) => v.trackId === t.id)?.id ?? null]),
  );
  const [selected, setSelected] = useState<Record<string, string | null>>(initialSelected);

  // Remember artist identity so the form doesn't ask twice. First
  // comment asks for name + email; subsequent comments autofill.
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null);

  return (
    <div className="space-y-8">
      {/* Payment state banner. Informational; producer controls the flip. */}
      <aside
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
        aria-label="Payment state"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              Payment
            </span>
            {project.finalPaid ? (
              <Badge variant="active" dot>
                Final paid · downloads unlocked
              </Badge>
            ) : project.depositPaid ? (
              <Badge variant="warning" dot>
                Deposit paid · final pending
              </Badge>
            ) : (
              <Badge dot>Unpaid · downloads locked</Badge>
            )}
          </div>
          {!project.finalPaid ? (
            <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
              Final mixes unlock when the invoice clears.
            </p>
          ) : null}
        </div>
      </aside>

      {tracks.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-12 text-center">
          <p className="font-display text-lg" style={{ fontWeight: 700 }}>
            Nothing to review yet.
          </p>
          <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
            {project.producerName} hasn&apos;t uploaded tracks yet. Check back soon.
          </p>
        </div>
      ) : null}

      {tracks.map((t, idx) => {
        const tVersions = versions.filter((v) => v.trackId === t.id);
        const selectedId = selected[t.id] ?? tVersions[0]?.id ?? null;
        const selectedVersion =
          tVersions.find((v) => v.id === selectedId) ?? tVersions[0] ?? null;
        const visibleComments = selectedVersion
          ? comments.filter((c) => c.versionId === selectedVersion.id)
          : [];

        return (
          <article
            key={t.id}
            className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
          >
            <header className="mb-4">
              <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                Track {String(idx + 1).padStart(2, "0")}
              </p>
              <h2
                className="mt-1 font-display text-2xl leading-tight tracking-tight"
                style={{ fontWeight: 700 }}
              >
                {t.title}
              </h2>
              {t.artist ? (
                <p className="mt-0.5 text-sm text-[rgb(var(--fg-secondary))]">{t.artist}</p>
              ) : null}
            </header>

            {/* Version stack — latest on top, click to switch */}
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
                        "whitespace-nowrap rounded-[var(--radius-sm)] border px-3 py-1 font-mono text-xs transition-colors",
                        isSelected
                          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
                          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                      ].join(" ")}
                    >
                      {v.label}
                      {isLatest ? " · latest" : ""}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mb-4 text-sm text-[rgb(var(--fg-secondary))]">
                {project.producerName} will post versions here as they progress.
              </p>
            )}

            {/* Player + download button */}
            {selectedVersion ? (
              <PlayerPanel
                src={selectedVersion.audioUrl}
                title={t.title}
                version={selectedVersion}
                finalPaid={project.finalPaid}
              />
            ) : null}

            {/* Comments */}
            {selectedVersion ? (
              <div className="mt-5">
                <p className="mb-3 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  {visibleComments.length === 0
                    ? "No comments yet — add the first"
                    : `${String(visibleComments.length)} comment${visibleComments.length === 1 ? "" : "s"}`}
                </p>
                <ul className="space-y-2">
                  {visibleComments.map((c) => (
                    <li
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[rgb(var(--brand-primary))]">
                          {formatMs(c.timestampMs)}
                        </span>
                        <span className="text-xs text-[rgb(var(--fg-secondary))]">
                          {c.authorName}
                        </span>
                        {c.fromProducer ? <Badge variant="accent">{project.producerName}</Badge> : null}
                        {c.resolvedAt ? (
                          <Badge variant="active" dot>
                            Resolved
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">{c.body}</p>
                    </li>
                  ))}
                </ul>

                <ArtistCommentForm
                  token={token}
                  versionId={selectedVersion.id}
                  identity={identity}
                  onIdentity={setIdentity}
                  pending={pending}
                  startTransition={startTransition}
                />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function PlayerPanel({
  src,
  title,
  version,
  finalPaid,
}: {
  src: string;
  title: string;
  version: Version;
  finalPaid: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-3">
      <WaveformPlayer src={src} label={title} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
          <span className="text-[rgb(var(--fg-secondary))]">{version.label}</span>
          {" · "}
          uploaded{" "}
          {new Date(version.uploadedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        {finalPaid ? (
          <a
            href={src}
            download
            className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] px-3 py-1 font-mono text-xs font-semibold text-[rgb(var(--brand-primary))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.18)]"
          >
            ↓ Download
          </a>
        ) : (
          <span
            aria-disabled
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-3 py-1 font-mono text-xs text-[rgb(var(--fg-muted))]"
          >
            🔒 Locked until paid
          </span>
        )}
      </div>
    </div>
  );
}

function ArtistCommentForm({
  token,
  versionId,
  identity,
  onIdentity,
  pending,
  startTransition,
}: {
  token: string;
  versionId: string;
  identity: { name: string; email: string } | null;
  onIdentity: (id: { name: string; email: string }) => void;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(identity?.name ?? "");
  const [email, setEmail] = useState(identity?.email ?? "");
  const [body, setBody] = useState("");
  const [timestampSec, setTimestampSec] = useState("0");
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const text = body.trim();
    if (!trimmedName || !trimmedEmail || !text) return;
    const secs = Math.max(0, Number(timestampSec) || 0);
    startTransition(async () => {
      const res = await submitArtistComment({
        token,
        versionId,
        authorName: trimmedName,
        authorEmail: trimmedEmail,
        body: text,
        timestampMs: Math.round(secs * 1000),
      });
      if (res.ok) {
        toast("Comment posted.", "success");
        onIdentity({ name: trimmedName, email: trimmedEmail });
        setBody("");
        setTimestampSec("0");
        formRef.current?.reset();
      } else {
        toast(res.error, "error");
      }
    });
  }

  const needsIdentity = !identity;

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3"
    >
      {needsIdentity ? (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor={`n-${versionId}`}>Your name</Label>
            <Input
              id={`n-${versionId}`}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              required
              maxLength={80}
            />
          </div>
          <div>
            <Label htmlFor={`e-${versionId}`}>Email</Label>
            <Input
              id={`e-${versionId}`}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              required
            />
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[6rem_1fr_auto]">
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
          placeholder="e.g. snare too loud at 1:42"
          required
          maxLength={2000}
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "…" : "Post"}
        </Button>
      </div>
    </form>
  );
}
