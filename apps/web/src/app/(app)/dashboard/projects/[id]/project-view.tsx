"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type SyntheticEvent, useMemo, useState, useTransition } from "react";

import { AudioUploader } from "~/components/audio/audio-uploader";
import { WaveformPlayer } from "~/components/audio/waveform-player";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { type Stage } from "~/lib/projects/stages";
import {
  addProjectTrack,
  addProducerComment,
  addTrackVersion,
  approveVersionAction,
  resolveVersionComment,
} from "../actions";

interface Project {
  id: string;
  title: string;
  stage: Stage;
  artistName: string;
  artistEmail: string;
  clientName: string | null;
  clientEmail: string | null;
  depositPaid: boolean;
  finalPaid: boolean;
  // Task 7 — payment-plan state. When paymentPlanKind === 'split_50_50'
  // and chargesCompleted === 1, the "Mark final delivered" button fires
  // an off-session PaymentIntent via project.chargeFinal before running
  // the existing mark-final side effects. Null-safe for legacy rows.
  paymentPlanKind: string | null;
  // Task 8 — monthly plan installment count + next scheduled charge
  // from the Stripe subscription schedule, both surfaced in the
  // <PaymentStatusStrip/> at the top of the project room.
  installments: number | null;
  nextChargeAt: Date | null;
  chargesCompleted: number;
  chargesTotal: number | null;
  totalAmountCents: number | null;
  cardLast4: string | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Track {
  id: string;
  title: string;
  artist: string | null;
  position: number;
}

interface Version {
  id: string;
  trackId: string;
  label: string;
  audioUrl: string | null;
  uploadedAt: Date;
  approvedAt: Date | null;
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

interface ContractRow {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  signedAt: Date | null;
}

type TabId = "overview" | "audio" | "contract" | "invoices" | "activity";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "audio", label: "Audio" },
  { id: "contract", label: "Contract" },
  { id: "invoices", label: "Invoices" },
  { id: "activity", label: "Activity" },
];

function isTabId(v: string | null): v is TabId {
  return v === "overview" || v === "audio" || v === "contract" || v === "invoices" || v === "activity";
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m)}:${String(ss).padStart(2, "0")}`;
}

function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Rough "x ago" string for the approved badge. We only care about this
// at coarse resolution (the user's sense of "is this recent?"), so
// rounding to the nearest unit is fine.
function fmtAgo(d: Date): string {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  const days = Math.floor(h / 24);
  return `${String(days)}d ago`;
}

// Detect whether a sibling version looks like a stems upload so we
// don't nag the producer with the "Stems?" prompt after they've
// already sent them. Heuristic: the label OR the audio URL contains
// the word "stem". Case-insensitive. `stems.zip` / `stems (final)` /
// `mix + stems` all match.
export function hasStemsSibling(
  approvedId: string,
  siblingVersions: { id: string; label: string; audioUrl: string | null }[],
): boolean {
  const re = /stems?/i;
  return siblingVersions.some(
    (v) =>
      v.id !== approvedId && (re.test(v.label) || (v.audioUrl !== null && re.test(v.audioUrl))),
  );
}

// ─── Main ────────────────────────────────────────────────────────────
export function ProjectView({
  project,
  tracks,
  versions,
  comments,
  contracts,
}: {
  project: Project;
  tracks: Track[];
  versions: Version[];
  comments: CommentRow[];
  contracts: ContractRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabId = isTabId(tabParam) ? tabParam : "overview";

  function switchTab(id: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === "overview") params.delete("tab");
    else params.set("tab", id);
    const qs = params.toString();
    router.replace(`/dashboard/projects/${project.id}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    // Task 5: the outer page now owns the project header + 5-step
    // timeline + 4 sub-tabs. This view renders inside the "music"
    // sub-tab, so the top-level padding/container is a tighter
    // wrapper without the old max-w-5xl shell.
    <div className="flex flex-col gap-6">
      {/* Legacy tab bar (Overview/Audio/Contract/Invoices/Activity).
          These inner tabs stay as-is for Task 5 — Tasks 6-9 will peel
          content out of them into the new per-sub-tab components. */}
      <nav
        aria-label="Project sections"
        role="tablist"
        className="-mx-4 overflow-x-auto border-b border-[rgb(var(--border-subtle))] sm:mx-0"
      >
        <div className="flex min-w-max gap-1 px-4 sm:px-0">
          {TABS.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${t.id}`}
                id={`tab-${t.id}`}
                onClick={() => {
                  switchTab(t.id);
                }}
                className={[
                  "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))]"
                    : "border-transparent text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-6">
        {activeTab === "overview" ? (
          <OverviewTab
            project={project}
            trackCount={tracks.length}
            versionCount={versions.length}
            contractCount={contracts.length}
          />
        ) : null}
        {activeTab === "audio" ? (
          <AudioTab project={project} tracks={tracks} versions={versions} comments={comments} />
        ) : null}
        {activeTab === "contract" ? (
          <ContractTab projectId={project.id} contracts={contracts} />
        ) : null}
        {activeTab === "invoices" ? <InvoicesTab /> : null}
        {activeTab === "activity" ? (
          <ActivityTab tracks={tracks} versions={versions} comments={comments} />
        ) : null}
      </div>
    </div>
  );
}

// ─── Overview tab ────────────────────────────────────────────────────
function OverviewTab({
  project,
  trackCount,
  versionCount,
  contractCount,
}: {
  project: Project;
  trackCount: number;
  versionCount: number;
  contractCount: number;
}) {
  // Task 5 — stage dropdown, cancel-project modal, mark-final flow and
  // the confirm-charge modal all moved to the new ProjectHeader (see
  // apps/web/src/components/dashboard/project/project-header.tsx).
  // OverviewTab is now a read-only summary + client details card; the
  // deposit/final pay state reads off the project props for display
  // only. The editable mark-final action now lives in the header's
  // 3-dot menu (which also owns the ConfirmChargeModal wiring for
  // split_50_50 projects).

  return (
    <section
      role="tabpanel"
      id="panel-overview"
      aria-labelledby="tab-overview"
      className="space-y-6"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatBlock label="Tracks" value={String(trackCount)} />
        <StatBlock label="Versions" value={String(versionCount)} />
        <StatBlock label="Contracts" value={String(contractCount)} />
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Client
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[rgb(var(--fg-muted))]">Name</dt>
            <dd className="mt-0.5 text-sm text-[rgb(var(--fg-primary))]">
              {project.clientName ?? project.artistName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--fg-muted))]">Email</dt>
            <dd className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-primary))]">
              {project.clientEmail ?? project.artistEmail}
            </dd>
          </div>
          {project.clientName && project.clientName !== project.artistName ? (
            <>
              <div>
                <dt className="text-xs text-[rgb(var(--fg-muted))]">Artist (credited)</dt>
                <dd className="mt-0.5 text-sm text-[rgb(var(--fg-primary))]">
                  {project.artistName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--fg-muted))]">Artist email</dt>
                <dd className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-primary))]">
                  {project.artistEmail}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Timeline
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 font-mono text-xs">
          <div>
            <dt className="text-[rgb(var(--fg-muted))]">Created</dt>
            <dd className="mt-0.5 text-[rgb(var(--fg-primary))]">{fmtDateTime(project.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[rgb(var(--fg-muted))]">Last activity</dt>
            <dd className="mt-0.5 text-[rgb(var(--fg-primary))]">{fmtDateTime(project.updatedAt)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="mt-1 font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))]"
        style={{ fontWeight: 800 }}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Audio tab ───────────────────────────────────────────────────────
function AudioTab({
  project,
  tracks,
  versions,
  comments,
}: {
  project: Project;
  tracks: Track[];
  versions: Version[];
  comments: CommentRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [showTrack, setShowTrack] = useState(false);
  const [newTrackTitle, setNewTrackTitle] = useState("");
  const [newTrackArtist, setNewTrackArtist] = useState("");

  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [newVersionLabel, setNewVersionLabel] = useState("");

  const initialSelected = useMemo(
    () =>
      Object.fromEntries(
        tracks.map((t) => {
          const latest = versions.find((v) => v.trackId === t.id);
          return [t.id, latest?.id ?? null];
        }),
      ),
    [tracks, versions],
  );
  const [selected, setSelected] = useState<Record<string, string | null>>(initialSelected);

  function onCreateTrack(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = newTrackTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const res = await addProjectTrack({
        projectId: project.id,
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
      const res = await addTrackVersion({ projectId: project.id, trackId, label, audioUrl: null });
      if (res.ok) {
        toast(`Version "${label}" added — drop your file to upload.`, "success");
        setNewVersionLabel("");
        setVersionFor(null);
        setSelected((s) => ({ ...s, [trackId]: res.data.id }));
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onResolve(id: string, resolved: boolean) {
    startTransition(async () => {
      const res = await resolveVersionComment({ projectId: project.id, id, resolved });
      if (res.ok) {
        toast(resolved ? "Comment resolved." : "Re-opened.", "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <section
      role="tabpanel"
      id="panel-audio"
      aria-labelledby="tab-audio"
      className="space-y-6"
    >
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
                      {isLatest ? " · latest" : ""}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mb-4 text-sm text-[rgb(var(--fg-secondary))]">
                No versions yet. Add the first one with + Version.
              </p>
            )}

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
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                    <span className="text-[rgb(var(--fg-secondary))]">{selectedVersion.label}</span>
                    {" · "}
                    {selectedVersion.audioUrl
                      ? `uploaded ${fmtDateTime(selectedVersion.uploadedAt)}`
                      : "upload pending"}
                  </p>
                  <ApproveControl
                    projectId={project.id}
                    version={selectedVersion}
                    siblings={tVersions}
                  />
                </div>
              </div>
            ) : null}

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

            {selectedVersion ? (
              <div className="space-y-3">
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  {cmts.length === 0
                    ? "No comments yet"
                    : `${String(cmts.length)} comment${cmts.length === 1 ? "" : "s"}`}
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
                        {c.fromProducer ? <Badge variant="accent">You</Badge> : null}
                        {c.resolvedAt ? (
                          <Badge variant="active" dot>
                            Resolved
                          </Badge>
                        ) : null}
                      </div>
                      {c.resolvedAt ? (
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
                      ) : (
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
                      )}
                    </div>
                    <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">{c.body}</p>
                  </div>
                ))}
                <ProducerReplyForm
                  projectId={project.id}
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
    </section>
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
      const res = await addProducerComment({
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

// ─── Approve control ─────────────────────────────────────────────────
// Producer-side "mark this version final". Approving emits a
// notification nudging the producer to upload stems. Once the heuristic
// detects a stems sibling already exists, the "Stems?" link hides (the
// notification is already resolved from the UX's perspective).
function ApproveControl({
  projectId,
  version,
  siblings,
}: {
  projectId: string;
  version: Version;
  siblings: Version[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function toggle(approved: boolean) {
    startTransition(async () => {
      const res = await approveVersionAction({
        projectId,
        versionId: version.id,
        approved,
      });
      if (res.ok) {
        toast(
          approved
            ? "Version approved — we'll remind you about stems."
            : "Approval cleared.",
          "success",
        );
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  if (!version.approvedAt) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          toggle(true);
        }}
        disabled={pending || !version.audioUrl}
        // If there's no uploaded audio yet the button is disabled —
        // approving a still-uploading version is nonsensical.
        title={version.audioUrl ? "Mark this version as final" : "Upload audio before approving"}
      >
        {pending ? "…" : "Approve"}
      </Button>
    );
  }

  const stemsSibling = hasStemsSibling(version.id, siblings);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="active" dot>
        Approved {fmtAgo(version.approvedAt)}
      </Badge>
      {!stemsSibling ? (
        <span className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
          ·{" "}
          <button
            type="button"
            onClick={() => {
              // Scroll the version uploader into view and nudge the
              // producer to add a "stems" labelled version. Selecting
              // the + Version button focus-wise is more involved;
              // for MVP we simply scroll + toast an instruction.
              toast(
                "Add a new version labelled \"stems\" under this track.",
                "success",
              );
            }}
            className="underline-offset-2 hover:text-[rgb(var(--brand-primary))] hover:underline"
          >
            Stems?
          </button>
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          toggle(false);
        }}
        disabled={pending}
        className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))] underline-offset-2 hover:text-[rgb(var(--fg-primary))] hover:underline"
      >
        Undo
      </button>
    </div>
  );
}

// ─── Contract tab ────────────────────────────────────────────────────
function ContractTab({
  projectId,
  contracts,
}: {
  projectId: string;
  contracts: ContractRow[];
}) {
  return (
    <section
      role="tabpanel"
      id="panel-contract"
      aria-labelledby="tab-contract"
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-tight" style={{ fontWeight: 700 }}>
            Contract
          </h2>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            Sign before you start. One signing URL per artist.
          </p>
        </div>
        <Link href={`/dashboard/contracts/new?projectId=${projectId}`}>
          <Button size="sm">+ New contract</Button>
        </Link>
      </div>

      {contracts.length === 0 ? (
        <EmptyState
          title="No contracts for this project yet."
          description="Send a template-backed contract for signing. The artist gets a single signing URL with an audit trail on every view + sign."
        />
      ) : (
        <ul className="space-y-2">
          {contracts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/contracts`}
                className="block rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 transition-colors hover:border-[rgb(var(--border-strong))]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
                      {c.title}
                    </p>
                    <p className="mt-0.5 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                      Created {fmtDateTime(c.createdAt)}
                      {c.signedAt ? ` · signed ${fmtDateTime(c.signedAt)}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant={
                      c.status === "signed"
                        ? "active"
                        : c.status === "cancelled" || c.status === "expired"
                          ? "danger"
                          : "neutral"
                    }
                    dot
                  >
                    {c.status}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Invoices tab ────────────────────────────────────────────────────
function InvoicesTab() {
  return (
    <section
      role="tabpanel"
      id="panel-invoices"
      aria-labelledby="tab-invoices"
      className="space-y-4"
    >
      <EmptyState
        title="No invoices yet."
        description="Invoicing is coming in a later phase. For now, flip the payment flags on the Overview tab to unlock final downloads for the artist."
      />
    </section>
  );
}

// ─── Activity tab ────────────────────────────────────────────────────
type ActivityItem =
  | { kind: "version"; at: Date; trackTitle: string; label: string }
  | { kind: "comment"; at: Date; authorName: string; fromProducer: boolean; body: string; timestampMs: number };

function ActivityTab({
  tracks,
  versions,
  comments,
}: {
  tracks: Track[];
  versions: Version[];
  comments: CommentRow[];
}) {
  const trackById = useMemo(() => {
    const m = new Map<string, Track>();
    for (const t of tracks) m.set(t.id, t);
    return m;
  }, [tracks]);

  const items: ActivityItem[] = useMemo(() => {
    const out: ActivityItem[] = [];
    for (const v of versions) {
      out.push({
        kind: "version",
        at: v.uploadedAt,
        trackTitle: trackById.get(v.trackId)?.title ?? "(unknown track)",
        label: v.label,
      });
    }
    for (const c of comments) {
      out.push({
        kind: "comment",
        at: c.createdAt,
        authorName: c.authorName,
        fromProducer: c.fromProducer,
        body: c.body,
        timestampMs: c.timestampMs,
      });
    }
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out;
  }, [versions, comments, trackById]);

  return (
    <section
      role="tabpanel"
      id="panel-activity"
      aria-labelledby="tab-activity"
      className="space-y-3"
    >
      {items.length === 0 ? (
        <EmptyState
          title="Nothing happened yet."
          description="Upload a track version or receive a comment from the artist — it'll show up here with a timestamp."
        />
      ) : (
        <ol className="space-y-2">
          {items.map((it, i) => (
            <li
              key={`${String(it.at.valueOf())}-${String(i)}`}
              className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {it.kind === "version" ? (
                    <p className="text-sm text-[rgb(var(--fg-primary))]">
                      <span className="font-semibold">New version</span>{" "}
                      <span className="font-mono text-xs text-[rgb(var(--brand-primary))]">
                        {it.label}
                      </span>{" "}
                      on{" "}
                      <span className="text-[rgb(var(--fg-secondary))]">{it.trackTitle}</span>
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-[rgb(var(--fg-primary))]">
                        <span className="font-semibold">{it.authorName}</span>
                        {it.fromProducer ? (
                          <Badge variant="accent" className="ml-2">
                            You
                          </Badge>
                        ) : null}
                        <span className="ml-1 text-[rgb(var(--fg-secondary))]">
                          commented at{" "}
                          <span className="font-mono text-xs text-[rgb(var(--brand-primary))]">
                            {formatMs(it.timestampMs)}
                          </span>
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">{it.body}</p>
                    </>
                  )}
                </div>
                <p className="whitespace-nowrap font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                  {fmtDateTime(it.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
        TODO: contract send/view/sign events land here once the project_events table is wired.
      </p>
    </section>
  );
}
