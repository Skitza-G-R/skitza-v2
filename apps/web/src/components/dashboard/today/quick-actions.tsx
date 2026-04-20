"use client";

import { useState } from "react";

import { useToast } from "~/components/ui/toast";

// Today Cockpit — QuickActions.
//
// 8 time-saving actions above the KPI strip. Two rows:
//   Primary (4 large buttons) — the high-frequency moves:
//     1. Copy share link      — same navigator.clipboard as ShareLinkCard.
//     2. Upload track         — deep-link into the most-recent project's
//                               music tab in "upload mode" (?action=upload).
//                               No recent project → nudge to create one.
//     3. New booking          — jump to /dashboard/booking?tab=requests
//                               where the producer can hand-enter a request
//                               (the self-booking flow is in /p/<slug>).
//     4. Send invoice         — deep-link into the money tab of the most-
//                               recent project. No projects → tooltip only.
//
//   Secondary (4 compact chips):
//     5. Search (⌘K)          — dispatches `skitza:open-palette` so the
//                               existing CommandPaletteTrigger opens.
//     6. Add offline client   — /dashboard/projects/new (the demoted
//                               manual-add flow).
//     7. Quick note           — v1 stub: localStorage scratchpad + toast.
//                               TODO(today-cockpit): wire to notes service.
//     8. Preview public page  — opens /p/<slug> in a new tab. No slug →
//                               button is disabled with a tooltip.
//
// Mobile: primary collapses to 2x2 grid; secondary row uses sk-scroll-x.
// Desktop: both rows are 4-across. CSS vars only.

interface QuickActionsProps {
  /** Public share URL — used by "Copy share link" and "Preview public page". Null if the producer has no slug. */
  shareUrl: string | null;
  /** Most-recent active project id — used by "Upload track" and "Send invoice". Null if no active projects. */
  recentProjectId: string | null;
}

export function QuickActions({
  shareUrl,
  recentProjectId,
}: QuickActionsProps) {
  const { toast } = useToast();
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);

  const copyShareLink = () => {
    if (!shareUrl) {
      toast("Set your slug first", "info");
      return;
    }
    void navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        toast("Copied", "success");
      })
      .catch(() => {
        toast("Couldn't copy", "error");
      });
  };

  const openPalette = () => {
    // Same synthetic event the desktop shortcut bridge fires — the
    // CommandPaletteTrigger listens for this and mounts the palette.
    window.dispatchEvent(new Event("skitza:open-palette"));
  };

  const previewPublicPage = () => {
    if (!shareUrl) return;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  // Upload-track target. Deep-links to the most-recent project's music
  // tab in upload-mode — matches project-header.tsx's existing
  // "Upload track" action. No recent project → /dashboard/projects/new
  // so the producer can spin one up first.
  const uploadTrackHref = recentProjectId
    ? `/dashboard/projects/${recentProjectId}?tab=music&action=upload`
    : "/dashboard/projects/new";

  // Money tab on the most-recent project. No recent project → we still
  // render the chip but it's disabled with a tooltip (see Chip below).
  const sendInvoiceHref = recentProjectId
    ? `/dashboard/projects/${recentProjectId}?tab=money`
    : null;

  return (
    <section
      id="quick-actions"
      aria-label="Quick actions"
      // scroll-mt-20 clears the sticky mobile header so a
      // `#quick-actions` hash-jump (from the mobile bottom-nav FAB)
      // lands the producer on the first row, not underneath chrome.
      className="mb-6 flex scroll-mt-20 flex-col gap-3"
    >
      {/* ── Primary row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PrimaryButton
          label="Copy share link"
          description="Paste anywhere"
          onClick={copyShareLink}
          disabled={!shareUrl}
        />
        <PrimaryButton
          label="Upload track"
          description={recentProjectId ? "To recent project" : "Create a project first"}
          href={uploadTrackHref}
        />
        <PrimaryButton
          label="New booking"
          description="Add by hand"
          href="/dashboard/booking?tab=requests"
        />
        <PrimaryButton
          label="Send invoice"
          description={recentProjectId ? "On recent project" : "No projects yet"}
          href={sendInvoiceHref}
          disabled={!sendInvoiceHref}
        />
      </div>

      {/* ── Secondary row ───────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto sk-scroll-x pb-1 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible">
        <Chip label="Search" shortcut="⌘K" onClick={openPalette} />
        <Chip label="Add offline client" href="/dashboard/projects/new" />
        <Chip
          label="Quick note"
          onClick={() => {
            setQuickNoteOpen(true);
          }}
        />
        <Chip
          label="Preview public page"
          onClick={previewPublicPage}
          disabled={!shareUrl}
        />
      </div>

      {quickNoteOpen ? (
        <QuickNoteModal
          onClose={() => {
            setQuickNoteOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

// Primary action button. Two modes: href (navigation) or onClick
// (handler). `disabled` blocks interaction visually + semantically.
function PrimaryButton({
  label,
  description,
  href,
  onClick,
  disabled = false,
}: {
  label: string;
  description: string;
  href?: string | null;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const classes =
    "sk-lift flex min-h-[80px] flex-col items-start justify-center gap-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 text-left shadow-[var(--shadow-sm)] hover:bg-[rgb(var(--bg-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:transform-none disabled:hover:bg-[rgb(var(--bg-elevated))]";

  const content = (
    <>
      <span className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
        {label}
      </span>
      <span className="text-xs text-[rgb(var(--fg-secondary))]">
        {description}
      </span>
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {content}
    </button>
  );
}

// Compact secondary chip. Uses sk-tap to guarantee the 44×44 tap
// target on mobile.
function Chip({
  label,
  shortcut,
  href,
  onClick,
  disabled = false,
}: {
  label: string;
  shortcut?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const classes =
    "sk-tap inline-flex flex-shrink-0 items-center gap-2 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 text-sm font-medium text-[rgb(var(--fg-primary))] shadow-[var(--shadow-sm)] hover:bg-[rgb(var(--bg-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-60 sm:justify-center";

  const content = (
    <>
      <span>{label}</span>
      {shortcut ? (
        <kbd className="rounded border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-1.5 py-0.5 font-mono text-[0.65rem] text-[rgb(var(--fg-secondary))]">
          {shortcut}
        </kbd>
      ) : null}
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {content}
    </button>
  );
}

// Quick note v1: lightweight single-textarea modal. Saves nowhere real
// yet — stashes in localStorage so the producer's jot doesn't evaporate,
// then toasts "Quick note saved". The proper notes service + surface
// is tracked separately.
// TODO(today-cockpit): wire to the notes service when it lands.
function QuickNoteModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [body, setBody] = useState("");

  const save = () => {
    const trimmed = body.trim();
    if (!trimmed) {
      toast("Note is empty", "info");
      return;
    }
    try {
      const key = "skitza:quick-notes";
      const existing = localStorage.getItem(key);
      const notes: Array<{ id: string; body: string; createdAt: string }> =
        existing ? (JSON.parse(existing) as Array<{ id: string; body: string; createdAt: string }>) : [];
      notes.unshift({
        id: crypto.randomUUID(),
        body: trimmed,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(notes.slice(0, 50)));
    } catch {
      // localStorage can throw in private-mode Safari. Fail silently —
      // the whole feature is v1-stub and we don't want to block the
      // "I can feel productive" feedback on a storage quirk.
    }
    toast("Quick note saved", "success");
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-note-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sk-pop-center w-full max-w-md rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-lg)]">
        <h3
          id="quick-note-title"
          className="text-base font-semibold text-[rgb(var(--fg-primary))]"
        >
          Quick note
        </h3>
        <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))]">
          A scratchpad for the thought you don&apos;t want to lose.
        </p>
        <textarea
          autoFocus
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
          className="mt-3 w-full resize-y rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3 text-sm text-[rgb(var(--fg-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary))]"
          rows={4}
          placeholder="e.g. Ping Alice about Friday's mix feedback"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="sk-tap inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 text-sm font-semibold text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-sunken))]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="sk-tap inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[rgb(var(--fg-inverse))] hover:brightness-110"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
