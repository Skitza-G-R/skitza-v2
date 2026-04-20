"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isTypingTarget } from "~/lib/keyboard/use-shortcuts";

// Reusable `/`-activated inline search input for list surfaces (Today
// inbox, Projects list, Music grid). Hooks a window keydown listener
// so pressing `/` outside any input focuses the search — matches the
// Notion / Linear / Slack convention producers expect.
//
// Usage:
//   const [q, setQ] = useListSearch();
//   // filter your rows client-side: rows.filter(r => matches(r, q))
//   <ListSearchInput value={q} onChange={setQ} placeholder="Search…" />
//
// The input itself is always mounted — we keep it visible on all
// viewports for discoverability. The `/` shortcut is just a fast path
// for keyboard-first users; tapping the field still works for mouse/
// touch users who'd never think to press a keyboard slash.

export function useListSearch(initial = ""): {
  value: string;
  setValue: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  focusInput: () => void;
} {
  const [value, setValue] = useState<string>(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const focusInput = useCallback(() => {
    if (!inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!inputRef.current) return;
      // Skip if the search field is ALREADY the focused element —
      // a producer hammering `/` inside the field would just type
      // literal slashes.
      if (document.activeElement === inputRef.current) return;
      e.preventDefault();
      focusInput();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [focusInput]);

  return { value, setValue, inputRef, focusInput };
}

export function ListSearchInput({
  value,
  onChange,
  inputRef,
  placeholder = "Search",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  /** Override when the default "Search" label is ambiguous (e.g. "Search projects"). */
  ariaLabel?: string;
}) {
  return (
    <label className="sk-list-search relative flex items-center">
      <span className="sr-only">{ariaLabel ?? placeholder}</span>
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 text-[rgb(var(--fg-muted))]"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3 3" />
        </svg>
      </span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          // Escape clears + blurs so `/` can re-focus. Feels like
          // the Notion / Linear pattern producers already know.
          if (e.key === "Escape" && value.length > 0) {
            e.stopPropagation();
            onChange("");
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="h-9 w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] pl-8 pr-14 text-sm text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--brand-primary))]"
      />
      {/* `/` hint — mirrors ⌘K chip conventions. Hidden once the user
          is actively typing so it doesn't clutter the input. */}
      {value.length === 0 ? (
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-2 hidden rounded border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-1.5 py-0.5 font-mono text-[0.65rem] text-[rgb(var(--fg-muted))] sm:inline-block"
        >
          /
        </kbd>
      ) : null}
    </label>
  );
}

/**
 * Case-insensitive substring match over one or more fields. Helper so
 * each list surface doesn't reinvent it. Whitespace in the query is
 * tokenized — every token must match some field substring (AND across
 * tokens, OR across fields).
 */
export function listSearchMatches(
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const haystack = fields
    .map((f) => (f ?? "").toLowerCase())
    .join(" ")
    .toLowerCase();
  const tokens = q.split(/\s+/);
  return tokens.every((t) => haystack.includes(t));
}
