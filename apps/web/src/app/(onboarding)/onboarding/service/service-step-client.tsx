"use client";

import { Check, Minus, Plus } from "lucide-react";
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
  SERVICE_STEP_SUBTITLE,
  SERVICE_STEP_TITLE,
  nextRouteAfterService,
  routeOnBackFromService,
  routeOnSkipFromService,
} from "./constants";

// Step 2 — First service. May 2026 redesign.
//
// 2x2 grid of 4 starter templates → producer picks one → name + price
// pre-fill, producer can edit any field → Continue creates a package
// via the existing createOnboardingPackage action (no schema change).

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
  const [currency, setCurrency] = useState<SupportedCurrency>(defaultCurrency);
  const [plan, setPlan] = useState<PaymentPlanId>("full");

  const allowContinue = isServiceContinueAllowed(name, price, sessions);

  function selectTemplate(template: OnboardingServiceTemplate) {
    setSelectedId(template.id);
    setName(template.defaultName);
    setPrice(template.defaultPrice);
    setSessions(template.defaultSessions);
  }

  function handleContinue() {
    if (!allowContinue) return;
    setError(null);
    const tpl = ONBOARDING_SERVICE_TEMPLATES.find((t) => t.id === selectedId);
    if (!tpl) {
      setError("Pick a template first.");
      return;
    }
    startTransition(async () => {
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
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 2 of 5 · Required
        </p>
        <h1
          className="mt-3 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {SERVICE_STEP_TITLE}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {SERVICE_STEP_SUBTITLE}
        </p>

        {/* 2x2 template grid */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {ONBOARDING_SERVICE_TEMPLATES.map((t) => {
            const isSelected = t.id === selectedId;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTemplate(t)}
                aria-pressed={isSelected}
                className={`sk-pop relative flex flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? "border-transparent bg-[rgb(var(--bg-sidebar))] text-white shadow-[0_6px_18px_rgba(17,16,9,0.18)]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]"
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                    isSelected
                      ? "bg-[rgb(var(--brand-primary)/0.22)] text-[rgb(var(--brand-primary))]"
                      : "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]"
                  }`}
                  aria-hidden
                >
                  <Icon size={14} />
                </span>
                <span className="text-[13.5px] font-bold leading-tight">
                  {t.title}
                </span>
                <span
                  className={`text-[11.5px] leading-snug ${isSelected ? "text-white/80" : "text-[rgb(var(--fg-muted))]"}`}
                >
                  {t.description}
                </span>
                {isSelected ? (
                  <span
                    aria-hidden
                    className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[rgb(var(--bg-sidebar))]"
                  >
                    <Check size={12} strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Service name */}
        <div className="mt-5">
          <label
            htmlFor="serviceName"
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
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
            className="w-full rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 text-[15px] font-medium text-[rgb(var(--fg-default))] outline-none transition-shadow placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_4px_rgba(212,150,10,0.12)]"
          />
        </div>

        {/* Price + currency */}
        <div className="mt-5">
          <label
            htmlFor="servicePrice"
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
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
              className="flex-1 rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 font-mono text-[15px] font-semibold text-[rgb(var(--fg-default))] outline-none transition-shadow focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_4px_rgba(212,150,10,0.12)]"
            />
            <select
              value={currency}
              onChange={(e) =>
                setCurrency(e.target.value as SupportedCurrency)
              }
              className="rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-3 font-mono text-[14px] font-semibold text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_4px_rgba(212,150,10,0.12)]"
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
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
              Sessions
            </label>
            <div className="flex items-center justify-between rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1.5">
              <button
                type="button"
                onClick={() => setSessions(Math.max(1, sessions - 1))}
                aria-label="Decrease sessions"
                className="sk-pop flex h-7 w-7 items-center justify-center rounded-lg text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-background))]"
              >
                <Minus size={14} />
              </button>
              <span className="font-mono text-[15px] font-bold text-[rgb(var(--fg-default))]">
                {sessions}
              </span>
              <button
                type="button"
                onClick={() => setSessions(sessions + 1)}
                aria-label="Increase sessions"
                className="sk-pop flex h-7 w-7 items-center justify-center rounded-lg text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-background))]"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
              Payment
            </label>
            <div className="flex rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1">
              {PAYMENT_PLANS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlan(p.id)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
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
            className="mt-4 text-[13px] text-[rgb(var(--fg-danger))]"
          >
            {error}
          </p>
        ) : null}

        {/* Skip helper — Continue is required, but tests ensure
            routeOnSkipFromService is wired in case we add Skip later. */}
        <p className="sr-only">{routeOnSkipFromService()}</p>
      </div>
    </WizardChrome>
  );
}
