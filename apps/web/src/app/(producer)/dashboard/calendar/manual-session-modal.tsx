"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import type { ProducerManualSessionOptions } from "~/server/domain/session-booking/manual";

import {
  createManualSession,
  previewManualSession,
  type ManualBillingTreatment,
  type ManualWarningCode,
} from "./calendar-actions";

type Preview = Extract<Awaited<ReturnType<typeof previewManualSession>>, { ok: true }>["preview"];

const BILLING_COPY: Readonly<Record<ManualBillingTreatment, { label: string; body: string }>> = {
  included: {
    label: "Included session",
    body: "Uses one session from this project.",
  },
  complimentary: {
    label: "Complimentary",
    body: "Uses no included session.",
  },
  billable_extra: {
    label: "Billable extra",
    body: "Records payment due. No invoice or charge is created.",
  },
};

function newOperationKey(): string {
  return `producer-manual:${globalThis.crypto.randomUUID()}`;
}

function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hours)} hr`;
  return `${String(hours)} hr ${String(rest)} min`;
}

export function ManualSessionModal({
  open,
  onOpenChange,
  options,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  options: ProducerManualSessionOptions;
}) {
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [studioDate, setStudioDate] = useState("");
  const [studioTime, setStudioTime] = useState("");
  const [title, setTitle] = useState("");
  const [billingTreatment, setBillingTreatment] = useState<ManualBillingTreatment | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const operationKey = useRef(newOperationKey());
  const warningHeading = useRef<HTMLHeadingElement>(null);
  const online = useOnlineStatus();
  const { toast } = useToast();

  const client = options.clients.find((candidate) => candidate.id === clientId) ?? null;
  const projects = client?.projects ?? [];
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setProjectId("");
    setStudioDate("");
    setStudioTime("");
    setTitle("");
    setBillingTreatment(null);
    setPreview(null);
    setConfirmWarnings(false);
    setError(null);
    operationKey.current = newOperationKey();
  }, [open]);

  useEffect(() => {
    if (confirmWarnings) warningHeading.current?.focus();
  }, [confirmWarnings]);

  function resetPreview(): void {
    setPreview(null);
    setConfirmWarnings(false);
    setError(null);
    operationKey.current = newOperationKey();
  }

  function chooseClient(nextClientId: string): void {
    setClientId(nextClientId);
    setProjectId("");
    setTitle("");
    setBillingTreatment(null);
    resetPreview();
  }

  function chooseProject(nextProjectId: string): void {
    setProjectId(nextProjectId);
    const next = projects.find((candidate) => candidate.id === nextProjectId);
    setTitle(next?.defaultTitle ?? "");
    setBillingTreatment(next?.defaultTreatment ?? null);
    resetPreview();
  }

  function formInput() {
    const studioStartMin = parseTime(studioTime);
    if (!clientId || !projectId || !studioDate || studioStartMin === null) return null;
    return {
      clientId,
      projectId,
      studioDate,
      studioStartMin,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(billingTreatment ? { billingTreatment } : {}),
    };
  }

  function submit(): void {
    if (isPending) return;
    if (!online) {
      setError("Reconnect to create this session.");
      return;
    }
    const input = formInput();
    if (!input || !billingTreatment) {
      setError("Choose a client, project, date, time, and billing option.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await previewManualSession(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);
      if (result.preview.hardConflicts.length > 0) {
        setError(result.preview.hardConflicts.map((issue) => issue.message).join(" "));
        return;
      }
      if (result.preview.warnings.length > 0) {
        setConfirmWarnings(true);
        return;
      }
      await create(input, []);
    });
  }

  async function create(
    input: NonNullable<ReturnType<typeof formInput>>,
    acknowledgedWarnings: ManualWarningCode[],
  ): Promise<void> {
    if (!billingTreatment) return;
    const result = await createManualSession({
      ...input,
      billingTreatment,
      operationKey: operationKey.current,
      acknowledgedWarnings,
    });
    if (!result.ok) {
      setConfirmWarnings(false);
      setError(result.error);
      return;
    }
    toast("Session confirmed. The artist’s calendar invite is queued.", "success");
    onOpenChange(false);
  }

  function createAnyway(): void {
    const input = formInput();
    if (!input || !preview || !billingTreatment || isPending) return;
    startTransition(async () => {
      await create(
        input,
        preview.warnings.map((warning) => warning.code as ManualWarningCode),
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[94dvh] !max-w-[620px] flex-col gap-0 overflow-hidden !p-0">
        <header className="shrink-0 border-b border-[rgb(var(--border-subtle))] px-5 py-5 pe-16 sm:px-7">
          <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-dark))] uppercase">
            Confirmed booking
          </p>
          <DialogTitle className="mt-1 text-[24px]">New session</DialogTitle>
          <DialogDescription className="mt-1.5">
            Choose an existing client and project. Session length and credit come from the project’s
            package.
          </DialogDescription>
        </header>

        {confirmWarnings && preview ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
            <h2
              ref={warningHeading}
              tabIndex={-1}
              className="font-display text-xl font-bold outline-none"
            >
              Check these warnings
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
              Nothing overlaps another Skitza session, but this time is outside one or more studio
              preferences.
            </p>
            <ul className="mt-5 space-y-3" aria-label="Scheduling warnings">
              {preview.warnings.map((warning) => (
                <li
                  key={warning.code}
                  className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-default))]"
                >
                  {warning.message}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Client" htmlFor="manual-client">
                  <select
                    id="manual-client"
                    value={clientId}
                    onChange={(event) => {
                      chooseClient(event.target.value);
                    }}
                    className={controlClass}
                  >
                    <option value="">Choose a client</option>
                    {options.clients.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Project" htmlFor="manual-project">
                  <select
                    id="manual-project"
                    value={projectId}
                    disabled={!client}
                    onChange={(event) => {
                      chooseProject(event.target.value);
                    }}
                    className={controlClass}
                  >
                    <option value="">
                      {client ? "Choose a project" : "Choose a client first"}
                    </option>
                    {projects.map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        disabled={option.eligibility !== "eligible"}
                      >
                        {option.title}
                        {option.eligibility === "multiple_active_session_packages"
                          ? " — multiple session packages"
                          : option.eligibility === "no_active_session_package"
                            ? " — no active session package"
                            : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Studio date" htmlFor="manual-date">
                  <input
                    id="manual-date"
                    type="date"
                    value={studioDate}
                    onChange={(event) => {
                      setStudioDate(event.target.value);
                      resetPreview();
                    }}
                    className={controlClass}
                  />
                </Field>
                <Field label="Start time" htmlFor="manual-time">
                  <input
                    id="manual-time"
                    type="time"
                    step={900}
                    value={studioTime}
                    onChange={(event) => {
                      setStudioTime(event.target.value);
                      resetPreview();
                    }}
                    className={controlClass}
                    aria-describedby="manual-timezone"
                  />
                  <span id="manual-timezone" className="text-xs text-[rgb(var(--fg-muted))]">
                    Studio time · {options.studioTimeZone}
                  </span>
                </Field>
              </div>

              <Field label="Session title" htmlFor="manual-title" optional>
                <input
                  id="manual-title"
                  value={title}
                  maxLength={200}
                  placeholder={project?.defaultTitle ?? "Session"}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    resetPreview();
                  }}
                  className={controlClass}
                />
              </Field>

              {project?.eligibility === "eligible" && project.durationMin ? (
                <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-4 py-3">
                  <p className="text-sm font-semibold text-[rgb(var(--fg-default))]">
                    {project.productName}
                  </p>
                  <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
                    {durationLabel(project.durationMin)} · fixed by this project’s package
                  </p>
                </div>
              ) : null}

              {project?.eligibility === "eligible" ? (
                <fieldset>
                  <legend className="text-sm font-semibold text-[rgb(var(--fg-default))]">
                    Billing treatment
                  </legend>
                  <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
                    {project.remainingIncluded === null
                      ? "Unlimited included sessions"
                      : `${String(project.remainingIncluded)} included session${project.remainingIncluded === 1 ? "" : "s"} remaining`}
                  </p>
                  <div className="mt-3 grid gap-2">
                    {project.allowedTreatments.map((treatment) => (
                      <label
                        key={treatment}
                        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] px-3.5 py-3 has-[:checked]:border-[rgb(var(--brand-primary))] has-[:checked]:bg-[rgb(var(--brand-primary)/0.07)]"
                      >
                        <input
                          type="radio"
                          name="manual-billing"
                          value={treatment}
                          checked={billingTreatment === treatment}
                          onChange={() => {
                            setBillingTreatment(treatment);
                            resetPreview();
                          }}
                          className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand-primary-dark))]"
                        />
                        <span>
                          <span className="block text-sm font-semibold">
                            {BILLING_COPY[treatment].label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-snug text-[rgb(var(--fg-muted))]">
                            {BILLING_COPY[treatment].body}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {isPending ? (
                <p role="status" className="text-sm text-[rgb(var(--fg-secondary))]">
                  Checking availability…
                </p>
              ) : null}
              {error ? (
                <p
                  role="alert"
                  className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-danger-text))]"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        )}

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-7 sm:pb-4">
          {confirmWarnings ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setConfirmWarnings(false);
                }}
                className={secondaryButtonClass}
              >
                Back
              </button>
              <button
                type="button"
                disabled={isPending || !online}
                onClick={createAnyway}
                className={primaryButtonClass}
              >
                {isPending ? "Creating…" : "Create anyway"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  onOpenChange(false);
                }}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending || !online}
                onClick={submit}
                className={primaryButtonClass}
              >
                {isPending ? "Checking…" : "Create session"}
              </button>
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  optional = false,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-semibold text-[rgb(var(--fg-default))]">
        {label}
        {optional ? (
          <span className="ms-1 font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

const controlClass =
  "h-11 min-w-0 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-3 text-sm text-[rgb(var(--fg-default))] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] disabled:cursor-not-allowed disabled:opacity-55";
const secondaryButtonClass =
  "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] disabled:opacity-50";
const primaryButtonClass =
  "sk-cta-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-bold text-[rgb(var(--bg-sidebar))] disabled:cursor-not-allowed disabled:opacity-50";
