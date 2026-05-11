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
import type { PaymentPlan } from "@skitza/db";

import {
  createPackage,
  type PackageKind,
  updatePackage,
} from "~/app/(producer)/dashboard/booking/actions";
import { useToast } from "~/components/ui/toast";

import { decodeDescription, encodeDescription } from "./description-encoding";
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
}

interface ProductEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the editor opens in edit mode pre-filled. When null, opens in new mode. */
  product: StoreProduct | null;
  /** Producer's default currency, used to seed new products. */
  defaultCurrency: Currency;
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
  };
}

export function ProductEditor({
  open,
  onOpenChange,
  product,
  defaultCurrency,
  onCreated,
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
    // Only round-trip contractText through the description meta when
    // the producer actually chose the "text" mode. File/Link modes
    // clear any prior inline text so a mode switch doesn't leak terms.
    const description = encodeDescription({
      tagline: draft.tagline,
      revisions: draft.revisions,
      unlimitedRevisions: draft.unlimitedRevisions,
      contractText: draft.contractMode === "text" ? draft.contractText : "",
    });
    // Parse the duration string ("60 min", "120 min", "180 min", or
    // a custom "{N} min") into an int. canContinue already guarantees
    // the format matches; the fallback to 0 is defensive only.
    const durationMatch = draft.duration.match(/(\d+)\s*min/i);
    const durationMin = durationMatch
      ? parseInt(durationMatch[1] ?? "0", 10)
      : 0;
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
    // contractUrl: link mode writes the trimmed URL (or null when
    // empty). text mode writes null — the terms are in the description
    // meta block instead.
    const trimmedUrl = draft.contractUrl.trim();
    const contractUrlOut: string | null =
      draft.contractMode === "text"
        ? null
        : trimmedUrl.length > 0
          ? trimmedUrl
          : null;
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
      contractUrl: contractUrlOut,
    };
    // EDIT mode: overwrite kind with the original DB value so legacy
    // kinds (session/mixing/etc.) survive without our preset mapping
    // clobbering them.
    if (product != null) {
      basePayload.kind = product.kind as PackageKind;
    }

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
              setDraft((d) => ({ ...d, ...patch }));
            }}
          />
        )}
      </div>
    </EditorShell>
  );
}
