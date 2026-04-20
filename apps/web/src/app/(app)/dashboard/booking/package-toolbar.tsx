"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { KeyboardHint } from "~/components/ui/keyboard-hint";
import { useHotkey } from "~/lib/keyboard/use-shortcuts";
import {
  findTemplate,
  SERVICE_TEMPLATES,
  type ServiceTemplate,
  type TemplateIcon,
} from "~/lib/service-templates";

import { NewPackageForm, type InitialPackageValues } from "./package-form";

// The "+ New service" toggle + the template row sit next to each other
// on the Services tab. A producer can either:
//
//   (a) click "+ New service" and fill the form from scratch, or
//   (b) click one of the 5 template cards and have the form open
//       pre-filled with that template's defaults (they can still edit
//       every field before hitting Save).
//
// Both paths render the *same* NewPackageForm — the only difference is
// the initialValues passed in. Because the form's EDIT mode is
// identified by `id !== undefined`, template-prefill uses a tiny
// synthetic id ("template:<id>") that we strip back to an empty state
// before the create call; this keeps the form's EDIT vs CREATE fork
// working without a dedicated template mode.
//
// Only this small island is hydrated; the packages grid around it
// remains a Server Component.

// Converts a template → the InitialPackageValues the form accepts.
// The synthetic id prefix `template:` tells the form to route submit
// through createPackage() instead of updatePackage() — we strip it
// down to empty before the call.
function templateToInitial(t: ServiceTemplate): InitialPackageValues {
  return {
    id: `template:${t.id}`,
    name: t.defaults.name,
    description: t.defaults.description,
    durationMin: t.defaults.durationMin,
    sessionCount: t.defaults.sessionCount,
    priceCents: t.defaults.priceCents,
    currency: t.defaults.currency,
    depositPct: t.defaults.depositPct,
    kind: t.defaults.kind,
    locationType: t.defaults.locationType,
    bufferMinutes: t.defaults.bufferMinutes,
    minLeadHours: t.defaults.minLeadHours,
    paymentPlans: [...t.defaults.paymentPlans],
  };
}

export function PackageToolbar() {
  // `open` is a single source of truth:
  //   null   → show the grid
  //   "new"  → blank create form
  //   <tid>  → template-prefilled create form
  const [open, setOpen] = useState<string | null>(null);

  // Surface-scoped `N` — open the new-service form on the Booking →
  // Services page. Layered on top of the global N (= new project);
  // the capture-phase useHotkey wins so producers in this context
  // don't get bounced to /dashboard/projects/new.
  useHotkey("n", () => {
    if (open === null) setOpen("new");
  });

  const activeTemplate =
    open !== null && open !== "new" ? findTemplate(open) : undefined;
  const initialValues = activeTemplate
    ? templateToInitial(activeTemplate)
    : undefined;

  if (open !== null) {
    return (
      <div className="mt-4">
        <NewPackageForm
          onClose={() => {
            setOpen(null);
          }}
          // When initialValues is set, the form's EDIT mode kicks in.
          // For the template path we pass `fromTemplate={true}` so the
          // form routes submit through create, not update, despite the
          // synthetic id.
          {...(initialValues ? { initialValues, fromTemplate: true } : {})}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Template strip — 5 cards in a responsive grid. Card height
          stays compact so this rail doesn't dominate the page; the
          real focus is still the list of services below. */}
      <section aria-labelledby="service-templates-heading">
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <div>
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
              Start from a template
            </p>
            <h3
              id="service-templates-heading"
              className="mt-1 font-display text-base tracking-tight text-[rgb(var(--fg-primary))]"
            >
              Add a standard offering in one click
            </h3>
          </div>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {SERVICE_TEMPLATES.map((t) => (
            <li key={t.id}>
              <TemplateCard
                template={t}
                onUse={() => {
                  setOpen(t.id);
                }}
              />
            </li>
          ))}
        </ul>
      </section>

      <div>
        <KeyboardHint shortcut="N">
          <Button
            onClick={() => {
              setOpen("new");
            }}
          >
            <span className="inline-flex items-center gap-2">
              + New service
              <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-[rgb(var(--fg-inverse)/0.3)] bg-[rgb(var(--fg-inverse)/0.12)] px-1 font-mono text-[0.62rem]">
                N
              </kbd>
            </span>
          </Button>
        </KeyboardHint>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onUse,
}: {
  template: ServiceTemplate;
  onUse: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 transition-colors hover:border-[rgb(var(--border-strong))]">
      <div className="flex items-start gap-2">
        <TemplateIconGlyph icon={template.icon} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9rem] font-medium leading-5 text-[rgb(var(--fg-primary))]">
            {template.title}
          </p>
          <p className="mt-0.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[rgb(var(--fg-muted))]">
            {template.tagline}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onUse}
        className="mt-auto inline-flex min-h-9 items-center justify-center rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary))] px-3 text-xs font-medium text-[rgb(var(--brand-primary))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
      >
        Use template
      </button>
    </div>
  );
}

// Monochrome stroke glyphs — inlined so each card can still adjust
// color via `currentColor` without an extra file. Same visual weight
// as the kind-icons in the Today inbox so Services + Today feel
// like one design language.
function TemplateIconGlyph({ icon }: { icon: TemplateIcon }) {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--brand-primary))]"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon === "mix" ? (
          <>
            <path d="M3 3v10" />
            <path d="M8 1v14" />
            <path d="M13 5v6" />
            <circle cx="3" cy="7" r="1" />
            <circle cx="8" cy="9" r="1" />
            <circle cx="13" cy="8" r="1" />
          </>
        ) : null}
        {icon === "album" ? (
          <>
            <circle cx="8" cy="8" r="6" />
            <circle cx="8" cy="8" r="2" />
          </>
        ) : null}
        {icon === "weekend" ? (
          <>
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5 1.75V4M11 1.75V4" />
            <path d="M5.5 9l1 1 2-2.5" />
          </>
        ) : null}
        {icon === "remote" ? (
          <>
            <rect x="2" y="3" width="12" height="8" rx="1" />
            <path d="M5 14h6" />
            <path d="M8 11v3" />
          </>
        ) : null}
        {icon === "master" ? (
          <>
            <path d="M2 8c3-4 9-4 12 0" />
            <path d="M2 8c3 4 9 4 12 0" />
            <circle cx="8" cy="8" r="1.2" />
          </>
        ) : null}
      </svg>
    </span>
  );
}
