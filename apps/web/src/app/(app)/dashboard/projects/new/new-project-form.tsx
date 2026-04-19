"use client";

import { type SyntheticEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { createProject } from "../actions";

type Contact = { id: string; email: string; name: string };

// After-create banner: producer sees the raw share URL ONCE. Same
// one-shot discipline as Lead Links magic URLs.
function IssuedBanner({
  url,
  onDismiss,
  onOpenProject,
}: {
  url: string;
  onDismiss: () => void;
  onOpenProject: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("Link copied. Send it to the artist.", "success");
    } catch {
      toast("Couldn't copy — highlight the link and copy it manually.", "error");
    }
  }
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.07)] p-4 reveal-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))] pulse-green" />
            Project room ready
          </p>
          <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">
            Copy the share link now — you&rsquo;ll only see it once. Send it to the
            artist so they can listen and leave feedback.
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
        <code className="flex-1 truncate rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 font-mono text-xs text-[rgb(var(--fg-primary))]">
          {url}
        </code>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void copy();
          }}
          className="shrink-0"
        >
          {copied ? "✓ Copied" : "Copy link"}
        </Button>
      </div>
      <div className="mt-3">
        <Button type="button" size="sm" variant="secondary" onClick={onOpenProject}>
          Open project →
        </Button>
      </div>
    </div>
  );
}

export function NewProjectForm({
  siteUrl,
  contacts = [],
}: {
  siteUrl: string;
  contacts?: Contact[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [artistEmail, setArtistEmail] = useState("");
  const [issued, setIssued] = useState<{ url: string; id: string } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Client-side fuzzy match against the server-fetched contact list.
  // Cheap (typical producer has dozens, not thousands) and avoids a
  // per-keystroke RPC. Match on either email or name so the producer
  // can type "maya" or "maya@" and find the same row.
  const suggestions = useMemo(() => {
    const q = artistEmail.trim().toLowerCase();
    if (!q || contacts.length === 0) return [];
    return contacts
      .filter(
        (c) =>
          c.email.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [artistEmail, contacts]);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createProject({
        title: title.trim(),
        artistName: artistName.trim(),
        artistEmail: artistEmail.trim(),
      });
      if (res.ok) {
        toast(`"${title.trim()}" created. Send the share link next.`, "success");
        const url = `${siteUrl.replace(/\/$/, "")}/share/${res.data.shareToken}`;
        setIssued({ url, id: res.data.id });
        setTitle("");
        setArtistName("");
        setArtistEmail("");
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="space-y-4">
      {issued ? (
        <IssuedBanner
          url={issued.url}
          onDismiss={() => {
            setIssued(null);
          }}
          onOpenProject={() => {
            router.push(`/dashboard/projects/${issued.id}`);
          }}
        />
      ) : null}

      <form
        onSubmit={onSubmit}
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 reveal-up"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="title">Project title</Label>
            <Input
              id="title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              placeholder="Marcus T. — Full Production"
              required
              maxLength={120}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="artistName">Artist name</Label>
            <Input
              id="artistName"
              type="text"
              value={artistName}
              onChange={(e) => {
                setArtistName(e.target.value);
              }}
              required
              maxLength={80}
            />
          </div>
          <div className="relative">
            <Label htmlFor="artistEmail">Artist email</Label>
            <Input
              id="artistEmail"
              type="email"
              value={artistEmail}
              onChange={(e) => {
                setArtistEmail(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => {
                setShowSuggestions(true);
              }}
              onBlur={() => {
                // Delay so mousedown on a suggestion has time to fire.
                window.setTimeout(() => {
                  setShowSuggestions(false);
                }, 120);
              }}
              autoComplete="off"
              required
            />
            {showSuggestions && suggestions.length > 0 ? (
              <ul
                role="listbox"
                className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-lg"
              >
                {suggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseDown={(ev) => {
                        // onMouseDown (not onClick) so selecting the
                        // row beats the input's onBlur that would hide
                        // the list before a click fires.
                        ev.preventDefault();
                        setArtistName(c.name);
                        setArtistEmail(c.email);
                        setShowSuggestions(false);
                      }}
                      className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[rgb(var(--bg-base))]"
                    >
                      <span className="truncate text-[rgb(var(--fg-primary))]">
                        {c.name}
                      </span>
                      <span className="truncate font-mono text-xs text-[rgb(var(--fg-muted))]">
                        {c.email}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger))]">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </div>
  );
}
