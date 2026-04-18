"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";

import {
  removeClientAction,
  sendClientMagicLinkAction,
  updateClientAction,
} from "../actions";

type Contact = {
  id: string;
  email: string;
  name: string;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
};

type Stats = {
  activeDealCount: number;
  totalDealCount: number;
  trackCount: number;
  lastActivity: Date | string;
};

type DealRow = {
  id: string;
  title: string;
  stage:
    | "lead"
    | "booked"
    | "contract_sent"
    | "in_production"
    | "final_review"
    | "paid"
    | "archived";
  createdAt: Date | string;
  updatedAt: Date | string;
  depositPaid: boolean;
  finalPaid: boolean;
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
  dealId: string;
  body: string;
  timestampMs: number;
  createdAt: Date | string;
  fromProducer: boolean;
};

// Chronological timeline event — union of every activity kind we surface.
type TimelineEvent =
  | { kind: "deal"; at: Date; deal: DealRow }
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

const STAGE_LABEL: Record<DealRow["stage"], string> = {
  lead: "Lead",
  booked: "Booked",
  contract_sent: "Contract sent",
  in_production: "In production",
  final_review: "Final review",
  paid: "Paid",
  archived: "Archived",
};

export function ClientTimeline({
  contact,
  stats,
  deals,
  contracts,
  comments,
}: {
  contact: Contact;
  stats: Stats;
  deals: DealRow[];
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

  const timeline: TimelineEvent[] = [
    ...deals.map((d) => ({
      kind: "deal" as const,
      at: toDate(d.createdAt) ?? new Date(0),
      deal: d,
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
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

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
              // Fallback — banner still shows.
            },
          );
        }
      });
    },
    [contact.id, toast],
  );

  const remove = useCallback(() => {
    const confirmed = window.confirm(
      `Delete ${contact.name}? Their deals and contracts stay — only this contact entry is removed.`,
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

  // Link to the new-deal form with email/name prefilled (supported
  // natively by new-deal-form's autocomplete).
  const newDealHref = `/dashboard/deals/new?email=${encodeURIComponent(
    contact.email,
  )}&name=${encodeURIComponent(contact.name)}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
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
                className="block h-10 w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-sm text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
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
                className="block h-10 w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 font-mono text-sm text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
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
        <StatCard label="Active deals" value={stats.activeDealCount} />
        <StatCard label="Total deals" value={stats.totalDealCount} />
        <StatCard label="Track versions" value={stats.trackCount} />
        <StatCard label="Last active" value={formatRelative(stats.lastActivity)} />
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-[rgb(var(--fg-primary))]">Deals</h2>
          <Link
            href={newDealHref}
            className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-3 text-sm font-medium text-[rgb(var(--fg-inverse))] shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.15)] hover:brightness-[1.06]"
          >
            + New deal
          </Link>
        </div>
        {deals.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4 text-sm text-[rgb(var(--fg-secondary))]">
            No deals with {contact.name} yet. Start one — their email is pre-filled.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))]">
            {deals.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/dashboard/deals/${d.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[rgb(var(--bg-overlay))]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[rgb(var(--fg-primary))]">{d.title}</p>
                    <p className="mt-0.5 font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                      {STAGE_LABEL[d.stage]} · Updated {formatRelative(d.updatedAt)}
                    </p>
                  </div>
                  <span aria-hidden className="font-mono text-sm text-[rgb(var(--fg-muted))]">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl text-[rgb(var(--fg-primary))]">Timeline</h2>
        {timeline.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4 text-sm text-[rgb(var(--fg-secondary))]">
            Nothing here yet. Events (deals, contracts, comments) will appear as they happen.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {timeline.map((ev, i) => (
              <TimelineRow key={`${ev.kind}-${String(i)}`} event={ev} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3">
      <p className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p className="sk-num mt-1 font-display text-2xl leading-none">{value}</p>
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  if (event.kind === "deal") {
    return (
      <li className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {formatRelative(event.at)} · Deal created
        </p>
        <Link
          href={`/dashboard/deals/${event.deal.id}`}
          className="mt-1 block font-medium text-[rgb(var(--fg-primary))] hover:underline"
        >
          {event.deal.title}
        </Link>
        <p className="mt-0.5 font-mono text-[0.7rem] text-[rgb(var(--fg-secondary))]">
          {STAGE_LABEL[event.deal.stage]}
        </p>
      </li>
    );
  }
  if (event.kind === "contract") {
    return (
      <li className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {formatRelative(event.at)} · {event.eventName}
        </p>
        <Link
          href="/dashboard/contracts"
          className="mt-1 block font-medium text-[rgb(var(--fg-primary))] hover:underline"
        >
          {event.contract.title}
        </Link>
        <p className="mt-0.5 font-mono text-[0.7rem] text-[rgb(var(--fg-secondary))] capitalize">
          {event.contract.status}
        </p>
      </li>
    );
  }
  // comment
  return (
    <li className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {formatRelative(event.at)} · {event.comment.fromProducer ? "You replied" : "Comment"}
      </p>
      <p className="mt-1 text-sm text-[rgb(var(--fg-primary))]">{event.comment.body}</p>
      <Link
        href={`/dashboard/deals/${event.comment.dealId}`}
        className="mt-2 inline-block font-mono text-[0.7rem] text-[rgb(var(--brand-primary))] hover:underline"
      >
        Open deal →
      </Link>
    </li>
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
