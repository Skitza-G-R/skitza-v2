"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";

import {
  removeClientAction,
  sendClientMagicLinkAction,
  updateClientAction,
  updateClientMetaAction,
} from "../actions";

// Phase H.2 client detail. Above the timeline we now expose a projects
// grid (richer than the old flat list) + editors for tags, notes, and
// referral source — the three pro-producer extras we shipped.
//
// Timeline groups events by day/week so a crowded history reads as
// sessions-of-activity rather than a firehose. Events carry iconography
// per kind (upload, comment, contract, project).

type Contact = {
  id: string;
  email: string;
  name: string;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  tags: string[] | null;
  notes: string | null;
  referralSource: string | null;
};

type Stats = {
  activeProjectCount: number;
  totalProjectCount: number;
  trackCount: number;
  lastActivity: Date | string;
  outstandingCents: number;
  lifetimeCents: number;
};

type Stage =
  | "lead"
  | "booked"
  | "contract_sent"
  | "in_production"
  | "final_review"
  | "paid"
  | "archived"
  | "payment_paused"
  | "cancelled";

type ProjectRow = {
  id: string;
  title: string;
  stage: Stage;
  createdAt: Date | string;
  updatedAt: Date | string;
  depositPaid: boolean;
  finalPaid: boolean;
  priceCents: number;
  currency: string | null;
  outstandingCents: number;
  lifetimeCents: number;
  nextSessionAt: Date | string | null;
};

type ContractRow = {
  id: string;
  title: string;
  status: string;
  createdAt: Date | string;
  sentAt: Date | string | null;
  signedAt: Date | string | null;
};

type CommentRow = {
  id: string;
  versionId: string;
  trackId: string;
  projectId: string;
  body: string;
  timestampMs: number;
  createdAt: Date | string;
  fromProducer: boolean;
};

type TimelineEvent =
  | { kind: "project"; at: Date; project: ProjectRow }
  | { kind: "contract"; at: Date; contract: ContractRow; eventName: string }
  | { kind: "comment"; at: Date; comment: CommentRow };

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function formatRelative(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const day = 86_400_000;
  const hr = 3_600_000;
  const min = 60_000;
  if (abs < min) return "just now";
  if (abs < hr) return relFmt.format(Math.round(diff / min), "minute");
  if (abs < day) return relFmt.format(Math.round(diff / hr), "hour");
  if (abs < 30 * day) return relFmt.format(Math.round(diff / day), "day");
  return dateFmt.format(d);
}

function formatCents(cents: number, currency = "USD"): string {
  if (cents === 0) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(0)}`;
  }
}

function groupByDay(ts: Date): string {
  const now = new Date();
  const sameDay =
    ts.getFullYear() === now.getFullYear() &&
    ts.getMonth() === now.getMonth() &&
    ts.getDate() === now.getDate();
  if (sameDay) return "Today";
  const yday = new Date(now);
  yday.setDate(now.getDate() - 1);
  if (
    ts.getFullYear() === yday.getFullYear() &&
    ts.getMonth() === yday.getMonth() &&
    ts.getDate() === yday.getDate()
  )
    return "Yesterday";
  const days = Math.floor((now.getTime() - ts.getTime()) / 86_400_000);
  if (days < 7) return "Earlier this week";
  if (days < 30) return "Earlier this month";
  return dateFmt.format(ts).split(",")[0] ?? "Earlier";
}

const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead",
  booked: "Booked",
  contract_sent: "Contract sent",
  in_production: "In production",
  final_review: "Final review",
  paid: "Paid",
  archived: "Archived",
  payment_paused: "Payment paused",
  cancelled: "Cancelled",
};

export function ClientTimeline({
  contact,
  stats,
  projects,
  contracts,
  comments,
}: {
  contact: Contact;
  stats: Stats;
  projects: ProjectRow[];
  contracts: ContractRow[];
  comments: CommentRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [magicLink, setMagicLink] = useState<{
    url: string;
    target: "portfolio" | "booking";
  } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(contact.name);
  const [editEmail, setEditEmail] = useState(contact.email);

  // Meta fields: tags, notes, referral source. Local state so the
  // producer sees their changes immediately; persisted via the
  // updateClientMeta action.
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);
  const [notes, setNotes] = useState<string>(contact.notes ?? "");
  const [referral, setReferral] = useState<string>(contact.referralSource ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [referralDirty, setReferralDirty] = useState(false);

  const saveMeta = useCallback(
    (patch: { tags?: string[]; notes?: string; referralSource?: string }) => {
      startTransition(async () => {
        const res = await updateClientMetaAction({ id: contact.id, ...patch });
        if (!res.ok) {
          toast(res.error, "error");
          return;
        }
        toast("Saved.", "success");
        router.refresh();
      });
    },
    [contact.id, router, toast],
  );

  const addTag = useCallback(
    (raw: string) => {
      const v = raw.trim();
      if (!v) return;
      if (tags.some((t) => t.toLowerCase() === v.toLowerCase())) return;
      const next = [...tags, v];
      setTags(next);
      saveMeta({ tags: next });
    },
    [tags, saveMeta],
  );

  const removeTag = useCallback(
    (t: string) => {
      const next = tags.filter((x) => x !== t);
      setTags(next);
      saveMeta({ tags: next });
    },
    [tags, saveMeta],
  );

  const saveNotes = useCallback(() => {
    saveMeta({ notes });
    setNotesDirty(false);
  }, [notes, saveMeta]);

  const saveReferral = useCallback(() => {
    saveMeta({ referralSource: referral });
    setReferralDirty(false);
  }, [referral, saveMeta]);

  const timeline: TimelineEvent[] = useMemo(
    () =>
      [
        ...projects.map((d) => ({
          kind: "project" as const,
          at: toDate(d.createdAt) ?? new Date(0),
          project: d,
        })),
        ...contracts.flatMap<TimelineEvent>((c) => {
          const events: TimelineEvent[] = [
            {
              kind: "contract",
              at: toDate(c.createdAt) ?? new Date(0),
              contract: c,
              eventName: "Contract created",
            },
          ];
          const sent = toDate(c.sentAt);
          if (sent) {
            events.push({
              kind: "contract",
              at: sent,
              contract: c,
              eventName: "Contract sent",
            });
          }
          const signed = toDate(c.signedAt);
          if (signed) {
            events.push({
              kind: "contract",
              at: signed,
              contract: c,
              eventName: "Contract signed",
            });
          }
          return events;
        }),
        ...comments.map((cm) => ({
          kind: "comment" as const,
          at: toDate(cm.createdAt) ?? new Date(0),
          comment: cm,
        })),
      ].sort((a, b) => b.at.getTime() - a.at.getTime()),
    [projects, contracts, comments],
  );

  const groupedTimeline = useMemo(() => {
    const groups: { title: string; events: TimelineEvent[] }[] = [];
    let currentTitle: string | null = null;
    for (const ev of timeline) {
      const title = groupByDay(ev.at);
      if (title !== currentTitle) {
        groups.push({ title, events: [ev] });
        currentTitle = title;
      } else {
        groups[groups.length - 1]?.events.push(ev);
      }
    }
    return groups;
  }, [timeline]);

  const issueLink = useCallback(
    (target: "portfolio" | "booking") => {
      startTransition(async () => {
        const res = await sendClientMagicLinkAction({ id: contact.id, target });
        if (!res.ok) {
          toast(res.error, "error");
          return;
        }
        setMagicLink({ url: res.data.url, target: res.data.target });
        const clip = navigator.clipboard as Clipboard | undefined;
        if (clip) {
          void clip.writeText(res.data.url).then(
            () => {
              toast("Link copied.", "success");
            },
            () => {
              /* silent */
            },
          );
        }
      });
    },
    [contact.id, toast],
  );

  const remove = useCallback(() => {
    const confirmed = window.confirm(
      `Delete ${contact.name}? Their projects and contracts stay — only this contact entry is removed.`,
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await removeClientAction({ id: contact.id });
      if (res.ok) {
        toast(`${contact.name} removed.`, "info");
        router.push("/dashboard/clients");
      } else {
        toast(res.error, "error");
      }
    });
  }, [contact.id, contact.name, router, toast]);

  const saveEdit = useCallback(() => {
    const trimmedName = editName.trim();
    const trimmedEmail = editEmail.trim();
    if (!trimmedName || !trimmedEmail) {
      toast("Name and email are both required.", "error");
      return;
    }
    startTransition(async () => {
      const res = await updateClientAction({
        id: contact.id,
        name: trimmedName,
        email: trimmedEmail,
      });
      if (res.ok) {
        toast(`Updated ${res.data.name}.`, "success");
        setEditOpen(false);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }, [contact.id, editName, editEmail, router, toast]);

  const newProjectHref = `/dashboard/projects/new?email=${encodeURIComponent(
    contact.email,
  )}&name=${encodeURIComponent(contact.name)}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href="/dashboard/clients"
        className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
      >
        ← All clients
      </Link>

      <header className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            className="font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            {contact.name}
          </h1>
          <p className="mt-2 font-mono text-sm text-[rgb(var(--fg-secondary))]">
            <a
              href={`mailto:${contact.email}`}
              className="hover:text-[rgb(var(--fg-primary))] hover:underline"
            >
              {contact.email}
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="lg"
            className="h-11"
            disabled={pending}
            onClick={() => {
              issueLink("booking");
            }}
          >
            Send magic link
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            className="h-11"
            disabled={pending}
            onClick={() => {
              setEditOpen((v) => !v);
            }}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="lg"
            variant="destructive"
            className="h-11"
            disabled={pending}
            onClick={remove}
          >
            Delete
          </Button>
        </div>
      </header>

      {magicLink ? (
        <MagicLinkBanner
          data={magicLink}
          onDismiss={() => {
            setMagicLink(null);
          }}
        />
      ) : null}

      {editOpen ? (
        <div className="mt-6 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
          <p className="font-mono text-[0.72rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Edit client
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[0.68rem] font-medium uppercase tracking-[0.12em] text-[rgb(var(--fg-secondary))]">
                Name
              </span>
              <input
                type="text"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                }}
                className="block h-11 w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-sm text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[0.68rem] font-medium uppercase tracking-[0.12em] text-[rgb(var(--fg-secondary))]">
                Email
              </span>
              <input
                type="email"
                inputMode="email"
                autoCapitalize="off"
                spellCheck={false}
                value={editEmail}
                onChange={(e) => {
                  setEditEmail(e.target.value);
                }}
                className="block h-11 w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 font-mono text-sm text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={saveEdit} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditOpen(false);
                setEditName(contact.name);
                setEditEmail(contact.email);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <section className="mt-8 grid gap-3 sm:grid-cols-4">
        <StatCard label="Active projects" value={String(stats.activeProjectCount)} />
        <StatCard label="Outstanding" value={formatCents(stats.outstandingCents)} accent="brand" />
        <StatCard label="Lifetime" value={formatCents(stats.lifetimeCents)} />
        <StatCard label="Last active" value={formatRelative(stats.lastActivity)} />
      </section>

      {/* Tags + meta row */}
      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <TagsEditor tags={tags} onAdd={addTag} onRemove={removeTag} disabled={pending} />
        <ReferralEditor
          value={referral}
          onChange={(v) => {
            setReferral(v);
            setReferralDirty(true);
          }}
          dirty={referralDirty}
          onSave={saveReferral}
          disabled={pending}
        />
      </section>

      <section className="mt-6">
        <NotesEditor
          value={notes}
          onChange={(v) => {
            setNotes(v);
            setNotesDirty(true);
          }}
          dirty={notesDirty}
          onSave={saveNotes}
          disabled={pending}
        />
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-[rgb(var(--fg-primary))]">Projects</h2>
          <Link
            href={newProjectHref}
            className="inline-flex h-11 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-3 text-sm font-medium text-[rgb(var(--fg-inverse))] shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.15)] hover:brightness-[1.06]"
          >
            + New project for {contact.name.split(" ")[0]}
          </Link>
        </div>
        {projects.length === 0 ? (
          <div className="mt-3 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5 text-center">
            <p className="text-sm text-[rgb(var(--fg-secondary))]">
              No projects with {contact.name} yet. Their email is pre-filled — start the first one.
            </p>
            <Link
              href={newProjectHref}
              className="mt-3 inline-flex h-11 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-3 text-sm font-medium text-[rgb(var(--fg-inverse))]"
            >
              Create your first project with {contact.name.split(" ")[0]}
            </Link>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl text-[rgb(var(--fg-primary))]">Timeline</h2>
        {groupedTimeline.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4 text-sm text-[rgb(var(--fg-secondary))]">
            Nothing here yet. Events (projects, contracts, comments) will appear as they happen.
          </p>
        ) : (
          <div className="mt-3 space-y-5">
            {groupedTimeline.map((group, gi) => (
              <div key={`${group.title}-${String(gi)}`}>
                <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  {group.title}
                </p>
                <ol className="space-y-2">
                  {group.events.map((ev, i) => (
                    <TimelineRow key={`${ev.kind}-${String(gi)}-${String(i)}`} event={ev} />
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "brand";
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3">
      <p className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className={`sk-num mt-1 font-display text-2xl leading-none ${
          accent === "brand" ? "text-[rgb(var(--brand-primary))]" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function TagsEditor({
  tags,
  onAdd,
  onRemove,
  disabled,
}: {
  tags: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        Tags
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.length === 0 ? (
          <span className="text-xs text-[rgb(var(--fg-muted))]">No tags yet.</span>
        ) : (
          tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--bg-overlay))] px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))]"
            >
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                disabled={disabled}
                onClick={() => {
                  onRemove(t);
                }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-base))] hover:text-[rgb(var(--fg-danger))] disabled:pointer-events-none disabled:opacity-40"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          onAdd(draft);
          setDraft("");
        }}
      >
        <input
          type="text"
          value={draft}
          placeholder="e.g. label: Universal, priority: high"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          maxLength={80}
          disabled={disabled}
          className="block h-11 w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-sm text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
        />
        <Button type="submit" size="sm" className="h-11" disabled={disabled || !draft.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

function ReferralEditor({
  value,
  onChange,
  dirty,
  onSave,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  dirty: boolean;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        Referral source
      </p>
      <p className="mt-1 text-[0.7rem] text-[rgb(var(--fg-muted))]">
        How did they find you? (track this for marketing)
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={value}
          placeholder="Instagram, referred by …, producer friend"
          onChange={(e) => {
            onChange(e.target.value);
          }}
          maxLength={200}
          disabled={disabled}
          className="block h-11 w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-sm text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
        />
        <Button
          type="button"
          size="sm"
          className="h-11"
          disabled={disabled || !dirty}
          onClick={onSave}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function NotesEditor({
  value,
  onChange,
  dirty,
  onSave,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  dirty: boolean;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Private notes
        </p>
        {dirty ? (
          <Button type="button" size="sm" onClick={onSave} disabled={disabled}>
            Save
          </Button>
        ) : null}
      </div>
      <textarea
        value={value}
        placeholder="Jot anything you want to remember about this client. Only you see this."
        onChange={(e) => {
          onChange(e.target.value);
        }}
        maxLength={5000}
        disabled={disabled}
        rows={4}
        className="mt-2 block w-full resize-y rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-3 text-sm text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
      />
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const currency = project.currency ?? "USD";
  return (
    <li className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="min-w-0 flex-1 font-medium text-[rgb(var(--fg-primary))] hover:underline"
        >
          <span className="block truncate">{project.title}</span>
        </Link>
        <StageBadge stage={project.stage} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-left">
        <div>
          <dt className="font-mono text-[0.58rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Value
          </dt>
          <dd className="sk-num mt-0.5 text-sm text-[rgb(var(--fg-primary))]">
            {project.priceCents > 0 ? formatCents(project.priceCents, currency) : "—"}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[0.58rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Outstanding
          </dt>
          <dd
            className={`sk-num mt-0.5 text-sm ${
              project.outstandingCents > 0
                ? "text-[rgb(var(--brand-primary))]"
                : "text-[rgb(var(--fg-muted))]"
            }`}
          >
            {project.outstandingCents > 0
              ? formatCents(project.outstandingCents, currency)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[0.58rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            {project.nextSessionAt ? "Next session" : "Updated"}
          </dt>
          <dd className="mt-0.5 text-sm text-[rgb(var(--fg-secondary))]">
            {formatRelative(project.nextSessionAt ?? project.updatedAt)}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-2.5 text-xs text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
        >
          Open
        </Link>
        <Link
          href={`/dashboard/contracts?project=${project.id}`}
          className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-2.5 text-xs text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
        >
          Send contract
        </Link>
        <Link
          href={`/dashboard/projects/${project.id}#upload`}
          className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-2.5 text-xs text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
        >
          Upload track
        </Link>
      </div>
    </li>
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  const accent =
    stage === "paid"
      ? "bg-[rgb(var(--brand-primary)/0.18)] text-[rgb(var(--brand-primary))]"
      : stage === "archived"
        ? "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-muted))]"
        : "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-secondary))]";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider ${accent}`}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  if (event.kind === "project") {
    return (
      <li className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
        <IconBubble kind="project" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            {formatRelative(event.at)} · Project created
          </p>
          <Link
            href={`/dashboard/projects/${event.project.id}`}
            className="mt-0.5 block font-medium text-[rgb(var(--fg-primary))] hover:underline"
          >
            {event.project.title}
          </Link>
          <p className="mt-0.5 font-mono text-[0.7rem] text-[rgb(var(--fg-secondary))]">
            {STAGE_LABEL[event.project.stage]}
          </p>
        </div>
      </li>
    );
  }
  if (event.kind === "contract") {
    return (
      <li className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
        <IconBubble kind="contract" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            {formatRelative(event.at)} · {event.eventName}
          </p>
          <Link
            href="/dashboard/contracts"
            className="mt-0.5 block font-medium text-[rgb(var(--fg-primary))] hover:underline"
          >
            {event.contract.title}
          </Link>
          <p className="mt-0.5 font-mono text-[0.7rem] text-[rgb(var(--fg-secondary))] capitalize">
            {event.contract.status}
          </p>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
      <IconBubble kind="comment" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {formatRelative(event.at)} · {event.comment.fromProducer ? "You replied" : "Comment"}
        </p>
        <p className="mt-1 text-sm text-[rgb(var(--fg-primary))]">{event.comment.body}</p>
        <Link
          href={`/dashboard/projects/${event.comment.projectId}`}
          className="mt-2 inline-block font-mono text-[0.7rem] text-[rgb(var(--brand-primary))] hover:underline"
        >
          Open project →
        </Link>
      </div>
    </li>
  );
}

function IconBubble({ kind }: { kind: "project" | "contract" | "comment" | "upload" }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))]">
      {kind === "project" ? <ProjectIcon /> : null}
      {kind === "contract" ? <ContractIcon /> : null}
      {kind === "comment" ? <CommentIcon /> : null}
      {kind === "upload" ? <UploadIcon /> : null}
    </span>
  );
}

function ProjectIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12" />
    </svg>
  );
}

function ContractIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 1.75h6.5L13 5.25v9A.75.75 0 0 1 12.25 15H3a.75.75 0 0 1-.75-.75v-11.5A.75.75 0 0 1 3 1.75Z" />
      <path d="M9 1.75V5.5h4" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v6A1.5 1.5 0 0 1 12 11.5H7L4 14v-2.5A1.5 1.5 0 0 1 2.5 10Z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8M4.5 5.5 8 2l3.5 3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

function MagicLinkBanner({
  data,
  onDismiss,
}: {
  data: { url: string; target: "portfolio" | "booking" };
  onDismiss: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      toast("Link copied.", "success");
    } catch {
      toast("Copy failed — select the URL and copy manually.", "error");
    }
  }, [data.url, toast]);
  return (
    <div className="mt-6 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.07)] p-4 reveal-up">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]">
          <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
          One-shot link ({data.target})
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 font-mono text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          readOnly
          value={data.url}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          className="flex-1 truncate rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 font-mono text-xs text-[rgb(var(--fg-primary))]"
        />
        <Button
          type="button"
          size="lg"
          onClick={() => {
            void copy();
          }}
          className="h-11 shrink-0"
        >
          {copied ? "✓ Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
