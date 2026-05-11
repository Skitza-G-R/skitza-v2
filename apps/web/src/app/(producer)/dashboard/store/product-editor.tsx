// product-editor.tsx
//
// Phase 2 wizard orchestrator. Owns the draft state for a single
// product, wires the 4 step components (Type, Includes, Pricing,
// Contract) into <EditorShell>, and saves via the existing
// `createPackage` / `updatePackage` server actions. The step list is
// 4 in NEW mode and 3 in EDIT mode (Type step is for new products
// only — editing preserves the original kind exactly).
//
// `description` is the plain tagline shown on the public profile card.
// Revisions / turnaround / deposit / duration used to be carried by an
// encoded tail of the description string; that was dropped when
// PricingStep was simplified to match the reference design.

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentPlan } from "@skitza/db";

import {
  createPackage,
  type PackageKind,
  updatePackage,
} from "~/app/(producer)/dashboard/booking/actions";
import { useToast } from "~/components/ui/toast";

import { ContractStep } from "./editor-steps/contract-step";
import { IncludesStep } from "./editor-steps/includes-step";
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
type StepId = "type" | "includes" | "pricing" | "contract";

const NEW_STEPS = ["type", "includes", "pricing", "contract"] as const;
const EDIT_STEPS = ["includes", "pricing", "contract"] as const;

// Copy uses periods (no em dashes) per the impeccable copy rule.
const STEP_TITLES: Record<StepId, string> = {
  type: "What are you offering?",
  includes: "What's included",
  pricing: "Pricing and terms",
  contract: "Agreement",
};

const STEP_SUBTITLES: Record<StepId, string> = {
  type: "Pick the closest match. We'll prefill the rest.",
  includes: "Tap to add, drag to reorder. Artists see this list.",
  pricing: "Price, how many sessions, and how they pay.",
  contract: "Optional. Attach a contract or write your terms.",
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
  contractUrl: string;
}

interface ProductEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the editor opens in edit mode pre-filled. When null, opens in new mode. */
  product: StoreProduct | null;
  /** Producer's default currency, used to seed new products. */
  defaultCurrency: Currency;
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
    contractUrl: "",
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
  const tagline = p.description ?? "";
  const currency = (VALID_CURRENCIES as readonly string[]).includes(p.currency)
    ? (p.currency as Currency)
    : defaultCurrency;
  const { paymentPlan, installmentsCount } = paymentPlanFromDb(p.paymentPlans);
  return {
    _picked: null, // edit mode skips the type picker
    name: p.name,
    tagline,
    type: kindToPresetType(p.kind),
    price: p.priceCents / 100,
    currency,
    sessions: p.sessionCount === 0 ? 1 : p.sessionCount,
    unlimitedSessions: p.sessionCount === 0,
    paymentPlan,
    installmentsCount,
    includes: [...(p.description ? [] : []), ...((): string[] => {
      // ProductCardData carries no deliverables field; we surface the
      // legacy `deliverables` column via the StoreProduct shape which
      // already has it threaded through page.tsx. Fall back to [].
      const maybe = (p as unknown as { deliverables?: string[] }).deliverables;
      return Array.isArray(maybe) ? maybe : [];
    })()],
    contractUrl: p.contractUrl ?? "",
  };
}

export function ProductEditor({
  open,
  onOpenChange,
  product,
  defaultCurrency,
}: ProductEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

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
    }));
    setCurrentStep("includes");
  }

  const canContinue: boolean = (() => {
    if (currentStep === "type") return draft._picked != null;
    if (currentStep === "includes") return draft.name.trim() !== "";
    if (currentStep === "pricing") return draft.price >= 0;
    return true; // contract is skippable
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
    const description = draft.tagline;
    // Preserve existing durationMin on edit; new products store 0
    // (the wizard no longer surfaces a duration field).
    const durationMin = product?.durationMin ?? 0;
    const sessionCount = draft.unlimitedSessions ? 0 : Math.max(1, draft.sessions);
    const paymentPlans: PaymentPlan[] = (() => {
      if (draft.paymentPlan === "full") return [{ kind: "full" }];
      if (draft.paymentPlan === "split") return [{ kind: "split_50_50" }];
      return [
        {
          kind: "monthly",
          installments: Math.max(2, draft.installmentsCount),
        },
      ];
    })();
    // EDIT: preserve the existing DB kind exactly (legacy kinds like
    // "session"/"mixing"/etc. are valid). NEW: map preset type, with
    // "consult" routed to "custom" because the ProductKind enum has no
    // "consult" variant.
    const priceCents = Math.round(draft.price * 100);
    const trimmedContract = draft.contractUrl.trim();
    // In edit mode we preserve the existing kind (legacy values like
    // "session" must survive a round-trip). In new mode, draft.type
    // comes from the preset; "consult" has no ProductKind variant so
    // it lands as "custom".
    const basePayload = {
      name: draft.name.trim(),
      description,
      kind: draft.type === "consult"
        ? ("custom" as PackageKind)
        : (draft.type as PackageKind),
      priceCents,
      currency: draft.currency,
      durationMin,
      sessionCount,
      paymentPlans,
      contractUrl: trimmedContract.length > 0 ? trimmedContract : null,
    };
    // EDIT mode: overwrite kind with the original DB value so legacy
    // kinds (session/mixing/etc.) survive without our preset mapping
    // clobbering them.
    if (product != null) {
      basePayload.kind = product.kind as PackageKind;
    }

    startTransition(async () => {
      const res =
        product != null
          ? await updatePackage({ id: product.id, ...basePayload })
          : await createPackage(basePayload);
      if (res.ok) {
        toast(`${draft.name.trim() || "Product"} saved.`, "success");
        onOpenChange(false);
        router.refresh();
      } else {
        toast(res.error, "error");
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
          onChange={(patch) => {
            setDraft((d) => ({ ...d, ...patch }));
          }}
        />
      )}
      {currentStep === "contract" && (
        <ContractStep
          contractUrl={draft.contractUrl}
          onChange={(contractUrl) => {
            setDraft((d) => ({ ...d, contractUrl }));
          }}
        />
      )}
    </EditorShell>
  );
}
