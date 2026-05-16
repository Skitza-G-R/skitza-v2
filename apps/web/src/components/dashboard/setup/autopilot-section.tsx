"use client";

// Batch G — Autopilot section (Setup → Autopilot tab).
//
// Design principle, straight from the plan: NO rule builder, NO if/
// then, NO conditions. Five named outcomes the producer flips on or
// off. Each row is a prominent card with a large switch; the click
// mutation is fire-and-forget with optimistic state + rollback on
// error. The five named behaviors map 1:1 to the five boolean columns
// on `producers` added in migration 0027.
//
// Event-driven Autopilots (welcome email on booking confirm; comment
// notify on artist comment) are wired today. The three time-based
// ones (unpaid reminder, testimonial request, auto-archive) share a
// single cron endpoint at /api/cron/autopilot that is not yet
// scheduled on Vercel Hobby. The UI deliberately does NOT hint at
// this — the producer enables the behavior and Skitza makes it
// happen whenever the infrastructure allows. The copy says what the
// behavior IS, not when it runs.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { SaveIndicator, useSaveStatus } from "~/components/ui/save-indicator";
import { useToast } from "~/components/ui/toast";
import { updateAutopilot } from "~/app/(producer)/dashboard/settings/actions";

export interface AutopilotSettings {
  welcomeEmail: boolean;
  unpaidReminder: boolean;
  requestTestimonial: boolean;
  commentNotify: boolean;
  autoArchive: boolean;
}

// The five toggles in display order. Order matches the plan: ones the
// producer is most likely to flip first at the top. Labels start with
// a verb, framed as the behavior itself ("Send X", "Remind about Y")
// so there's zero "what does this do" ambiguity.
//
// `status` gates launch scope per PRD §15.1 (locked Round 2, 2026-04-21).
// Only `active` toggles fire at launch. `coming_soon` toggles render
// disabled with a "Coming soon" badge — their DB columns exist but no
// cron/trigger is wired yet (see Phase 6 of the post-launch roadmap).
// Promoting a stub to "active" requires both (a) wiring the behavior
// and (b) updating this array. The test suite will otherwise fail.
export const SWITCHES: readonly {
  key: keyof AutopilotSettings;
  label: string;
  description: string;
  status: "active" | "coming_soon";
}[] = [
  {
    key: "welcomeEmail",
    label: "Send a welcome email when a booking lands",
    description:
      "Confirms the booking to the artist with their session details.",
    status: "active",
  },
  {
    key: "unpaidReminder",
    label: "Remind about unpaid invoices after 7 days",
    description:
      "If an invoice stays open past a week, we nudge you so nothing slips.",
    status: "coming_soon",
  },
  {
    key: "requestTestimonial",
    label: "Ask for a testimonial when a project completes",
    description:
      "Once you mark a project paid, the artist gets a short quote request.",
    status: "coming_soon",
  },
  {
    key: "commentNotify",
    label: "Ping me when an artist comments",
    description:
      "Every time an artist leaves a timestamped comment, it shows up in your Inbox.",
    status: "active",
  },
  {
    key: "autoArchive",
    label: "Auto-archive projects 30 days after final payment",
    description:
      "Keeps your Projects list tight. Archived projects are still searchable.",
    status: "coming_soon",
  },
];

export function AutopilotSection({
  initial,
}: {
  initial: AutopilotSettings;
}) {
  const [settings, setSettings] = useState<AutopilotSettings>(initial);
  const [pendingKey, setPendingKey] = useState<keyof AutopilotSettings | null>(
    null,
  );
  // Which field most recently saved — the `<SaveIndicator>` in that
  // row flashes "Saved ✓". null = no recent save → nothing to flash.
  const [lastSavedKey, setLastSavedKey] = useState<keyof AutopilotSettings | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function flip(key: keyof AutopilotSettings) {
    const prev = settings[key];
    const next = !prev;
    // Optimistic update — the switch flips instantly; a server error
    // rolls it back and surfaces a toast. Most producers will never
    // see an error (auth-scoped UPDATE is cheap), and the optimistic
    // path is what makes the UI feel like a hardware switch.
    setSettings((s) => ({ ...s, [key]: next }));
    setPendingKey(key);
    setLastSavedKey(key);
    startTransition(async () => {
      const res = await updateAutopilot({ key, enabled: next });
      setPendingKey(null);
      if (!res.ok) {
        setSettings((s) => ({ ...s, [key]: prev }));
        // Clear the "recent save" on this row — the chip transitions
        // to its error variant via the useSaveStatus hook picking up
        // the saving=false + error signal.
        setLastSavedKey(null);
        toast(res.error, "error");
        return;
      }
      // Drop the heavy toast on success — the inline "Saved ✓" chip
      // is the feedback now. Producers flipping multiple switches no
      // longer cascade 5 toasts into the corner.
      router.refresh();
    });
  }

  return (
    <section>
      {/* Page-level header (settings/page.tsx) hosts the section title
          + description; this section sits flat inside the outer Setup
          container card. */}
      <ul className="divide-y divide-[rgb(var(--border-subtle))]">
        {SWITCHES.map(({ key, label, description, status }) => (
          <ToggleRow
            key={key}
            label={label}
            description={description}
            enabled={settings[key]}
            pending={pendingKey === key}
            // Only the most-recently-acted-on row renders an autosave
            // chip. Other rows stay quiet — the green flash is a
            // targeted piece of feedback, not a persistent state.
            saving={pendingKey === key}
            recentlySaved={lastSavedKey === key}
            comingSoon={status === "coming_soon"}
            onToggle={() => {
              flip(key);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

// ─── ToggleRow ──────────────────────────────────────────────────────
// Full-width row with label + description on the left and a large
// switch on the right. Click anywhere on the row flips it; the visual
// switch is the clickable control (keyboard-accessible via `role=
// "switch"`). Min-height 64px so touch targets stay ≥44px even with
// a 2-line description.
function ToggleRow({
  label,
  description,
  enabled,
  pending,
  saving,
  recentlySaved,
  comingSoon,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  pending: boolean;
  saving: boolean;
  recentlySaved: boolean;
  comingSoon: boolean;
  onToggle: () => void;
}) {
  // The hook owns the "flash for 2s" timing. We pass saving=true while
  // the mutation is in flight, then saving=false after, and the chip
  // transitions saving → saved → idle on its own schedule.
  const saveStatus = useSaveStatus({
    saving,
    error: null,
  });
  return (
    <li
      className={[
        "flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0",
        // Coming-soon rows fade back so the 2 working toggles are the
        // visual focus. The row is still readable (label + description)
        // so producers know what's coming, just not interactive yet.
        comingSoon ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <p
            className="text-sm text-[rgb(var(--fg-primary))]"
            style={{ fontWeight: 600 }}
          >
            {label}
          </p>
          {comingSoon ? (
            // Small muted badge — not a CTA, just information. Mono font
            // matches the "eyebrow" style used elsewhere for technical
            // metadata. Absolute-less so it stays in reading flow next
            // to the label.
            <span className="inline-flex items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              Coming soon
            </span>
          ) : null}
          {!comingSoon && recentlySaved ? (
            <SaveIndicator status={saveStatus} />
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))]">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        // Coming-soon toggles are always disabled. `pending` on an
        // active toggle disables briefly during optimistic mutation.
        disabled={pending || comingSoon}
        onClick={onToggle}
        className={[
          // Slightly larger than the policies-editor switch (14×28 vs
          // 12×24) — these are the primary controls on this tab, so
          // they get a little more visual weight.
          "relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] focus-visible:ring-[rgb(var(--brand-primary))]",
          enabled
            ? "bg-[rgb(var(--brand-primary))]"
            : "bg-[rgb(var(--fg-muted)/0.3)]",
          pending ? "opacity-60" : "",
          comingSoon ? "cursor-not-allowed" : "",
        ].join(" ")}
      >
        <span
          aria-hidden
          className={[
            "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform",
            enabled ? "translate-x-6" : "translate-x-1",
          ].join(" ")}
        />
      </button>
    </li>
  );
}
