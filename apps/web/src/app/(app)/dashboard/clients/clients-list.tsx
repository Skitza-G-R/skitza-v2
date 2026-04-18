"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";

import {
  createClientAction,
  removeClientAction,
  sendClientMagicLinkAction,
  updateClientAction,
} from "./actions";

// CRM list view for the producer.
//
// Layout split:
// - md+ → dense Linear-flavoured table (sk-row / sk-num utilities).
// - <md  → stacked cards with tappable action buttons + fixed FAB for
//          adding a new client.
//
// "Send magic link" is the star feature here. One click spins up a
// fresh URL, copies it to the clipboard, AND shows a banner with the
// URL inline so the producer can paste into any channel. The URL is
// one-shot — raw token is never retrievable again.

type ClientRow = {
  id: string;
  email: string;
  name: string;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  activeProjectCount: number;
  totalProjectCount: number;
  lastActivity: Date | string | null;
};

type FilterId = "all" | "active" | "recent";

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Module-scope formatters so we don't rebuild them on every render.
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
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
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  if (abs < min) return "just now";
  if (abs < hr) return relFmt.format(Math.round(diff / min), "minute");
  if (abs < day) return relFmt.format(Math.round(diff / hr), "hour");
  if (abs < 30 * day) return relFmt.format(Math.round(diff / day), "day");
  return dateFmt.format(d);
}

function isRecent(v: Date | string | null | undefined): boolean {
  const d = toDate(v);
  if (!d) return false;
  return Date.now() - d.getTime() < RECENT_WINDOW_MS;
}

export function ClientsList({ initial }: { initial: ClientRow[] }) {
  const router = useRouter();
  const { toast } = useToast();

  // Local mirror of server-rendered list — we mutate optimistically on
  // add/edit/delete. revalidatePath on the action refreshes on next
  // navigation; for this session we stay in-sync by applying the same
  // change locally first.
  const [rows, setRows] = useState<ClientRow[]>(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ClientRow | null>(null);
  const [magicLink, setMagicLink] = useState<{
    clientId: string;
    clientName: string;
    url: string;
    target: "portfolio" | "booking";
  } | null>(null);

  // Listen for the global `c` shortcut (via shortcuts-bridge) so hitting
  // `c` anywhere on /dashboard/clients opens the new-client sheet.
  useEffect(() => {
    function open() {
      setAddOpen(true);
    }
    window.addEventListener("skitza:new-client", open);
    return () => {
      window.removeEventListener("skitza:new-client", open);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === "active" && r.activeProjectCount === 0) return false;
      if (filter === "recent" && !isRecent(r.lastActivity)) return false;
      return true;
    });
  }, [rows, query, filter]);

  const handleCreated = useCallback(
    (row: ClientRow, existed: boolean) => {
      if (!existed) {
        setRows((prev) => {
          const dedup = prev.filter((p) => p.id !== row.id);
          return [row, ...dedup];
        });
      }
      setAddOpen(false);
    },
    [],
  );

  const handleUpdated = useCallback(
    (row: { id: string; name: string; email: string }) => {
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, name: row.name, email: row.email } : r)),
      );
      setEditTarget(null);
    },
    [],
  );

  const handleDeleted = useCallback(
    (id: string) => {
      setRows((prev) => prev.filter((r) => r.id !== id));
    },
    [],
  );

  const handleMagicLink = useCallback(
    (row: ClientRow, payload: { url: string; target: "portfolio" | "booking" }) => {
      setMagicLink({
        clientId: row.id,
        clientName: row.name,
        url: payload.url,
        target: payload.target,
      });
      // Best-effort clipboard copy right away — the banner is the
      // fallback if the browser blocks it (e.g. insecure context).
      // `navigator.clipboard` can still be undefined in HTTP contexts,
      // so guard the property access.
      const clip = navigator.clipboard as Clipboard | undefined;
      if (clip) {
        void clip.writeText(payload.url).then(
          () => {
            toast(`Link for ${row.name} copied.`, "success");
          },
          () => {
            // Silent — the banner already renders a Copy button.
          },
        );
      }
    },
    [toast],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="reveal-up flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Clients
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            Your people.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Everyone who&apos;s booked you, signed a contract, or been added by hand. Send a
            magic link, open their projects, see recent activity.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setAddOpen(true);
          }}
          className="hidden sm:inline-flex"
        >
          + Add client
        </Button>
      </header>

      {magicLink ? (
        <MagicLinkBanner
          data={magicLink}
          onDismiss={() => {
            setMagicLink(null);
          }}
        />
      ) : null}

      <section className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full items-center gap-2 sm:max-w-sm">
          <Input
            type="search"
            inputMode="search"
            placeholder="Search name or email…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            aria-label="Search clients"
          />
        </div>
        <FilterChips value={filter} onChange={setFilter} />
      </section>

      <section className="mt-6 pb-28 sm:pb-8">
        {rows.length === 0 ? (
          <EmptyState
            icon={<PeopleIcon />}
            title="No clients yet."
            description="Skitza auto-adds clients when they book or sign a contract — or you can add one by hand to get started."
            action={
              <Button
                type="button"
                onClick={() => {
                  setAddOpen(true);
                }}
              >
                + Add client
              </Button>
            }
            className="min-h-[60vh] justify-center"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No matches."
            description="Try clearing the filter or search."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] md:block">
              <table className="w-full text-[13px] leading-[1.3]">
                <thead className="bg-[rgb(var(--bg-elevated))] text-left font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium sk-num">Active</th>
                    <th className="px-3 py-2 font-medium sk-num">Total</th>
                    <th className="px-3 py-2 font-medium">Last activity</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <DesktopRow
                      key={row.id}
                      row={row}
                      onEdit={() => {
                        setEditTarget(row);
                      }}
                      onDelete={() => {
                        handleDeleted(row.id);
                      }}
                      onMagicLink={(payload) => {
                        handleMagicLink(row, payload);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="grid gap-3 md:hidden">
              {filtered.map((row) => (
                <MobileCard
                  key={row.id}
                  row={row}
                  onEdit={() => {
                    setEditTarget(row);
                  }}
                  onDelete={() => {
                    handleDeleted(row.id);
                  }}
                  onMagicLink={(payload) => {
                    handleMagicLink(row, payload);
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Mobile floating action button */}
      <button
        type="button"
        aria-label="Add client"
        onClick={() => {
          setAddOpen(true);
        }}
        className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] shadow-[var(--shadow-lg)] transition-transform active:translate-y-[1px] sm:hidden"
      >
        <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {addOpen ? (
        <ClientSheet
          title="Add client"
          submitLabel="Add client"
          onClose={() => {
            setAddOpen(false);
          }}
          onSubmit={async (values) => {
            const res = await createClientAction(values);
            if (!res.ok) return { ok: false, error: res.error };
            const now = new Date();
            const newRow: ClientRow = {
              id: res.data.id,
              email: res.data.email,
              name: res.data.name,
              firstSeenAt: now,
              lastSeenAt: now,
              activeProjectCount: 0,
              totalProjectCount: 0,
              lastActivity: now,
            };
            if (res.data.existed) {
              toast(`${res.data.name} is already in your list. Opening their page.`, "info");
              handleCreated(newRow, true);
              router.push(`/dashboard/clients/${res.data.id}`);
            } else {
              toast(`Added ${res.data.name}.`, "success");
              handleCreated(newRow, false);
            }
            return { ok: true };
          }}
        />
      ) : null}

      {editTarget ? (
        <ClientSheet
          title="Edit client"
          submitLabel="Save changes"
          initial={{ name: editTarget.name, email: editTarget.email }}
          onClose={() => {
            setEditTarget(null);
          }}
          onSubmit={async (values) => {
            const res = await updateClientAction({
              id: editTarget.id,
              name: values.name,
              email: values.email,
            });
            if (!res.ok) return { ok: false, error: res.error };
            toast(`Updated ${res.data.name}.`, "success");
            handleUpdated(res.data);
            return { ok: true };
          }}
        />
      ) : null}
    </div>
  );
}

function FilterChips({
  value,
  onChange,
}: {
  value: FilterId;
  onChange: (v: FilterId) => void;
}) {
  const items: { id: FilterId; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "recent", label: "Recent" },
  ];
  return (
    <div role="tablist" aria-label="Filter clients" className="flex items-center gap-1">
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => {
              onChange(item.id);
            }}
            className={`h-9 rounded-[var(--radius-md)] px-3 font-mono text-[0.7rem] uppercase tracking-wider transition-colors ${
              active
                ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] border border-[rgb(var(--border-strong))]"
                : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-elevated))]"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function DesktopRow({
  row,
  onEdit,
  onDelete,
  onMagicLink,
}: {
  row: ClientRow;
  onEdit: () => void;
  onDelete: () => void;
  onMagicLink: (payload: { url: string; target: "portfolio" | "booking" }) => void;
}) {
  const router = useRouter();
  return (
    <tr
      className="h-11 cursor-pointer border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] transition-colors duration-[140ms] ease-out hover:bg-[rgb(var(--bg-overlay))]"
      onClick={() => {
        router.push(`/dashboard/clients/${row.id}`);
      }}
    >
      <td className="px-3 py-0 text-[rgb(var(--fg-primary))]">
        <span className="font-medium">{row.name}</span>
      </td>
      <td className="px-3 py-0 font-mono text-xs text-[rgb(var(--fg-secondary))]">{row.email}</td>
      <td className="px-3 py-0 sk-num">
        {row.activeProjectCount > 0 ? (
          <span className="text-[rgb(var(--brand-primary))]">{row.activeProjectCount}</span>
        ) : (
          <span className="text-[rgb(var(--fg-muted))]">0</span>
        )}
      </td>
      <td className="px-3 py-0 sk-num text-[rgb(var(--fg-secondary))]">{row.totalProjectCount}</td>
      <td className="px-3 py-0 text-[rgb(var(--fg-secondary))]">
        {formatRelative(row.lastActivity)}
      </td>
      <td className="px-3 py-0 text-right">
        <RowActions
          row={row}
          variant="desktop"
          onEdit={onEdit}
          onDelete={onDelete}
          onMagicLink={onMagicLink}
        />
      </td>
    </tr>
  );
}

function MobileCard({
  row,
  onEdit,
  onDelete,
  onMagicLink,
}: {
  row: ClientRow;
  onEdit: () => void;
  onDelete: () => void;
  onMagicLink: (payload: { url: string; target: "portfolio" | "booking" }) => void;
}) {
  return (
    <li className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      <Link
        href={`/dashboard/clients/${row.id}`}
        className="block p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg leading-tight text-[rgb(var(--fg-primary))]">
              {row.name}
            </p>
            <p className="mt-1 truncate font-mono text-xs text-[rgb(var(--fg-secondary))]">
              {row.email}
            </p>
          </div>
          {row.activeProjectCount > 0 ? (
            <span className="shrink-0 rounded-full bg-[rgb(var(--brand-primary)/0.14)] px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
              {row.activeProjectCount} active
            </span>
          ) : null}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          <Stat label="Active" value={String(row.activeProjectCount)} />
          <Stat label="Total" value={String(row.totalProjectCount)} />
          <Stat label="Last" value={formatRelative(row.lastActivity)} />
        </dl>
      </Link>
      <div className="flex items-center justify-stretch gap-2 border-t border-[rgb(var(--border-subtle))] p-3">
        <RowActions
          row={row}
          variant="mobile"
          onEdit={onEdit}
          onDelete={onDelete}
          onMagicLink={onMagicLink}
        />
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-[rgb(var(--bg-base))] px-2 py-2">
      <dt className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </dt>
      <dd className="sk-num mt-1 font-display text-base leading-tight">{value}</dd>
    </div>
  );
}

function RowActions({
  row,
  variant,
  onEdit,
  onDelete,
  onMagicLink,
}: {
  row: ClientRow;
  variant: "desktop" | "mobile";
  onEdit: () => void;
  onDelete: () => void;
  onMagicLink: (payload: { url: string; target: "portfolio" | "booking" }) => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const issue = useCallback(
    (target: "portfolio" | "booking") => {
      startTransition(async () => {
        const res = await sendClientMagicLinkAction({ id: row.id, target });
        if (res.ok) {
          onMagicLink({ url: res.data.url, target: res.data.target });
        } else {
          toast(res.error, "error");
        }
      });
    },
    [row.id, onMagicLink, toast],
  );

  const remove = useCallback(() => {
    const confirmed = window.confirm(
      `Delete ${row.name}? Their projects and contracts stay — only this contact entry is removed.`,
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await removeClientAction({ id: row.id });
      if (res.ok) {
        toast(`${row.name} removed.`, "info");
        onDelete();
      } else {
        toast(res.error, "error");
      }
    });
  }, [row.id, row.name, onDelete, toast]);

  // Stop row-click navigation bubbling when the producer hits an action
  // button inside the row. Applied on every click handler below.
  const stop = useCallback((fn: () => void) => {
    return (ev: React.MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      fn();
    };
  }, []);

  if (variant === "desktop") {
    return (
      <div className="inline-flex items-center gap-1">
        <IconButton
          label="Send magic link"
          disabled={pending}
          onClick={stop(() => {
            issue("booking");
          })}
        >
          <LinkIcon />
        </IconButton>
        <IconButton label="Edit" disabled={pending} onClick={stop(onEdit)}>
          <PencilIcon />
        </IconButton>
        <IconButton label="Delete" disabled={pending} onClick={stop(remove)} danger>
          <TrashIcon />
        </IconButton>
      </div>
    );
  }

  // Mobile — full-width buttons with text labels. Three equal columns
  // so tap targets are ≥ 44×44.
  return (
    <>
      <Button
        type="button"
        size="sm"
        className="h-11 flex-1"
        disabled={pending}
        onClick={stop(() => {
          issue("booking");
        })}
      >
        <LinkIcon /> Link
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-11 flex-1"
        disabled={pending}
        onClick={stop(onEdit)}
      >
        <PencilIcon /> Edit
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="h-11 flex-1"
        disabled={pending}
        onClick={stop(remove)}
      >
        <TrashIcon /> Delete
      </Button>
    </>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger = false,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-transparent transition-colors ${
        danger
          ? "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--fg-danger)/0.08)] hover:text-[rgb(var(--fg-danger))]"
          : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
      } disabled:pointer-events-none disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function ClientSheet({
  title,
  submitLabel,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial?: { name: string; email: string };
  onSubmit: (values: { name: string; email: string }) => Promise<
    { ok: true } | { ok: false; error: string }
  >;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  // Autofocus the first field on open — a small mobile ergonomics win
  // so the keyboard pops up right away.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Escape closes the sheet. Delegates to document so the form itself
  // doesn't need tabIndex juggling.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function submit(ev: SyntheticEvent<HTMLFormElement>) {
    ev.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      setError("Name and email are both required.");
      return;
    }
    startTransition(async () => {
      const res = await onSubmit({ name: trimmedName, email: trimmedEmail });
      if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-sheet-title"
      onMouseDown={(ev) => {
        // Backdrop-click-to-close, but only if the target IS the
        // backdrop itself (otherwise clicking inside the panel would
        // dismiss too).
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]">
        <div className="flex items-center justify-between">
          <h2
            id="client-sheet-title"
            className="font-display text-xl text-[rgb(var(--fg-primary))]"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
          >
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="client-name">Name</Label>
            <Input
              id="client-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              maxLength={200}
              autoComplete="name"
              required
            />
          </div>
          <div>
            <Label htmlFor="client-email">Email</Label>
            <Input
              id="client-email"
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={pending} className="flex-1 sm:flex-initial">
              {pending ? "Saving…" : submitLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MagicLinkBanner({
  data,
  onDismiss,
}: {
  data: {
    clientId: string;
    clientName: string;
    url: string;
    target: "portfolio" | "booking";
  };
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
        <div>
          <p className="flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
            One-shot link for {data.clientName}
          </p>
          <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">
            Copy this URL and send to {data.clientName} via your favourite channel. It routes
            them to your {data.target === "booking" ? "booking page" : "portfolio"}. We don&apos;t
            store the raw token — once you dismiss this, it&apos;s gone.
          </p>
        </div>
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

// -- Icons ----------------------------------------------------------

function PeopleIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="3.5" />
      <path d="M3 19c.8-3 3.5-5 6-5s5.2 2 6 5" />
      <circle cx="17" cy="7" r="2.5" />
      <path d="M15.5 14c2.2 0 4.2 1.5 5 4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
