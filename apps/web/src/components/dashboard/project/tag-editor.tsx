"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";

import { useToast } from "~/components/ui/toast";
import { setClientTagsAction } from "~/app/(app)/dashboard/projects/actions";

// Inline tag editor that lives on the Project Room header. Tags are
// rendered as amber pills with an `x` to remove; clicking the "+ Add
// tag" pill opens a tiny inline input with autocomplete drawn from
// `vocabulary` (the producer's previously-used tags).
//
// Editing semantics:
//   - Enter commits the current input
//   - Backspace on an empty input removes the most recently added tag
//   - Esc cancels the open input (no commit)
//   - Clicking `x` on a pill drops that tag immediately
//   - Tags dedupe case-insensitively, canonical casing preserved
//
// The optimistic local state mirrors the server write: flip the set,
// call the Server Action, toast on error and roll back.

type Props = {
  contactId: string;
  initialTags: string[];
  vocabulary: string[];
};

// Normalizes + deduplicates a tag list while keeping the first casing.
// Exposed separately so it can be tested without a DOM.
export function normalizeTags(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function TagEditor({ contactId, initialTags, vocabulary }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [tags, setTags] = useState<string[]>(() => normalizeTags(initialTags));
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the input when the editor opens. Running it in a layout
  // effect keeps the focus racing the browser's default tab order.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  // Autocomplete suggestions = vocabulary minus already-selected tags.
  // Filtered by the in-progress input (prefix + substring match, so
  // "warm" finds "#warm-vocals").
  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    const current = new Set(tags.map((t) => t.toLowerCase()));
    return vocabulary
      .filter((v) => !current.has(v.toLowerCase()))
      .filter((v) => (q ? v.toLowerCase().includes(q) : true))
      .slice(0, 6);
  }, [vocabulary, tags, input]);

  const persist = (next: string[]) => {
    const prev = tags;
    setTags(next);
    startTransition(async () => {
      const res = await setClientTagsAction({
        id: contactId,
        tags: next,
      });
      if (!res.ok) {
        setTags(prev);
        toast(res.error, "error");
        return;
      }
      // Refresh so the CRM list picks up the new tags too — the
      // listWithProjects + detail endpoints both project `tags`.
      router.refresh();
    });
  };

  const addTag = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return;
    const next = normalizeTags([...tags, cleaned]);
    if (next.length === tags.length) {
      // Duplicate — just clear the input without a server round-trip.
      setInput("");
      return;
    }
    setInput("");
    persist(next);
  };

  const removeTag = (idx: number) => {
    const next = tags.filter((_, i) => i !== idx);
    persist(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setInput("");
      setEditing(false);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      e.preventDefault();
      removeTag(tags.length - 1);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${String(i)}`}
          className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-2 py-0.5 text-[0.66rem] font-medium text-[rgb(var(--brand-primary))]"
        >
          {tag.startsWith("#") ? tag : `#${tag}`}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => {
              removeTag(i);
            }}
            disabled={pending}
            className="-mr-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--brand-primary)/0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            <svg
              aria-hidden
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </span>
      ))}

      {editing ? (
        <div className="relative">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              // Commit any pending text on blur so a click-away doesn't
              // throw away work. The small delay lets a click on a
              // suggestion register before blur tears the dropdown down.
              if (input.trim()) addTag(input);
              setTimeout(() => {
                setEditing(false);
              }, 120);
            }}
            placeholder="Add tag…"
            maxLength={80}
            className="h-6 w-32 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-[0.66rem] text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            aria-label="Tag name"
          />
          {suggestions.length > 0 ? (
            <ul
              role="listbox"
              aria-label="Tag suggestions"
              className="sk-pop absolute left-0 top-7 z-20 min-w-[9rem] overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-lg"
            >
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    // aria-selected is purely advisory here — we don't
                    // track a keyboard-cursor across the list, so every
                    // row reports as non-selected until clicked.
                    aria-selected={false}
                    // Use onMouseDown so the suggestion fires before
                    // the input's onBlur tears the dropdown down.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(s);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-xs text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-sunken))]"
                  >
                    {s.startsWith("#") ? s : `#${s}`}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditing(true);
          }}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[rgb(var(--border-subtle))] px-2 py-0.5 text-[0.66rem] text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          + Add tag
        </button>
      )}
    </div>
  );
}
