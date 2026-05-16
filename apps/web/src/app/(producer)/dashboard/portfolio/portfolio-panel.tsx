"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  PortfolioSection,
  type PortfolioTrackRow,
} from "~/components/dashboard/setup/portfolio-section";
import { useToast } from "~/components/ui/toast";

import {
  addExternalLink,
  addPortfolioFromLibrary,
  removeExternalLink,
  type ExternalPlatformValue,
} from "./actions";

export type ExternalLinkRow = {
  id: string;
  platform: ExternalPlatformValue;
  url: string;
  title: string | null;
};

export type LibraryPickRow = {
  versionId: string;
  trackTitle: string;
  projectTitle: string;
  artistName: string;
  audioUrl: string | null;
  uploadedAt: string;
};

const PLATFORM_LABEL: Record<ExternalPlatformValue, string> = {
  spotify: "Spotify",
  apple_music: "Apple Music",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  tidal: "Tidal",
  instagram_reels: "Instagram Reels",
};

const PLATFORM_OPTIONS: ExternalPlatformValue[] = [
  "spotify",
  "apple_music",
  "youtube",
  "soundcloud",
  "bandcamp",
  "tidal",
  "instagram_reels",
];

export function PortfolioPanel({
  tracks,
  links,
  library,
  addedAudioUrls,
}: {
  tracks: PortfolioTrackRow[];
  links: ExternalLinkRow[];
  library: LibraryPickRow[];
  addedAudioUrls: string[];
}) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="profile-tracks-heading">
        <header className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2
              id="profile-tracks-heading"
              className="font-display text-base tracking-tight"
              style={{ fontWeight: 700 }}
            >
              Tracks
            </h2>
            <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
              Pick tracks from your music library to feature on your public page.
            </p>
          </div>
          <AddFromLibraryButton library={library} addedAudioUrls={addedAudioUrls} />
        </header>
        <PortfolioSection tracks={tracks} />
      </section>

      <hr className="border-t border-[rgb(var(--border-subtle))]" />

      <ExternalLinksSection links={links} />
    </div>
  );
}

function AddFromLibraryButton({
  library,
  addedAudioUrls,
}: {
  library: LibraryPickRow[];
  addedAudioUrls: string[];
}) {
  // F9 — Set built once per render so each library row's lookup is
  // O(1). The list is producer-scoped + capped server-side, so the
  // construction cost is negligible.
  const addedSet = new Set(addedAudioUrls);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(row: LibraryPickRow) {
    if (!row.audioUrl) return;
    // Defensive — the picker disables already-added rows visually, but
    // a stale render could still fire a click. The server also rejects
    // duplicates with a friendly BAD_REQUEST, so this is belt + braces.
    if (addedSet.has(row.audioUrl)) return;
    setPendingId(row.versionId);
    startTransition(async () => {
      const res = await addPortfolioFromLibrary({
        title: row.trackTitle,
        artist: row.artistName,
        audioUrl: row.audioUrl as string,
      });
      setPendingId(null);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
      >
        Add from music library
      </button>

      {open ? (
        // Note: no focus trap — acceptable for v1 internal prototype
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-picker-title"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setOpen(false);
            }}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] shadow-xl">
            <header className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-5 py-4">
              <div>
                <h3
                  id="library-picker-title"
                  className="font-display text-lg tracking-tight"
                  style={{ fontWeight: 700 }}
                >
                  Add from music library
                </h3>
                <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))]">
                  Tracks without audio yet can&rsquo;t be added.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
                aria-label="Close picker"
                className="-mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              >
                ×
              </button>
            </header>
            <div className="overflow-y-auto px-2 py-2">
              {library.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[rgb(var(--fg-secondary))]">
                  Your music library is empty. Upload a track from a project first.
                </p>
              ) : (
                <ul className="divide-y divide-[rgb(var(--border-subtle))]">
                  {library.map((row) => {
                    const alreadyAdded = row.audioUrl
                      ? addedSet.has(row.audioUrl)
                      : false;
                    const noAudio = !row.audioUrl;
                    const disabled = noAudio || alreadyAdded;
                    const pending = pendingId === row.versionId;
                    const date = new Date(row.uploadedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    });
                    return (
                      <li key={row.versionId}>
                        <button
                          type="button"
                          disabled={disabled || pending}
                          onClick={() => {
                            pick(row);
                          }}
                          className={[
                            "flex w-full flex-col items-start gap-1 px-3 py-3 text-left transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                            disabled
                              ? "cursor-not-allowed opacity-50"
                              : "hover:bg-[rgb(var(--bg-overlay))]",
                            pending ? "opacity-60" : "",
                          ].join(" ")}
                        >
                          <span
                            className="text-sm text-[rgb(var(--fg-primary))]"
                            style={{ fontWeight: 600 }}
                          >
                            {row.trackTitle}
                          </span>
                          <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                            {row.projectTitle} · {row.artistName} · {date}
                          </span>
                          {alreadyAdded ? (
                            <span className="mt-1 inline-flex items-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.15)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                              Already added
                            </span>
                          ) : noAudio ? (
                            <span className="mt-1 inline-flex items-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-muted)/0.15)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                              No audio yet
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ExternalLinksSection({ links }: { links: ExternalLinkRow[] }) {
  const [rows, setRows] = useState<ExternalLinkRow[]>(links);
  const [platform, setPlatform] = useState<ExternalPlatformValue>("spotify");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setRows(links);
  }, [links]);

  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    startTransition(async () => {
      const res = await addExternalLink({
        platform,
        url: url.trim(),
        title: title.trim() || null,
      });
      setAdding(false);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      setUrl("");
      setTitle("");
      router.refresh();
    });
  }

  function remove(id: string) {
    setRemovingId(id);
    setRows((all) => all.filter((r) => r.id !== id));
    startTransition(async () => {
      const res = await removeExternalLink({ id });
      setRemovingId(null);
      if (!res.ok) {
        toast(res.error, "error");
        setRows(links);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="profile-links-heading">
      <header className="mb-3">
        <h2
          id="profile-links-heading"
          className="font-display text-base tracking-tight"
          style={{ fontWeight: 700 }}
        >
          External links
        </h2>
        <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
          Where artists can hear more of your work — Spotify, YouTube, and the rest.
        </p>
      </header>

      <form
        onSubmit={submit}
        className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label className="flex flex-col gap-1 sm:w-40">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Platform
          </span>
          <select
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value as ExternalPlatformValue);
            }}
            className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            URL
          </span>
          <input
            type="url"
            required
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
            placeholder="https://"
            className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          />
        </label>
        <label className="flex flex-col gap-1 sm:w-44">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Title (optional)
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            placeholder="Featured single"
            maxLength={120}
            className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          />
        </label>
        <button
          type="submit"
          disabled={adding || !url.trim()}
          className="inline-flex h-9 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add link"}
        </button>
      </form>

      {rows.length === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]"
        >
          No external links yet.
        </div>
      ) : (
        <ul className="divide-y divide-[rgb(var(--border-subtle))]">
          {rows.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.12)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                    {PLATFORM_LABEL[l.platform]}
                  </span>
                  {l.title ? (
                    <span
                      className="text-sm text-[rgb(var(--fg-primary))]"
                      style={{ fontWeight: 600 }}
                    >
                      {l.title}
                    </span>
                  ) : null}
                </div>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))] hover:underline"
                >
                  {l.url}
                </a>
              </div>
              <button
                type="button"
                onClick={() => {
                  remove(l.id);
                }}
                disabled={removingId === l.id}
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removingId === l.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
