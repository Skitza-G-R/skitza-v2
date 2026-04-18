"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  paletteSearch,
  type PaletteResult,
} from "~/app/(app)/dashboard/palette-actions";

// ⌘K / Ctrl+K command palette. Lazy-loaded by CommandPaletteTrigger
// so cmdk is only pulled into the client bundle when the producer
// actually opens it. Filtering happens server-side (producer-scoped
// ilike across projects/contacts/contracts) — we tell cmdk
// `shouldFilter={false}` so its built-in client filter doesn't fight
// the server results. Actions are filtered client-side since they're
// static and tiny.
//
// Behaviours worth noting:
// - Empty query → server returns "recents", so the palette is useful
//   the moment it opens.
// - 100ms debounce on input; enough to coalesce typing, short enough
//   that it still feels instant.
// - `>` prefix restricts to actions (mirrors Raycast).
//
// Controlled component: `open` + `onClose` come from the trigger so
// the keydown listener can stay mounted without loading cmdk.

type Action = {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<PaletteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search fires whenever the palette is open and the
  // query changes. Cleared on close to drop the stale results.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        setPending(true);
        setErr(null);
        const res = await paletteSearch(query);
        if ("error" in res) {
          setErr(res.error);
          setResult(null);
        } else {
          setResult(res);
        }
        setPending(false);
      })();
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  const actions: Action[] = useMemo(
    () => [
      {
        id: "new-project",
        label: "New project",
        shortcut: "N",
        run: () => {
          onClose();
          router.push("/dashboard/projects/new");
        },
      },
      {
        id: "goto-pipeline",
        label: "Go to pipeline",
        shortcut: "G P",
        run: () => {
          onClose();
          router.push("/dashboard");
        },
      },
      {
        id: "goto-library",
        label: "Go to library",
        shortcut: "G L",
        run: () => {
          onClose();
          router.push("/dashboard/library");
        },
      },
      {
        id: "goto-contracts",
        label: "Go to contracts",
        shortcut: "G N",
        run: () => {
          onClose();
          router.push("/dashboard/contracts");
        },
      },
      {
        id: "goto-bookings",
        label: "Go to bookings",
        shortcut: "G B",
        run: () => {
          onClose();
          router.push("/dashboard/booking");
        },
      },
      {
        id: "goto-settings",
        label: "Go to settings",
        shortcut: "G S",
        run: () => {
          onClose();
          router.push("/dashboard/settings");
        },
      },
    ],
    [router],
  );

  // Filter actions by substring. `>` prefix restricts to actions by
  // stripping the sigil and matching the remainder.
  const visibleActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return actions;
    const bare = q.startsWith(">") ? q.slice(1).trim() : q;
    if (bare === "") return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(bare));
  }, [actions, query]);

  const gotoProject = useCallback(
    (id: string) => {
      onClose();
      router.push(`/dashboard/projects/${id}`);
    },
    [router],
  );

  if (!open) return null;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label="Command palette"
      className="fixed inset-0 z-[60] grid place-items-start pt-[10vh]"
    >
      {/* Backdrop — button so Esc/click both close and it's keyboard-reachable. */}
      <button
        type="button"
        aria-label="Close command palette"
        onClick={() => {
          onClose();
        }}
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
      />
      <div className="relative mx-auto w-full max-w-xl rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-2xl">
        <Command label="Skitza command palette" shouldFilter={false}>
          <div className="flex items-center gap-2 border-b border-[rgb(var(--border-subtle))] px-4 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              ⌘K
            </span>
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search projects, clients, contracts, or > actions..."
              className="w-full bg-transparent text-sm text-[rgb(var(--fg-primary))] outline-none placeholder:text-[rgb(var(--fg-muted))]"
              autoFocus
            />
            {pending && (
              <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                ...
              </span>
            )}
          </div>
          <Command.List className="max-h-[50vh] overflow-y-auto p-1">
            {err && (
              <div className="px-4 py-3 text-xs text-[rgb(var(--fg-danger))]">
                {err}
              </div>
            )}
            <Command.Empty className="px-4 py-6 text-center text-xs text-[rgb(var(--fg-muted))]">
              No results.
            </Command.Empty>

            {visibleActions.length > 0 && (
              <Command.Group heading="Actions">
                {visibleActions.map((a) => (
                  <Command.Item
                    key={a.id}
                    value={`action ${a.label}`}
                    onSelect={a.run}
                    className="group flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-[rgb(var(--fg-primary))] data-[selected=true]:bg-[rgb(var(--bg-overlay))]"
                  >
                    <span>{a.label}</span>
                    {a.shortcut && (
                      <kbd className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                        {a.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {result?.projects.length ? (
              <Command.Group heading={`Projects (${String(result.projects.length)})`}>
                {result.projects.map((d) => (
                  <Command.Item
                    key={d.id}
                    value={`project ${d.title} ${d.id}`}
                    onSelect={() => {
                      gotoProject(d.id);
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-[rgb(var(--fg-primary))] data-[selected=true]:bg-[rgb(var(--bg-overlay))]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[rgb(var(--fg-muted))]">#</span>
                      {d.title}
                    </span>
                    <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                      {d.stage}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {result?.contacts.length ? (
              <Command.Group heading={`Clients (${String(result.contacts.length)})`}>
                {result.contacts.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`client ${c.name} ${c.email}`}
                    onSelect={() => {
                      onClose();
                      router.push(
                        `/dashboard/projects/new?email=${encodeURIComponent(c.email)}`,
                      );
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-[rgb(var(--fg-primary))] data-[selected=true]:bg-[rgb(var(--bg-overlay))]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[rgb(var(--fg-muted))]">@</span>
                      {c.name}
                    </span>
                    <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                      {c.email}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {result?.tracks.length ? (
              <Command.Group heading={`Tracks (${String(result.tracks.length)})`}>
                {result.tracks.map((t) => (
                  <Command.Item
                    key={t.id}
                    value={`track ${t.title} ${t.label}`}
                    onSelect={() => {
                      onClose();
                      router.push(`/dashboard/library?v=${t.id}`);
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-[rgb(var(--fg-primary))] data-[selected=true]:bg-[rgb(var(--bg-overlay))]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[rgb(var(--fg-muted))]">♪</span>
                      {t.title}
                    </span>
                    <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                      {t.label}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {result?.contracts.length ? (
              <Command.Group heading={`Contracts (${String(result.contracts.length)})`}>
                {result.contracts.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`contract ${c.title}`}
                    onSelect={() => {
                      onClose();
                      router.push(`/dashboard/contracts`);
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-[rgb(var(--fg-primary))] data-[selected=true]:bg-[rgb(var(--bg-overlay))]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[rgb(var(--fg-muted))]">$</span>
                      {c.title}
                    </span>
                    <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                      {c.status}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
          <div className="flex items-center justify-between border-t border-[rgb(var(--border-subtle))] px-4 py-2 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
            <span>Esc to close · ↵ to select · ↑↓ navigate</span>
            <span>Skitza</span>
          </div>
        </Command>
      </div>
    </Command.Dialog>
  );
}
