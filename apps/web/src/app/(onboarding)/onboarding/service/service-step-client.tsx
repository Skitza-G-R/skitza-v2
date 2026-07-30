"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

import { ProductEditor } from "~/app/(producer)/dashboard/store/product-editor";
import type { StoreProduct } from "~/app/(producer)/dashboard/store/store-screen";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { useProducerStoreProductDraft } from "~/components/runtime-state/use-runtime-state";
import type { TaxMode } from "~/lib/tax-mode";

import { SERVICE_STEP_INDEX, SERVICE_STEP_SUBTITLE, SERVICE_STEP_TITLE } from "./constants";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

export function ServiceStepClient({
  product,
  defaultCurrency,
  taxMode,
  taxRatePct,
  producerName,
  previewMode = false,
}: {
  product: StoreProduct | null;
  defaultCurrency: Currency;
  taxMode: TaxMode;
  taxRatePct: number;
  producerName: string;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const storeDraft = useProducerStoreProductDraft();
  const submittedRef = useRef(false);
  const previewSuffix = previewMode ? "?__preview=1" : "";

  function routeAfterProduct(includesSessions: boolean) {
    submittedRef.current = true;
    router.push(
      `${includesSessions ? "/onboarding/availability" : "/onboarding/review"}${previewSuffix}`,
    );
  }

  function discardAndReturn() {
    submittedRef.current = true;
    storeDraft.clear();
    router.push(`/onboarding/studio${previewSuffix}`);
  }

  return (
    <WizardChrome
      activePosition={SERVICE_STEP_INDEX}
      completedCount={2}
      stepIndicator="First product"
      canExit={!previewMode}
      previewMode={previewMode}
      tip={<>Your product stays hidden until you publish your page at the end of setup.</>}
    >
      <div className="ob-stagger">
        <p className="font-mono text-[10px] font-bold tracking-[0.18em] text-[rgb(var(--brand-primary-dark))] uppercase">
          First product · Guided setup
        </p>
        <h1
          className="font-display mt-3 max-w-[15ch] text-[32px] leading-[0.98] font-extrabold tracking-[-0.04em] text-balance sm:text-[42px]"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {SERVICE_STEP_TITLE}
        </h1>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {SERVICE_STEP_SUBTITLE}
        </p>

        <div className="mt-6">
          <ProductEditor
            open
            onOpenChange={(open) => {
              if (!open && !submittedRef.current) {
                router.push(`/onboarding/studio${previewSuffix}`);
              }
            }}
            presentation="embedded"
            product={product}
            defaultCurrency={defaultCurrency}
            taxMode={taxMode}
            taxRatePct={taxRatePct}
            producerName={producerName}
            previewPlacement="focal"
            newProductFlow="onboarding"
            previewMode={previewMode}
            onSubmitted={storeDraft.clear}
            onSubmittedResult={({ includesSessions }) => {
              routeAfterProduct(includesSessions);
            }}
            onDiscardDraft={discardAndReturn}
            persistedDraft={storeDraft.record}
            onPersistDraft={storeDraft.save}
          />
        </div>
      </div>
    </WizardChrome>
  );
}
