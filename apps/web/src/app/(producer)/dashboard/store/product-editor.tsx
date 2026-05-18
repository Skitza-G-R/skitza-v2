// product-editor.tsx
//
// Phase 2 wizard orchestrator. Owns the draft state for a single product
// and wires the 5 step components (Type, Includes, Pricing, Logistics,
// Agreement) into <EditorShell>, saving via the existing
// `createPackage` / `updatePackage` server actions. The step list is
// 5 in NEW mode and 4 in EDIT mode (Type step is for new products only —
// editing preserves the original kind exactly).
//
// description column encoding:
//   * the visible tagline is plain text (first line)
//   * revisions (int) and inline contract text live in an encoded suffix
//     block — see description-encoding.ts. This is a temporary bridge
//     until the schema gains dedicated columns.
//
// contractUrl column:
//   * "link" mode writes the trimmed URL (or null if empty)
//   * "text" mode writes null — the terms live in the description meta

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createPackage,
  updatePackage,
} from "~/app/(producer)/dashboard/booking/actions";
import type { PaymentPlan } from "@skitza/db";
import { useToast } from "~/components/ui/toast";
import type { VolumeTier } from "~/lib/pricing";

import { buildPackagePayload } from "./build-package-payload";
import { decodeDescription } from "./description-encoding";
import { ContractStep, type ContractMode } from "./editor-steps/contract-step";
import { IncludesStep } from "./editor-steps/includes-step";
import { LogisticsStep } from "./editor-steps/logistics-step";
import { PricingStep } from "./editor-steps/pricing-step";
import { TypeStep } from "./editor-steps/type-step";
import { EditorShell } from "./editor-shell";
import { kindToTile } from "./kind-to-tile";
import type { StoreProduct } from "./store-screen";
import {
  getPreset,
  type PaymentPlanChoice,
  type PresetId,
  type PresetType,
} from "./type-presets";

type Currency = "USD" | "EUR" | "GBP" | "ILS";
type StepId = "type" | "includes" | "pricing" | "logistics" | "agreement";

const NEW_STEPS = ["type", "includes", "pricing", "logistics", "agreement"] as const;
const EDIT_STEPS = ["includes", "pricing", "logistics", "agreement"] as const;

// Copy uses periods (no em dashes) per the impeccable copy rule.
const STEP_TITLES: Record<StepId, string> = {
  type: "What are you offering?",
  includes: "What's included",
  pricing: "Pricing and terms",
  logistics: "Logistics",
  agreement: "Agreement",
};

const STEP_SUBTITLES: Record<StepId, string> = {
  type: "Pick the closest match. We'll prefill the rest.",
  includes: "Tap to add, drag to reorder. Artists see this list.",
  pricing: "Price, how many sessions, and how they pay.",
  logistics: "Session length and how many revisions are included.",
  agreement: "Optional. Attach a contract or write your terms.",
};

interface Draft {
  _picked: PresetId | null;
  name: string;
  tagline: string;
  type: PresetType;
  price: number;
  currency: Currency;
  sessions: number;
  unlimitedSessions: boolean;
  paymentPlan: PaymentPlanChoice;
  installmentsCount: number;
  includes: string[];
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  contractMode: ContractMode;
  contractUrl: string;
  contractText: string;
  // Per-song pricing — pricingModel='per_song' flips the Pricing step
  // into the calculator panel. volumeTiers is the ascending discount
  // ladder; the first tier (minQty=1) is the base per-song price.
  // Empty array when pricingModel='flat'.
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
}

interface ProductEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the editor opens in edit mode pre-filled. When null, opens in new mode. */
  product: StoreProduct | null;
  /** Producer's default currency, used to seed new products. */
  defaultCurrency: Currency;
  /**
   * Producer's business-level tax mode + rate (migration 0019). Threaded
   * into <PricingStep> so the price input shows a live "Artists pay $X"
   * preview that reflects the producer's current tax setup.
   */
  taxMode: import("~/lib/tax-mode").TaxMode;
  taxRatePct: number;
  /**
   * Fires only on the CREATE path, with the newly-created product's id,
   * BEFORE the modal closes / toast / router.refresh. Used by the parent
   * to trigger a shimmer-glow on the new card for ~4s.
   */
  onCreated?: (id: string) => void;
}

const VALID_CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "ILS"];

function emptyDraft(currency: Currency): Draft {
  return {
    _picked: null,
    name: "",
    tagline: "",
    type: "consult",
    price: 0,
    currency,
    sessions: 1,
    unlimitedSessions: false,
    paymentPlan: "full",
    installmentsCount: 3,
    includes: [],
    duration: "60 min",
    revisions: 0,
    unlimitedRevisions: false,
    contractMode: "link",
    contractUrl: "",
    contractText: "",
    pricingModel: "flat",
    volumeTiers: [],
  };
}

// Map a DB row's `kind` back to the wizard's PresetType. Anything not in
// the recognised four becomes "consult" (mirrors kindToTile's fallback).
function kindToPresetType(kind: string): PresetType {
  const tile = kindToTile(kind);
  return tile;
}

// Map a DB row's `paymentPlans[0]` to the wizard's three-option choice.
function paymentPlanFromDb(plans: PaymentPlan[] | undefined): {
  paymentPlan: PaymentPlanChoice;
  installmentsCount: number;
} {
  const first = plans?.[0];
  if (!first) return { paymentPlan: "full", installmentsCount: 3 };
  if (first.kind === "full") return { paymentPlan: "full", installmentsCount: 3 };
  if (first.kind === "split_50_50") {
    return { paymentPlan: "split", installmentsCount: 3 };
  }
  return { paymentPlan: "installments", installmentsCount: first.installments };
}

function seedDraftFromProduct(p: StoreProduct, defaultCurrency: Currency): Draft {
  const decoded = decodeDescription(p.description);
  const currency = (VALID_CURRENCIES as readonly string[]).includes(p.currency)
    ? (p.currency as Currency)
    : defaultCurrency;
  const { paymentPlan, installmentsCount } = paymentPlanFromDb(p.paymentPlans);
  // Pick the initial contract mode: prefer "text" if inline terms exist
  // (round-tripping an edit shouldn't clobber them), otherwise default
  // to "link" — File mode is gone until the upload pipeline lands.
  const contractMode: ContractMode =
    decoded.contractText.length > 0
      ? "text"
      : "link";
  // duration: derive a readable string from durationMin. 0 minutes means
  // the legacy product never set a duration (or was the dropped
  // multi-session option) — open the wizard in Custom mode with an
  // empty minutes input so the producer must pick a chip or type a
  // number before saving.
  const duration =
    typeof p.durationMin === "number" && p.durationMin > 0
      ? `${String(p.durationMin)} min`
      : "";
  const deliverables = ((): string[] => {
    // ProductCardData carries no deliverables field; StoreProduct adds
    // it via the page.tsx loader. Fall back to [] when missing.
    const maybe = (p as unknown as { deliverables?: string[] }).deliverables;
    return Array.isArray(maybe) ? maybe : [];
  })();
  // pricingModel comes back from the DB as plain text — narrow to the
  // two values the wizard understands. Unknown values (legacy 'hourly',
  // 'bundle') fall back to 'flat' so the editor doesn't crash on edit.
  const pricingModel: "flat" | "per_song" =
    p.pricingModel === "per_song" ? "per_song" : "flat";
  return {
    _picked: null, // edit mode skips the type picker
    name: p.name,
    tagline: decoded.tagline,
    type: kindToPresetType(p.kind),
    price: p.priceCents / 100,
    currency,
    sessions: p.sessionCount === 0 ? 1 : p.sessionCount,
    unlimitedSessions: p.sessionCount === 0,
    paymentPlan,
    installmentsCount,
    includes: deliverables,
    duration,
    revisions: decoded.revisions,
    unlimitedRevisions: decoded.unlimitedRevisions,
    contractMode,
    contractUrl: p.contractUrl ?? "",
    contractText: decoded.contractText,
    pricingModel,
    volumeTiers: p.volumeTiers ?? [],
  };
}

export function ProductEditor({
  open,
  onOpenChange,
  product,
  defaultCurrency,
  taxMode,
  taxRatePct,
  onCreated,
}: ProductEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // Migration 0019 — inline tax state. The toggle is rendered inside
  // the Pricing step; we own the optimistic local state + the
  // server save here so the step can stay a pure presentation
  // component. Saves are fire-and-forget through the same
  // updateProducer server action Settings used to use.
  const [taxModeLocal, setTaxModeLocal] = useState(taxMode);
  const [taxRateLocal, setTaxRateLocal] = useState(taxRatePct);
  const [taxPending, setTaxPending] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);
  // Re-sync when the modal reopens with a fresh producer state
  // (e.g. another session updated the tax mode while this one was
  // closed). Keyed off the prop values so an external change wins.
  useEffect(() => {
    setTaxModeLocal(taxMode);
    setTaxRateLocal(taxRatePct);
  }, [taxMode, taxRatePct]);
  async function onTaxChange(patch: {
    taxMode?: import("~/lib/tax-mode").TaxMode;
    taxRatePct?: number;
  }) {
    const prevMode = taxModeLocal;
    const prevRate = taxRateLocal;
    if (patch.taxMode !== undefined) setTaxModeLocal(patch.taxMode);
    if (patch.taxRatePct !== undefined) setTaxRateLocal(patch.taxRatePct);
    setTaxError(null);
    setTaxPending(true);
    try {
      const { updateProducer } = await import(
        "~/app/(producer)/dashboard/settings/actions"
      );
      const res = await updateProducer(patch);
      if (res.ok) {
        // Refresh server-rendered surfaces (storefront, artist store)
        // so the new tax line propagates to everywhere prices render.
        router.refresh();
      } else {
        setTaxModeLocal(prevMode);
        setTaxRateLocal(prevRate);
        setTaxError(res.error);
        toast(res.error, "error");
      }
    } catch (e) {
      setTaxModeLocal(prevMode);
      setTaxRateLocal(prevRate);
      const msg = e instanceof Error ? e.message : "Couldn't save.";
      setTaxError(msg);
      toast(msg, "error");
    } finally {
      setTaxPending(false);
    }
  }

  const mode: "new" | "edit" = product != null ? "edit" : "new";
  const steps = mode === "edit" ? EDIT_STEPS : NEW_STEPS;

  const [draft, setDraft] = useState<Draft>(() =>
    product != null
      ? seedDraftFromProduct(product, defaultCurrency)
      : emptyDraft(defaultCurrency),
  );
  const [currentStep, setCurrentStep] = useState<StepId>(
    mode === "edit" ? "includes" : "type",
  );

  // Reseed draft + reset step whenever the editor opens with a (possibly
  // different) product. We key off `open` and `product?.id` so closing
  // and reopening on a new product wipes any half-edited state.
  useEffect(() => {
    if (!open) return;
    setDraft(
      product != null
        ? seedDraftFromProduct(product, defaultCurrency)
        : emptyDraft(defaultCurrency),
    );
    setCurrentStep(product != null ? "includes" : "type");
  }, [open, product, defaultCurrency]);

  const currentStepIdx = Math.max(0, (steps as readonly StepId[]).indexOf(currentStep));
  const isFirstStep = currentStepIdx === 0;
  const isLastStep = currentStepIdx === steps.length - 1;

  function onPickPreset(id: PresetId) {
    const preset = getPreset(id);
    if (!preset) return;
    setDraft((d) => ({
      ...d,
      _picked: id,
      type: preset.preset.type,
      name: d.name.trim().length > 0 ? d.name : preset.defaultName,
      price: preset.preset.price,
      sessions: preset.preset.sessions,
      unlimitedSessions: preset.preset.unlimitedSessions,
      paymentPlan: preset.preset.paymentPlan,
      includes: [...preset.baseline],
      duration: preset.preset.duration,
      revisions: preset.preset.revisions,
      contractMode: "link",
    }));
    setCurrentStep("includes");
  }

  const canContinue: boolean = (() => {
    if (currentStep === "type") return draft._picked != null;
    if (currentStep === "includes") return draft.name.trim() !== "";
    if (currentStep === "pricing") return draft.price >= 0;
    if (currentStep === "logistics") {
      // Duration must resolve to "{N} min" (any chip click or a typed
      // custom value). Empty Custom (in transit) blocks Continue.
      return /^\d+\s*min$/i.test(draft.duration);
    }
    return true; // agreement is skippable
  })();

  function goBack() {
    if (isFirstStep) return;
    setCurrentStep((steps as readonly StepId[])[currentStepIdx - 1] ?? currentStep);
  }

  function goNext() {
    if (isLastStep) return;
    setCurrentStep((steps as readonly StepId[])[currentStepIdx + 1] ?? currentStep);
  }

  function save() {
    // Wire shape lives in build-package-payload.ts as a pure mapping
    // so it can be unit-tested without rendering the modal. On edit,
    // we thread the existing product's kind to preserve legacy DB
    // values ("session"/"mixing"/etc.) that the wizard's presets
    // don't map back to.
    const basePayload = buildPackagePayload(
      draft,
      product != null ? product.kind : undefined,
    );

    startTransition(async () => {
      if (product != null) {
        const res = await updatePackage({ id: product.id, ...basePayload });
        if (res.ok) {
          toast(`${draft.name.trim() || "Product"} saved.`, "success");
          onOpenChange(false);
          router.refresh();
        } else {
          toast(res.error, "error");
        }
      } else {
        // CREATE path: fire onCreated BEFORE the modal closes so the
        // parent can flag the new card for the shimmer-glow. The
        // server action returns { ok: true, data: { id } } in create
        // mode; edit mode returns just { ok: true } and skips this.
        const res = await createPackage(basePayload);
        if (res.ok) {
          onCreated?.(res.data.id);
          toast(`${draft.name.trim() || "Product"} saved.`, "success");
          onOpenChange(false);
          router.refresh();
        } else {
          toast(res.error, "error");
        }
      }
    });
  }

  return (
    <EditorShell
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      {...(product != null ? { productName: product.name } : {})}
      steps={steps as readonly string[]}
      current={currentStep}
      title={STEP_TITLES[currentStep]}
      subtitle={STEP_SUBTITLES[currentStep]}
      canContinue={canContinue}
      onBack={goBack}
      onContinue={goNext}
      onSave={save}
      isFirstStep={isFirstStep}
      isLastStep={isLastStep}
      pending={pending}
    >
      <div key={currentStep} className="sk-step-enter">
        {currentStep === "type" && (
          <TypeStep picked={draft._picked} onPick={onPickPreset} />
        )}
        {currentStep === "includes" && (
          <IncludesStep
            pickedId={draft._picked}
            name={draft.name}
            onNameChange={(name) => {
              setDraft((d) => ({ ...d, name }));
            }}
            includes={draft.includes}
            onIncludesChange={(includes) => {
              setDraft((d) => ({ ...d, includes }));
            }}
          />
        )}
        {currentStep === "pricing" && (
          <PricingStep
            price={draft.price}
            currency={draft.currency}
            sessions={draft.sessions}
            unlimitedSessions={draft.unlimitedSessions}
            paymentPlan={draft.paymentPlan}
            installmentsCount={draft.installmentsCount}
            pricingModel={draft.pricingModel}
            volumeTiers={draft.volumeTiers}
            taxMode={taxModeLocal}
            taxRatePct={taxRateLocal}
            onTaxChange={(patch) => {
              // Fire-and-forget — onTaxChange is async but the prop
              // signature is void. The function handles its own
              // toast/rollback on error.
              void onTaxChange(patch);
            }}
            taxPending={taxPending}
            taxError={taxError}
            onChange={(patch) => {
              setDraft((d) => ({ ...d, ...patch }));
            }}
          />
        )}
        {currentStep === "logistics" && (
          <LogisticsStep
            duration={draft.duration}
            revisions={draft.revisions}
            unlimitedRevisions={draft.unlimitedRevisions}
            onChange={(patch) => {
              setDraft((d) => ({ ...d, ...patch }));
            }}
          />
        )}
        {currentStep === "agreement" && (
          <ContractStep
            mode={draft.contractMode}
            contractUrl={draft.contractUrl}
            contractText={draft.contractText}
            onChange={(patch) => {
              // ContractStep emits its panel-selector field as `mode`;
              // the Draft stores it as `contractMode` to disambiguate
              // from PaymentPlanChoice (paymentPlan) and any future
              // *Mode fields. Translate explicitly so a Text-tab click
              // actually swaps panels instead of silently growing a
              // dead `mode` key on Draft.
              const { mode, ...rest } = patch;
              setDraft((d) => ({
                ...d,
                ...rest,
                ...(mode !== undefined ? { contractMode: mode } : {}),
              }));
            }}
          />
        )}
      </div>
    </EditorShell>
  );
}
