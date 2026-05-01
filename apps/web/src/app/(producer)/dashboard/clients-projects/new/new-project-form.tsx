"use client";

import { type SyntheticEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import {
  ValidationHint,
  validateDisplayName,
  validateEmail,
  type ValidationState,
} from "~/components/ui/validation";
import { createProject } from "../actions";

type Contact = { id: string; email: string; name: string };

type Mode = "select" | "selected" | "new";

// After-create banner: producer sees the project-specific invite URL
// ONCE. Same one-shot discipline as Lead Links magic URLs.
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
            Copy the invite link now — you&rsquo;ll only see it once. Send it to the
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
  producerSlug,
  contacts = [],
}: {
  siteUrl: string;
  producerSlug: string | null;
  contacts?: Contact[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [artistEmail, setArtistEmail] = useState("");
  // Touched flags suppress red "Required" hints until the user has
  // moved focus off the field — same pattern as Stripe / Linear.
  const [titleTouched, setTitleTouched] = useState(false);
  const [artistNameTouched, setArtistNameTouched] = useState(false);
  const [artistEmailTouched, setArtistEmailTouched] = useState(false);
  const [issued, setIssued] = useState<{ url: string; id: string } | null>(null);

  // Picker mode. Default to "select" when the producer already has
  // contacts — the common case is "I'm working with someone I've
  // worked with before". First-time producers land in "new" so they
  // don't see an empty list.
  const [mode, setMode] = useState<Mode>(
    contacts.length > 0 ? "select" : "new",
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const titleState: ValidationState = titleTouched
    ? validateDisplayName(title)
    : { kind: "idle" };
  const artistNameState: ValidationState = artistNameTouched
    ? validateDisplayName(artistName)
    : { kind: "idle" };
  const artistEmailState: ValidationState = artistEmailTouched
    ? validateEmail(artistEmail)
    : { kind: "idle" };

  const filteredContacts = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return contacts.slice(0, 8);
    return contacts
      .filter(
        (c) =>
          c.email.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [pickerQuery, contacts]);

  function selectContact(c: Contact) {
    setArtistName(c.name);
    setArtistEmail(c.email);
    setMode("selected");
    setPickerOpen(false);
    setPickerQuery("");
  }

  function startNewClient() {
    setArtistName("");
    setArtistEmail("");
    setMode("new");
    setPickerOpen(false);
    setPickerQuery("");
  }

  function clearSelection() {
    setArtistName("");
    setArtistEmail("");
    setArtistNameTouched(false);
    setArtistEmailTouched(false);
    setMode(contacts.length > 0 ? "select" : "new");
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Block submit if the producer hasn't picked a client yet.
    if (mode === "select") {
      setError("Pick a client or add a new one.");
      return;
    }
    startTransition(async () => {
      const res = await createProject({
        title: title.trim(),
        artistName: artistName.trim(),
        artistEmail: artistEmail.trim(),
      });
      if (res.ok) {
        toast(`"${title.trim()}" created. Send the invite link next.`, "success");
        // Project-specific invite URL — the unguessable token is the
        // capability that gets the artist into THIS project room. The
        // raw value is shown to the producer ONCE; only the persisted
        // copy on `projects.invite_token` is reachable later.
        const url = producerSlug
          ? `${siteUrl.replace(/\/$/, "")}/join/${producerSlug}?invite=${res.data.inviteToken}`
          : "";
        setIssued({ url, id: res.data.id });
        setTitle("");
        setArtistName("");
        setArtistEmail("");
        setTitleTouched(false);
        setArtistNameTouched(false);
        setArtistEmailTouched(false);
        setMode(contacts.length > 0 ? "select" : "new");
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
            router.push(`/dashboard/clients-projects/${issued.id}`);
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
              onBlur={() => {
                setTitleTouched(true);
              }}
              placeholder="Marcus T. — Full Production"
              required
              maxLength={120}
              autoFocus
              aria-invalid={titleState.kind === "invalid" || titleState.kind === "required"}
            />
            <ValidationHint state={titleState} />
          </div>

          {/* Client section. Three sub-views, picked by `mode`. */}
          <div className="sm:col-span-2">
            <Label htmlFor="client">Client</Label>

            {mode === "select" ? (
              <div className="relative">
                <button
                  id="client"
                  type="button"
                  onClick={() => {
                    setPickerOpen((v) => !v);
                  }}
                  className="flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-left text-sm text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-elevated))]"
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                >
                  <span>Pick a client…</span>
                  <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
                    ▾
                  </span>
                </button>
                {pickerOpen ? (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-lg">
                    <div className="border-b border-[rgb(var(--border-subtle))] p-2">
                      <Input
                        type="text"
                        value={pickerQuery}
                        onChange={(e) => {
                          setPickerQuery(e.target.value);
                        }}
                        placeholder="Search clients…"
                        autoFocus
                      />
                    </div>
                    <ul role="listbox" className="max-h-60 overflow-auto">
                      {filteredContacts.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-[rgb(var(--fg-muted))]">
                          No matches.
                        </li>
                      ) : (
                        filteredContacts.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => {
                                selectContact(c);
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
                        ))
                      )}
                    </ul>
                    <div className="border-t border-[rgb(var(--border-subtle))]">
                      <button
                        type="button"
                        onClick={startNewClient}
                        className="flex w-full items-center px-3 py-2 text-left text-sm font-medium text-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--bg-base))]"
                      >
                        + New client
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {mode === "selected" ? (
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[rgb(var(--fg-primary))]">
                    {artistName}
                  </p>
                  <p className="truncate font-mono text-xs text-[rgb(var(--fg-muted))]">
                    {artistEmail}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="shrink-0 font-mono text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
                  aria-label="Change client"
                >
                  × Change
                </button>
              </div>
            ) : null}

            {mode === "new" ? (
              <div className="space-y-3">
                <div>
                  <Input
                    id="artistName"
                    type="text"
                    value={artistName}
                    onChange={(e) => {
                      setArtistName(e.target.value);
                    }}
                    onBlur={() => {
                      setArtistNameTouched(true);
                    }}
                    placeholder="Artist name"
                    required
                    maxLength={80}
                    aria-invalid={
                      artistNameState.kind === "invalid" ||
                      artistNameState.kind === "required"
                    }
                  />
                  <ValidationHint state={artistNameState} />
                </div>
                <div>
                  <Input
                    id="artistEmail"
                    type="email"
                    value={artistEmail}
                    onChange={(e) => {
                      setArtistEmail(e.target.value);
                    }}
                    onBlur={() => {
                      setArtistEmailTouched(true);
                    }}
                    placeholder="Artist email"
                    required
                    aria-invalid={
                      artistEmailState.kind === "invalid" ||
                      artistEmailState.kind === "required"
                    }
                  />
                  <ValidationHint state={artistEmailState} />
                </div>
                {contacts.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("select");
                    }}
                    className="font-mono text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
                  >
                    ← Pick existing client
                  </button>
                ) : null}
              </div>
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
