"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { saveQuickNote } from "~/app/(app)/dashboard/quick-note-actions";
import { useToast } from "~/components/ui/toast";

// Today Cockpit — QuickActions.
//
// 8 time-saving actions above the KPI strip. Two rows:
//   Primary (4 large buttons) — the high-frequency moves:
//     1. Copy share link      — same navigator.clipboard as ShareLinkCard.
//     2. Upload track         — deep-link into the most-recent project's
//                               music tab in "upload mode" (?action=upload).
//                               No recent project → nudge to create one.
//     3. New booking          — jump to /dashboard/booking?tab=upcoming
//                               where pending requests surface for producer
//                               approval. (Artist-side booking now lives
//                               behind Clerk signup on /join/<slug> →
//                               artist app Book tab; the public /p/<slug>
//                               self-booking flow is gone per PRD §6.6.)
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
//     8. Preview public page  — opens /join/<slug> in a new tab. No slug →
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
  const t = useTranslations("today.quickActions");
  const tToasts = useTranslations("today.toasts");
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);

  const copyShareLink = () => {
    if (!shareUrl) {
      toast(tToasts("setSlugFirst"), "info");
      return;
    }
    void navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        toast(tToasts("copied"), "success");
      })
      .catch(() => {
        toast(tToasts("couldNotCopy"), "error");
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
      data-tour-id="quick-actions"
      aria-label={t("ariaLabel")}
      // scroll-mt-20 clears the sticky mobile header so a
      // `#quick-actions` hash-jump (from the mobile bottom-nav FAB)
      // lands the producer on the first row, not underneath chrome.
      className="mb-6 flex scroll-mt-20 flex-col gap-3"
    >
      {/* ── Primary row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PrimaryButton
          label={t("copyShareLink")}
          description={t("copyShareLinkHint")}
          onClick={copyShareLink}
          disabled={!shareUrl}
        />
        <PrimaryButton
          label={t("uploadTrack")}
          description={recentProjectId ? t("uploadTrackHint") : t("uploadTrackHintEmpty")}
          href={uploadTrackHref}
        />
        <PrimaryButton
          label={t("newBooking")}
          description={t("newBookingHint")}
          href="/dashboard/booking?tab=upcoming"
        />
        <PrimaryButton
          label={t("sendInvoice")}
          description={recentProjectId ? t("sendInvoiceHint") : t("sendInvoiceHintEmpty")}
          href={sendInvoiceHref}
          disabled={!sendInvoiceHref}
        />
      </div>

      {/* ── Secondary row ───────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto sk-scroll-x pb-1 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible">
        <Chip label={t("search")} shortcut="⌘K" onClick={openPalette} />
        <Chip label={t("addOfflineClient")} href="/dashboard/projects/new" />
        <Chip
          label={t("quickNote")}
          onClick={() => {
            setQuickNoteOpen(true);
          }}
        />
        <Chip
          label={t("previewPublic")}
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
  // Batch C — primary buttons keep their interactive border (they ARE
  // buttons — the border is an affordance, not decoration) but drop
  // the heavy shadow + swap the fill for bg-elevated with a brand-
  // primary accent on the left edge, so the row reads as a module bar
  // rather than four generic boxed cards.
  // `ps-5` replaces the `pl-5` that used to widen the leading padding
  // for the brand-primary inset bar on hover. `text-start` aligns the
  // label + hint to the logical start edge (left in LTR, right in
  // RTL). The hover inset-shadow flips per-direction so the accent
  // bar always lives on the start edge.
  const classes =
    "sk-lift flex min-h-[84px] flex-col items-start justify-center gap-1.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 ps-5 text-start transition-all hover:border-[rgb(var(--brand-primary)/0.4)] hover:bg-[rgb(var(--bg-elevated))] hover:shadow-[inset_3px_0_0_rgb(var(--brand-primary))] rtl:hover:shadow-[inset_-3px_0_0_rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:transform-none disabled:hover:shadow-none";

  const content = (
    <>
      <span className="text-[0.95rem] font-semibold text-[rgb(var(--fg-primary))]">
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

// Quick Note — backed by producer_notes table (audit Task 11, Task C
// of the 2026-04-22 overnight plan). Replaces the v1 localStorage stub
// that didn't sync across devices or survive cache clears.
//
// Flow:
//   1. User types → save button posts body via `saveQuickNote` server
//      action (wraps the producerNotes.save tRPC procedure).
//   2. While the request is in flight, useTransition's `pending` flag
//      disables both buttons + shows a subtle "Saving…" label on Save.
//   3. Success → toast + close. Failure → toast + keep modal open so
//      the body stays and the producer can retry.
function QuickNoteModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const t = useTranslations("today.quickActions.quickNoteModal");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  const save = () => {
    const trimmed = body.trim();
    if (!trimmed) {
      toast(t("emptyToast"), "info");
      return;
    }
    startTransition(async () => {
      const result = await saveQuickNote(trimmed);
      if (result.ok) {
        toast(t("savedToast"), "success");
        onClose();
      } else {
        // Keep the modal + body so the producer can try again or
        // copy the text somewhere safe.
        toast(result.error, "error");
      }
    });
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
          {t("title")}
        </h3>
        <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))]">
          {t("subtitle")}
        </p>
        <textarea
          autoFocus
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
          className="mt-3 w-full resize-y rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3 text-sm text-[rgb(var(--fg-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary))]"
          rows={4}
          placeholder={t("placeholder")}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="sk-tap inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 text-sm font-semibold text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-sunken))] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="sk-tap inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[rgb(var(--fg-inverse))] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving…" : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
