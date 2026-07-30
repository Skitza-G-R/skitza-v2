"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

import { ProductEditor } from "~/app/(producer)/dashboard/store/product-editor";
import type { StoreProduct } from "~/app/(producer)/dashboard/store/store-screen";
import { useProducerStoreProductDraft } from "~/components/runtime-state/use-runtime-state";
import type { TaxMode } from "~/lib/tax-mode";

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
    <ProductEditor
      open
      onOpenChange={(open) => {
        if (!open && !submittedRef.current) {
          router.push(`/onboarding/studio${previewSuffix}`);
        }
      }}
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
  );
}
