"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { SERVICE_TEMPLATES, type ServiceTemplate } from "~/lib/service-templates";
import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";
import { createOnboardingPackage } from "~/app/(onboarding)/onboarding/actions";

import {
  SERVICE_STEP_INDEX,
  SERVICE_STEP_SUBTITLE,
  SERVICE_STEP_TITLE,
  nextRouteAfterService,
  routeOnBackFromService,
  routeOnSkipFromService,
} from "./constants";

type SupportedCurrency = "USD" | "EUR" | "GBP" | "ILS";

const ROLE_TEMPLATE_IDS: Record<string, string[]> = {
  Producer: ["album-package", "weekend-intensive"],
  "Mixing Engineer": ["mix-3h", "remote-feedback"],
  "Mastering Engineer": ["mastering-pass"],
  "Recording Artist": ["weekend-intensive"],
  Songwriter: ["remote-feedback"],
  "Audio Engineer": ["mix-3h", "mastering-pass"],
};

const CUSTOM_ID = "__custom__";

interface DraftValues {
  templateId: string;
  name: string;
  priceDecimal: string;
  durationMin: number;
  depositPct: number;
}

const CUSTOM_BLANK: Omit<DraftValues, "templateId"> = {
  name: "",
  priceDecimal: "",
  durationMin: 60,
  depositPct: 25,
};

function templateToDraft(t: ServiceTemplate): DraftValues {
  return {
    templateId: t.id,
    name: t.defaults.name,
    priceDecimal: (t.defaults.priceCents / 100).toFixed(2),
    durationMin: t.defaults.durationMin,
    depositPct: t.defaults.depositPct,
  };
}

function deriveSuggested(roles: string[]): ServiceTemplate[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const role of roles) {
    const matched = ROLE_TEMPLATE_IDS[role];
    if (!matched) continue;
    for (const id of matched) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  if (ids.length === 0) return [...SERVICE_TEMPLATES];
  return ids
    .map((id) => SERVICE_TEMPLATES.find((t) => t.id === id))
    .filter((t): t is ServiceTemplate => t !== undefined);
}

function formatPrice(cents: number, currency: SupportedCurrency): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(0)}`;
  }
}

function priceDecimalToCents(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const num = Number.parseFloat(trimmed);
  if (Number.isNaN(num) || num < 0) return 0;
  return Math.round(num * 100);
}

export interface ServiceStepClientProps {
  defaultCurrency: SupportedCurrency;
  serviceRoles: string[];
}

export function ServiceStepClient({
  defaultCurrency,
  serviceRoles,
}: ServiceStepClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const suggested = useMemo(() => deriveSuggested(serviceRoles), [serviceRoles]);

  const [phase, setPhase] = useState<"select" | "edit">("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [queue, setQueue] = useState<DraftValues[]>([]);
  const [draft, setDraft] = useState<DraftValues | null>(null);
  const [queueIndex, setQueueIndex] = useState(0);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const buildQueue = (): DraftValues[] => {
    const drafts: DraftValues[] = [];
    for (const id of selectedIds) {
      if (id === CUSTOM_ID) {
        drafts.push({ templateId: CUSTOM_ID, ...CUSTOM_BLANK });
        continue;
      }
      const template = SERVICE_TEMPLATES.find((t) => t.id === id);
      if (template) drafts.push(templateToDraft(template));
    }
    return drafts;
  };

  const startEditingFromSelection = () => {
    const drafts = buildQueue();
    if (drafts.length === 0) {
      router.push(routeOnSkipFromService());
      return;
    }
    const first = drafts[0];
    if (!first) {
      router.push(routeOnSkipFromService());
      return;
    }
    setQueue(drafts);
    setQueueIndex(0);
    setDraft(first);
    setPhase("edit");
  };

  const advanceAfterSave = () => {
    const nextIndex = queueIndex + 1;
    const nextDraft = queue[nextIndex];
    if (!nextDraft) {
      router.push(nextRouteAfterService());
      return;
    }
    setQueueIndex(nextIndex);
    setDraft(nextDraft);
  };

  const saveDraft = () => {
    if (!draft) return;
    const priceCents = priceDecimalToCents(draft.priceDecimal);
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      toast("Give this service a short name.", "error");
      return;
    }
    if (draft.durationMin <= 0) {
      toast("Set a session length greater than zero minutes.", "error");
      return;
    }

    const isCustom = draft.templateId === CUSTOM_ID;
    const template = isCustom
      ? null
      : SERVICE_TEMPLATES.find((t) => t.id === draft.templateId);

    const kind = template?.defaults.kind ?? "session";
    const locationType = template?.defaults.locationType ?? "studio";

    startTransition(async () => {
      const res = await createOnboardingPackage({
        name: trimmedName,
        kind,
        priceCents,
        durationMin: draft.durationMin,
        depositPct: draft.depositPct,
        locationType,
        currency: defaultCurrency,
      });
      if (!res.ok) {
        toast(`Couldn't save service: ${res.error}`, "error");
        return;
      }
      advanceAfterSave();
    });
  };

  const onBack = () => {
    router.push(routeOnBackFromService());
  };

  if (phase === "edit" && draft) {
    const totalCount = queue.length;
    const currentNumber = queueIndex + 1;
    const headerLabel =
      totalCount > 1
        ? `Service ${String(currentNumber)} of ${String(totalCount)}`
        : "Edit service";
    return (
      <OnboardingShell
        currentStep={SERVICE_STEP_INDEX}
        title={SERVICE_STEP_TITLE}
        subtitle={SERVICE_STEP_SUBTITLE}
        onBack={() => {
          setPhase("select");
        }}
      >
        <div className="space-y-5">
          <p className="text-sm font-medium text-muted-foreground">
            {headerLabel}
          </p>
          <div className="space-y-4 rounded-md border border-border bg-card p-5">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-foreground">Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => {
                  setDraft({ ...draft, name: e.target.value });
                }}
                disabled={pending}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-foreground">
                  Price ({defaultCurrency})
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={draft.priceDecimal}
                  onChange={(e) => {
                    setDraft({ ...draft, priceDecimal: e.target.value });
                  }}
                  disabled={pending}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-foreground">
                  Duration (min)
                </span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={draft.durationMin}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      durationMin: Number.parseInt(e.target.value, 10) || 0,
                    });
                  }}
                  disabled={pending}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-foreground">Deposit %</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={draft.depositPct}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      depositPct: Math.max(
                        0,
                        Math.min(100, Number.parseInt(e.target.value, 10) || 0),
                      ),
                    });
                  }}
                  disabled={pending}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" onClick={saveDraft} disabled={pending}>
                {pending
                  ? "Saving…"
                  : currentNumber < totalCount
                    ? "Save & next"
                    : "Save service"}
              </Button>
            </div>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      currentStep={SERVICE_STEP_INDEX}
      title={SERVICE_STEP_TITLE}
      subtitle={SERVICE_STEP_SUBTITLE}
      onBack={onBack}
      onSkip={() => {
        router.push(routeOnSkipFromService());
      }}
      onContinue={startEditingFromSelection}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {suggested.map((t) => {
          const selected = selectedIds.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                toggleSelect(t.id);
              }}
              className={cn(
                "relative flex flex-col gap-2 rounded-md border p-4 text-left transition",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-card hover:border-foreground/30",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">{t.title}</span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                  {t.defaults.kind}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t.tagline}</p>
              <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {formatPrice(t.defaults.priceCents, t.defaults.currency)}
                </span>
                <span>{t.defaults.durationMin} min</span>
              </div>
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute right-3 top-3 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                >
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            toggleSelect(CUSTOM_ID);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-md border border-dashed p-4 text-sm transition",
            selectedIds.includes(CUSTOM_ID)
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          )}
        >
          <span className="text-2xl leading-none">+</span>
          <span>Add custom</span>
        </button>
      </div>
    </OnboardingShell>
  );
}
