"use client";

import type { RecentUpload } from "~/server/trpc/routers/producer";

// Story 04 — ContextualActions.
//
// Replaces the 8-button QuickActions strip from PR #47 with 3 priority-
// picked context-aware cards. The producer sees 1–3 things they should
// probably do next, derived from current state — not a menu.
//
// Priority algorithm (top-3 win — see story spec
// docs/plans/stories/today-redesign-04-contextual-actions.md):
//   1. reply-unresolved      if unresolvedItems > 0
//   2. continue-track        if recentUploads.length > 0
//   3. send-invoice          if activeProjectsCount > 0
//   4. share-link            if shareUrl !== null
//   5. set-slug              if shareUrl === null  (paired with no share-link)
//   6. add-offline-client    always (deterministic fallback)
//   7. new-project           always (final fallback)
//
// Always returns exactly 3 cards. Day-1 producer with slug set gets
// share-link + add-offline-client + new-project. Without slug, falls
// through to set-slug + add-offline-client + new-project — set-slug is
// the highest-leverage next action when a producer hasn't picked a
// share URL yet, so it ranks above the offline-client option.
//
// Card style mirrors the polished PrimaryButton from PR #47: border +
// bg-elevated + brand-primary inset bar on hover. CSS vars only, no
// hex. The RTL-aware inset shadow flips per direction so the accent
// bar is always on the start edge.

export interface ContextualActionsProps {
  unresolvedItems: number;
  recentUploads: RecentUpload[];
  activeProjectsCount: number;
  shareUrl: string | null;
}

// One picked action — discriminated by `href` (anchor) vs `onClick`
// (button). `href` and `onClick` are mutually exclusive: cards that
// navigate use href, cards that fire side effects (wa.me share) use
// onClick. The renderer dispatches on which is present.
export interface ActionCard {
  id:
    | "reply-unresolved"
    | "continue-track"
    | "send-invoice"
    | "share-link"
    | "set-slug"
    | "add-offline-client"
    | "new-project";
  label: string;
  description: string;
  href?: string;
  onClick?: () => void;
}

// Pure function — no React, no DOM. Tested directly in
// contextual-actions.test.tsx. Exported for testability + so the
// Story 06 wrapper can pre-compute on the server if it ever wants to.
export function pickActions({
  unresolvedItems,
  recentUploads,
  activeProjectsCount,
  shareUrl,
}: ContextualActionsProps): ActionCard[] {
  const candidates: ActionCard[] = [];

  // Priority 1: Reply to N unresolved.
  if (unresolvedItems > 0) {
    // Cast to String() rather than template-literal to keep
    // restrict-template-expressions happy without changing output.
    const count = String(unresolvedItems);
    candidates.push({
      id: "reply-unresolved",
      label: `Reply to ${count}`,
      // Singular vs plural copy — pinned by the test.
      description:
        unresolvedItems === 1
          ? "1 unresolved item"
          : `${count} unresolved items`,
      href: "/dashboard?filter=unresolved",
    });
  }

  // Priority 2: Continue with the most-recent track. Uses the top
  // upload's title + project context for a deep, specific CTA.
  const top = recentUploads[0];
  if (top) {
    candidates.push({
      id: "continue-track",
      label: `Continue with ${top.title}`,
      description: `In ${top.projectClientName}'s project`,
      href: `/dashboard/clients-projects/${top.projectId}?tab=music`,
    });
  }

  // Priority 3: Send next invoice. v1 routes to /dashboard/clients-projects;
  // a future filter for `final_review` is post-redesign work.
  if (activeProjectsCount > 0) {
    candidates.push({
      id: "send-invoice",
      label: "Send next invoice",
      description: "Bill the work you've done",
      href: "/dashboard/clients-projects",
    });
  }

  // Priority 4: Share your link via WhatsApp. Same wa.me logic that
  // shipped in PR #47's QuickActions: no phone number → OS picks the
  // share target (mobile = WhatsApp app, desktop = Web). Text is
  // encodeURIComponent'd so spaces + colons survive the URL.
  if (shareUrl) {
    const link = shareUrl;
    candidates.push({
      id: "share-link",
      label: "Share your link",
      description: "Get your next booking",
      onClick: () => {
        const text = `Check out my studio: ${link}`;
        const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, "_blank", "noopener,noreferrer");
      },
    });
  }

  // Priority 5: Set your slug. Only relevant when shareUrl is null —
  // day-1 producer who hasn't picked a slug yet. Without this, the
  // pre-slug producer would only have add-offline-client + new-project
  // as fallbacks (2 cards) and the algorithm couldn't guarantee 3.
  // Routing matches the existing missing-slug affordance from PR #47.
  if (!shareUrl) {
    candidates.push({
      id: "set-slug",
      label: "Set your share link",
      description: "Pick your /p/ URL",
      href: "/dashboard/settings?section=profile",
    });
  }

  // Priority 6: Add offline client. Deterministic always-on fallback
  // for day-1 producers. The `?mode=offline` query is a hint to the
  // /projects/new page that the producer is creating a record for a
  // walk-in / phone client (not a Skitza-mediated lead). Wiring of
  // that flag is post-redesign work — for now the page just falls
  // through to its default new-project flow.
  candidates.push({
    id: "add-offline-client",
    label: "Add offline client",
    description: "Track work outside Skitza",
    href: "/dashboard/clients-projects/new?mode=offline",
  });

  // Priority 7: Start a new project. Final deterministic fallback.
  candidates.push({
    id: "new-project",
    label: "Start a new project",
    description: "Track new work",
    href: "/dashboard/clients-projects/new",
  });

  // Always exactly 3.
  return candidates.slice(0, 3);
}

// --- Render -----------------------------------------------------

export function ContextualActions(props: ContextualActionsProps) {
  const actions = pickActions(props);
  return (
    // Per UX-critic on PR #48: added section eyebrow + heading so
    // ContextualActions reads as a peer to Inbox / RecentUploadsShelf
    // / Pulse — without it, the 3 cards just appeared with no
    // signposting and broke the page's editorial rhythm. Section
    // spacing owned by the page-level `space-y-12` wrapper.
    <section
      aria-labelledby="contextual-actions-heading"
      data-tour-id="contextual-actions"
    >
      <div className="mb-4">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Suggested
        </p>
        <h2
          id="contextual-actions-heading"
          className="mt-1 font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]"
        >
          Next move
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {actions.map((a) => (
          <ActionCardView key={a.id} action={a} />
        ))}
      </div>
    </section>
  );
}

// Card style matches PR #47's PrimaryButton primitive (see
// quick-actions.tsx). The hover affordance is:
//   - sk-lift = subtle -1px transform + shadow lean
//   - hover:border = brand-primary at 0.4 alpha
//   - hover:shadow inset 3px = brand-primary accent bar on the start edge
//   - rtl:hover:shadow inset -3px = same bar, flipped to the start edge in RTL
// Every alpha + color goes through CSS vars (CLAUDE.md style rule).
function ActionCardView({ action }: { action: ActionCard }) {
  // Per UX-critic on PR #48: lifted `min-h-[84px]` → `min-h-[112px]`
  // and `p-4 ps-5` → `p-5 ps-6` so the row has equal visual weight to
  // the PulseCard above it (was reading as "after-thought below the
  // hero"). 112px matches Linear's quick-action card density.
  const classes =
    "sk-lift flex min-h-[112px] flex-col items-start justify-center gap-1.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 ps-6 text-start transition-all hover:border-[rgb(var(--brand-primary)/0.4)] hover:shadow-[inset_3px_0_0_rgb(var(--brand-primary))] rtl:hover:shadow-[inset_-3px_0_0_rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]";

  const content = (
    <>
      <span className="text-[0.95rem] font-semibold text-[rgb(var(--fg-primary))]">
        {action.label}
      </span>
      <span className="text-xs text-[rgb(var(--fg-secondary))]">
        {action.description}
      </span>
    </>
  );

  if (action.href) {
    return (
      <a href={action.href} className={classes}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={action.onClick} className={classes}>
      {content}
    </button>
  );
}
