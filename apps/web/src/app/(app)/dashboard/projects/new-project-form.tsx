"use client";

import { type SyntheticEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { createProject } from "./actions";

// After-create banner: producer sees the raw share URL ONCE. Same
// one-shot discipline as Lead Links magic URLs.
function IssuedBanner({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("Share URL copied.", "success");
    } catch {
      toast("Copy failed — select the URL and copy manually.", "error");
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
            Copy this share URL now — the token is one-shot. Send it to the artist so they
            can listen and leave feedback.
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
          {copied ? "✓ Copied" : "Copy URL"}
        </Button>
      </div>
    </div>
  );
}

export function NewProjectForm({ siteUrl }: { siteUrl: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [artistEmail, setArtistEmail] = useState("");
  const [issued, setIssued] = useState<string | null>(null);

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
        toast(`"${title.trim()}" project created.`, "success");
        const url = `${siteUrl.replace(/\/$/, "")}/share/${res.data.shareToken}`;
        setIssued(url);
        setTitle("");
        setArtistName("");
        setArtistEmail("");
        setOpen(false);
        router.refresh();
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
          url={issued}
          onDismiss={() => {
            setIssued(null);
          }}
        />
      ) : null}

      {!open ? (
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          + New project
        </Button>
      ) : (
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
            <div>
              <Label htmlFor="artistEmail">Artist email</Label>
              <Input
                id="artistEmail"
                type="email"
                value={artistEmail}
                onChange={(e) => {
                  setArtistEmail(e.target.value);
                }}
                required
              />
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
