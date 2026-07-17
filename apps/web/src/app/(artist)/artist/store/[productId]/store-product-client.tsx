"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import type { VolumeTier } from "~/lib/pricing";

import { requestStorePurchaseAction } from "./actions";
import { SongCountStepper } from "./song-count-stepper";

// Client Component. Captures only request intent. Per-song quantity is
// carried forward; price and plan are derived and frozen by the server at
// the later purchase-acceptance boundary.
export function StoreProductClient({
  product,
}: {
  product: {
    id: string;
    name: string;
    priceCents: number;
    currency: string;
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    volumeTiers: VolumeTier[] | null;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const operationKeyRef = useRef<string | null>(null);

  // Per-song state — populated by SongCountStepper's onChange. Initial
  // values match the stepper's default (qty 1 at the base tier).
  const isPerSong = product.pricingModel === "per_song";
  const tiers = product.volumeTiers ?? [];
  const [songQty, setSongQty] = useState(1);

  // Memoise the callback so the stepper's useEffect doesn't re-fire on
  // every parent render (stale-closure-safe + cheap).
  const handleStepperChange = useCallback(
    (state: { qty: number; unitPriceCents: number }) => {
      setSongQty(state.qty);
    },
    [],
  );

  const handleContinue = () => {
    setError(null);
    startTransition(async () => {
      const operationKey = operationKeyRef.current ?? crypto.randomUUID();
      operationKeyRef.current = operationKey;
      const res = await requestStorePurchaseAction({
        productId: product.id,
        operationKey,
        ...(isPerSong ? { songQty } : {}),
      });
      if (res.ok) {
        router.push(
          `/artist/purchase/${product.id}/sent?req=${res.purchaseRequestId}`,
        );
        return;
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Per-song stepper — only for per_song products. Above the plan
          picker so the artist commits to a qty before they're asked
          to pick a payment plan. */}
      {isPerSong ? (
        <SongCountStepper
          tiers={tiers}
          currency={product.currency}
          onChange={handleStepperChange}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-[rgb(var(--fg-danger-text))]">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        size="lg"
        disabled={pending}
        onClick={handleContinue}
      >
        {pending ? "Sending request…" : "Send request"}
      </Button>
    </div>
  );
}
