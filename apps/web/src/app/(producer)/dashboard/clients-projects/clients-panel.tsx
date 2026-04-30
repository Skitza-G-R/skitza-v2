"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { useToast } from "~/components/ui/toast";
import { STAGE_LABEL, type Stage } from "~/lib/projects/stages";

import {
  createClient,
  fetchClientDetail,
  removeClient,
  updateClient,
  type ClientDetailData,
} from "./clients-actions";

export type ClientRow = {
  id: string;
  email: string;
  name: string;
  totalProjectCount: number;
  activeProjectCount: number;
  needsAttention: boolean;
  isStale: boolean;
  lastActivityIso: string;
};

export function ClientsPanel({ rows }: { rows: ClientRow[] }) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2
            className="font-display text-base tracking-tight"
            style={{ fontWeight: 700 }}
          >
            Clients
          </h2>
          <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
            Everyone who&apos;s booked, paid, or asked you a question.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAddOpen(true);
          }}
          className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          + Add client
        </button>
      </header>

      {rows.length === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-8 text-center text-sm text-[rgb(var(--fg-secondary))]"
        >
          No clients yet. Share your link to get your first booking.
        </div>
      ) : (
        <ul className="divide-y divide-[rgb(var(--border-subtle))] rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]">
          {rows.map((row) => (
            <ClientRowItem key={row.id} row={row} />
          ))}
        </ul>
      )}

      {addOpen ? (
        <AddClientModal
          onClose={() => {
            setAddOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ClientRowItem({ row }: { row: ClientRow }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ClientDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!detail && !loading) {
      void load();
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetchClientDetail({ id: row.id });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDetail(res.data);
  }

  const lastActivityLabel = formatDateShort(row.lastActivityIso);

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="flex flex-1 items-center gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          <span
            aria-hidden
            className={[
              "inline-block w-3 text-xs text-[rgb(var(--fg-muted))] transition-transform",
              expanded ? "rotate-90" : "",
            ].join(" ")}
          >
            ›
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-sm text-[rgb(var(--fg-primary))]"
                style={{ fontWeight: 600 }}
              >
                {row.name}
              </span>
              {row.needsAttention ? (
                <span
                  aria-label="Needs attention"
                  title="Needs attention"
                  className="inline-block h-2 w-2 flex-none rounded-full bg-[rgb(var(--fg-warning))]"
                />
              ) : null}
              {row.isStale ? (
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                  Stale
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-xs text-[rgb(var(--fg-secondary))]">
              {row.email}
            </div>
          </div>
          <div className="flex flex-none items-center gap-3 text-xs text-[rgb(var(--fg-secondary))]">
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              {row.totalProjectCount} {row.totalProjectCount === 1 ? "project" : "projects"}
            </span>
            <span className="hidden font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] sm:inline">
              {lastActivityLabel}
            </span>
          </div>
        </button>
        <RowMenu
          open={menuOpen}
          setOpen={setMenuOpen}
          onEdit={() => {
            setMenuOpen(false);
            setEditOpen(true);
          }}
          onRemove={() => {
            setMenuOpen(false);
            setRemoveOpen(true);
          }}
        />
      </div>

      {expanded ? (
        <div
          id={`client-detail-${row.id}`}
          className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay)/0.4)] px-4 py-3"
        >
          {loading ? (
            <p className="text-xs text-[rgb(var(--fg-secondary))]">Loading…</p>
          ) : error ? (
            <p className="text-xs text-[rgb(var(--fg-warning))]">{error}</p>
          ) : detail && detail.projects.length === 0 ? (
            <p className="text-xs text-[rgb(var(--fg-secondary))]">
              No projects with this client yet.
            </p>
          ) : detail ? (
            <ul className="divide-y divide-[rgb(var(--border-subtle))]">
              {detail.projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/clients-projects/${p.id}`}
                    className="flex items-center justify-between gap-3 py-2 transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="truncate text-sm text-[rgb(var(--fg-primary))]"
                          style={{ fontWeight: 600 }}
                        >
                          {p.title}
                        </span>
                        <StageBadge stage={p.stage} />
                      </div>
                    </div>
                    <span className="flex-none font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                      Updated {formatDateShort(p.updatedAtIso)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {editOpen ? (
        <EditClientModal
          row={row}
          initialNotes={detail?.contact.notes ?? null}
          onClose={() => {
            setEditOpen(false);
          }}
        />
      ) : null}

      {removeOpen ? (
        <RemoveClientModal
          row={row}
          onClose={() => {
            setRemoveOpen(false);
          }}
        />
      ) : null}
    </li>
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[rgb(var(--brand-primary)/0.12)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--brand-primary))]">
      {STAGE_LABEL[stage]}
    </span>
  );
}

function RowMenu({
  open,
  setOpen,
  onEdit,
  onRemove,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
        }}
        aria-label="Client actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-[var(--radius-sm)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onEdit}
            className="block w-full px-3 py-2 text-left text-xs text-[rgb(var(--fg-primary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:bg-[rgb(var(--bg-overlay))]"
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onRemove}
            className="block w-full px-3 py-2 text-left text-xs text-[rgb(var(--fg-warning))] transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:bg-[rgb(var(--bg-overlay))]"
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AddClientModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    startTransition(async () => {
      const res = await createClient({
        name: name.trim(),
        email: email.trim(),
      });
      setSubmitting(false);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast(
        res.data.existed
          ? "Client already existed."
          : "Client added.",
        "success",
      );
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-client-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-5 py-4">
          <h3
            id="add-client-title"
            className="font-display text-lg tracking-tight"
            style={{ fontWeight: 700 }}
          >
            Add client
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            ×
          </button>
        </header>
        <form onSubmit={submit} className="space-y-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Name
            </span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              maxLength={200}
              className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-4 text-sm font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !email.trim()}
              className="inline-flex h-9 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditClientModal({
  row,
  initialNotes,
  onClose,
}: {
  row: ClientRow;
  initialNotes: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [email, setEmail] = useState(row.email);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const patch: {
      id: string;
      name?: string;
      email?: string;
      notes?: string;
    } = { id: row.id };
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName && trimmedName !== row.name) patch.name = trimmedName;
    if (trimmedEmail && trimmedEmail !== row.email) patch.email = trimmedEmail;
    if (notes !== (initialNotes ?? "")) patch.notes = notes;
    startTransition(async () => {
      const res = await updateClient(patch);
      setSubmitting(false);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Client updated.", "success");
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-client-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-5 py-4">
          <h3
            id="edit-client-title"
            className="font-display text-lg tracking-tight"
            style={{ fontWeight: 700 }}
          >
            Edit client
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            ×
          </button>
        </header>
        <form onSubmit={submit} className="space-y-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Name
            </span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              maxLength={200}
              className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={3}
              maxLength={5000}
              className="rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1.5 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-4 text-sm font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-9 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RemoveClientModal({
  row,
  onClose,
}: {
  row: ClientRow;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function confirm() {
    setSubmitting(true);
    startTransition(async () => {
      const res = await removeClient({ id: row.id });
      setSubmitting(false);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Client removed.", "success");
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-client-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] shadow-xl">
        <header className="border-b border-[rgb(var(--border-subtle))] px-5 py-4">
          <h3
            id="remove-client-title"
            className="font-display text-lg tracking-tight"
            style={{ fontWeight: 700 }}
          >
            Remove client?
          </h3>
        </header>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[rgb(var(--fg-secondary))]">
            Remove <span className="text-[rgb(var(--fg-primary))]">{row.name}</span>{" "}
            from your CRM. Their projects and comments stay in place — only the
            contact entry is removed.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-4 text-sm font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={submitting}
              className="inline-flex h-9 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
