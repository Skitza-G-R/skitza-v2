"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  paletteSearch,
  type PaletteResult,
} from "~/app/(app)/dashboard/palette-actions";

// ⌘K / Ctrl+K command palette. Mounted once from AppShell so every
// dashboard page gets it without ceremony. Filtering happens server-
// side (producer-scoped ilike across deals/contacts/contracts) — we
// tell cmdk `shouldFilter={false}` so its built-in client filter doesn't
// fight the server results. Actions are filtered client-side since
// they're static and tiny.
//
// Behaviours worth noting:
// - Empty query → server returns "recents", so the palette is useful
//   the moment it opens.
// - 100ms debounce on input; enough to coalesce typing, short enough
//   that it still feels instant.
// - `>` prefix restricts to actions (mirrors Raycast).

type Action = {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<PaletteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global shortcut: ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Desktop-only: the Tauri ⌥⌘Space global shortcut emits a window
  // event that the desktop menu bridge converts into this one. Opens
  // the palette even when the window was backgrounded.
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
    };
    window.addEventListener("skitza:open-palette", onOpen);
    return () => {
      window.removeEventListener("skitza:open-palette", onOpen);
    };
  }, []);

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
        id: "new-deal",
        label: "New deal",
        shortcut: "N",
        run: () => {
          setOpen(false);
          router.push("/dashboard/deals/new");
        },
      },
      {
        id: "goto-pipeline",
        label: "Go to pipeline",
        shortcut: "G P",
        run: () => {
          setOpen(false);
          router.push("/dashboard");
        },
      },
      {
        id: "goto-contracts",
        label: "Go to contracts",
        shortcut: "G C",
        run: () => {
          setOpen(false);
          router.push("/dashboard/contracts");
        },
      },
      {
        id: "goto-bookings",
        label: "Go to bookings",
        shortcut: "G B",
        run: () => {
          setOpen(false);
          router.push("/dashboard/booking");
        },
      },
      {
        id: "goto-settings",
        label: "Go to settings",
        shortcut: "G S",
        run: () => {
          setOpen(false);
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

  const gotoDeal = useCallback(
    (id: string) => {
      setOpen(false);
      router.push(`/dashboard/deals/${id}`);
    },
    [router],
  );

  if (!open) return null;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed inset-0 z-[60] grid place-items-start pt-[10vh]"
    >
      {/* Backdrop — button so Esc/click both close and it's keyboard-reachable. */}
      <button
        type="button"
        aria-label="Close command palette"
        onClick={() => {
          setOpen(false);
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
              placeholder="Search deals, clients, contracts, or > actions..."
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

            {result?.deals.length ? (
              <Command.Group heading={`Deals (${String(result.deals.length)})`}>
                {result.deals.map((d) => (
                  <Command.Item
                    key={d.id}
                    value={`deal ${d.title} ${d.id}`}
                    onSelect={() => {
                      gotoDeal(d.id);
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
                      setOpen(false);
                      router.push(
                        `/dashboard/deals/new?email=${encodeURIComponent(c.email)}`,
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

            {result?.contracts.length ? (
              <Command.Group heading={`Contracts (${String(result.contracts.length)})`}>
                {result.contracts.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`contract ${c.title}`}
                    onSelect={() => {
                      setOpen(false);
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
