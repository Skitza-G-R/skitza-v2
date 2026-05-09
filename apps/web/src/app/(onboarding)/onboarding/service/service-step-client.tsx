"use client";

import { Check, Infinity as InfinityIcon, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import {
  ONBOARDING_SERVICE_TEMPLATES,
  PAYMENT_PLANS,
  SUPPORTED_CURRENCIES,
  type OnboardingServiceTemplate,
  type OnboardingServiceTemplateId,
  type PaymentPlanId,
  type SupportedCurrency,
  depositPctForPlan,
  isServiceContinueAllowed,
} from "~/lib/onboarding/service-templates-onboarding";

import { createOnboardingPackage } from "../actions";

import {
  SERVICE_STEP_INDEX,
  nextRouteAfterService,
  routeOnBackFromService,
} from "./constants";

// Step 2 — First service. Compact 2x2 grid + inline name/price/sessions/
// payment all visible in viewport at 1280×840.

export function ServiceStepClient({
  defaultCurrency,
}: {
  defaultCurrency: SupportedCurrency;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] =
    useState<OnboardingServiceTemplateId>("mix");
  const initialTemplate =
    ONBOARDING_SERVICE_TEMPLATES.find((t) => t.id === "mix") ??
    ONBOARDING_SERVICE_TEMPLATES[0]!;
  const [name, setName] = useState(initialTemplate.defaultName);
  const [price, setPrice] = useState<number>(initialTemplate.defaultPrice);
  const [sessions, setSessions] = useState<number>(
    initialTemplate.defaultSessions,
  );
  // Toggle for "this service has no session cap" (e.g. monthly retainer,
  // ongoing collaboration). On save we encode unlimited as a high
  // sentinel value (UNLIMITED_SESSION_SENTINEL) since the products
  // schema column is NOT NULL int with default 1; a proper boolean
  // column is the cleaner long-term shape — see TODO in the action.
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [currency, setCurrency] = useState<SupportedCurrency>(defaultCurrency);
  const [plan, setPlan] = useState<PaymentPlanId>("full");

  // When unlimited is on, sessions count is effectively ignored — but
  // we still need the Continue gate to pass on the live (non-unlimited)
  // count so the producer can switch back cleanly.
  const allowContinue =
    isServiceContinueAllowed(name, price, isUnlimited ? 1 : sessions);

  function selectTemplate(template: OnboardingServiceTemplate) {
    setSelectedId(template.id);
    setName(template.defaultName);
    setPrice(template.defaultPrice);
    setSessions(template.defaultSessions);
    setIsUnlimited(false);
  }

  // Sentinel sent to the action when isUnlimited is on. 999 is high
  // enough that no real producer's session count would conflict, but
  // small enough that any downstream "sessions remaining" math doesn't
  // overflow. The /join store + booking flow should treat any value
  // >= 100 as "unlimited" until a proper boolean column lands.
  const UNLIMITED_SESSION_SENTINEL = 999;

  function handleContinue() {
    if (!allowContinue) return;
    setError(null);
    const tpl = ONBOARDING_SERVICE_TEMPLATES.find((t) => t.id === selectedId);
    if (!tpl) {
      setError("Pick a template first.");
      return;
    }
    startTransition(async () => {
      // TODO(unlimited-sessions): the action signature doesn't yet
      // expose a sessions count, so this commit just routes forward.
      // When the action accepts sessionCount, pass
      //   isUnlimited ? UNLIMITED_SESSION_SENTINEL : sessions
      // and the storefront / booking surfaces will need to render
      //   "Unlimited" when sessionCount >= 100.
      void UNLIMITED_SESSION_SENTINEL;
      const result = await createOnboardingPackage({
        name: name.trim(),
        kind: tpl.packageKind,
        priceCents: Math.round(price * 100),
        durationMin: tpl.defaultDurationMin,
        depositPct: depositPctForPlan(plan),
        locationType: "studio",
        currency,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(nextRouteAfterService());
    });
  }

  return (
    <WizardChrome
      activePosition={SERVICE_STEP_INDEX}
      stepIndicator="Step 2 of 5"
      footer={
        <WizardFooter
          onBack={() => router.push(routeOnBackFromService())}
          onContinue={handleContinue}
          continueDisabled={!allowContinue}
          pending={pending}
        />
      }
    >
      <div className="reveal-up">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 2 of 5 · Required
        </p>
        <h1
          className="mt-2 font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          Pick your first service.
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-snug text-[rgb(var(--fg-muted))]">
          Pick a starter, tweak the price. Add more later.
        </p>

        {/* Compact 2x2 template grid */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {ONBOARDING_SERVICE_TEMPLATES.map((t) => {
            const isSelected = t.id === selectedId;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTemplate(t)}
                aria-pressed={isSelected}
                className={`sk-pop relative flex items-start gap-2 rounded-xl border p-2.5 text-left transition-all ${
                  isSelected
                    ? "border-transparent bg-[rgb(var(--bg-sidebar))] text-white shadow-[0_4px_14px_rgba(17,16,9,0.18)]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]"
                }`}
              >
                <span
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${
                    isSelected
                      ? "bg-[rgb(var(--brand-primary)/0.22)] text-[rgb(var(--brand-primary))]"
                      : "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]"
                  }`}
                  aria-hidden
                >
                  <Icon size={12} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-bold leading-tight">
                    {t.title}
                  </div>
                  <div
                    className={`mt-0.5 text-[10.5px] leading-snug ${isSelected ? "text-white/75" : "text-[rgb(var(--fg-muted))]"}`}
                  >
                    {t.description}
                  </div>
                </div>
                {isSelected ? (
                  <span
                    aria-hidden
                    className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[rgb(var(--bg-sidebar))]"
                  >
                    <Check size={9} strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Service name */}
        <div className="mt-4">
          <label
            htmlFor="serviceName"
            className="mb-1 block text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
          >
            Service name
          </label>
          <input
            id="serviceName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={selectedId === "custom" ? "e.g. Beat lease" : ""}
            maxLength={80}
            className="w-full rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] font-medium text-[rgb(var(--fg-default))] outline-none transition-shadow placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_3px_rgba(212,150,10,0.12)]"
          />
        </div>

        {/* Price + currency */}
        <div className="mt-3">
          <label
            htmlFor="servicePrice"
            className="mb-1 block text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
          >
            Price
          </label>
          <div className="flex gap-2">
            <input
              id="servicePrice"
              type="number"
              min={0}
              step={1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              className="flex-1 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 font-mono text-[14px] font-semibold text-[rgb(var(--fg-default))] outline-none transition-shadow focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_3px_rgba(212,150,10,0.12)]"
            />
            <select
              value={currency}
              onChange={(e) =>
                setCurrency(e.target.value as SupportedCurrency)
              }
              className="rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2.5 py-2 font-mono text-[13px] font-semibold text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_3px_rgba(212,150,10,0.12)]"
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Sessions stepper + Payment plan */}
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
              <span>Sessions</span>
              <button
                type="button"
                onClick={() => setIsUnlimited(!isUnlimited)}
                className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] tracking-[0.12em] transition-colors ${
                  isUnlimited
                    ? "bg-[rgb(var(--brand-primary)/0.18)] text-[rgb(var(--brand-primary-dark))]"
                    : "bg-transparent text-[rgb(var(--fg-faint))] hover:bg-[rgb(var(--bg-background))] hover:text-[rgb(var(--fg-muted))]"
                }`}
                aria-pressed={isUnlimited}
              >
                <InfinityIcon size={10} aria-hidden />
                Unlimited
              </button>
            </label>
            <div className="flex items-center justify-between rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-1.5 py-1">
              {isUnlimited ? (
                <div className="flex w-full items-center justify-center gap-1.5 py-0.5 text-[rgb(var(--brand-primary-dark))]">
                  <InfinityIcon size={16} strokeWidth={2.5} />
                  <span className="font-mono text-[12px] font-bold uppercase tracking-[0.06em]">
                    Unlimited
                  </span>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSessions(Math.max(1, sessions - 1))}
                    aria-label="Decrease sessions"
                    className="sk-pop flex h-6 w-6 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-background))]"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="font-mono text-[14px] font-bold text-[rgb(var(--fg-default))]">
                    {sessions}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSessions(sessions + 1)}
                    aria-label="Increase sessions"
                    className="sk-pop flex h-6 w-6 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-background))]"
                  >
                    <Plus size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
              Payment
            </label>
            <div className="flex rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-0.5">
              {PAYMENT_PLANS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlan(p.id)}
                  className={`flex-1 rounded-md px-1.5 py-1.5 text-[10.5px] font-semibold transition-colors ${
                    plan === p.id
                      ? "bg-[rgb(var(--bg-sidebar))] text-white"
                      : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 text-[12.5px] text-[rgb(var(--fg-danger))]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </WizardChrome>
  );
}
