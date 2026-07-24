"use client";

import { usePathname, useSearchParams } from "next/navigation";

import {
  useRuntimeCachedView,
  type SafeViewSlot,
} from "~/components/runtime-state/use-runtime-state";
import type { RuntimePayloadBySlot } from "~/lib/runtime-state/runtime-state";

type ProducerSafeViewSlot = Extract<SafeViewSlot, `producer.${string}.safe-view`>;

/**
 * Route-local writer for bounded, non-transactional read models. It renders
 * no UI; the persistent producer boundary owns the offline presentation.
 */
export function ProducerRuntimeSafeView<Slot extends ProducerSafeViewSlot>({
  slot,
  data,
}: {
  slot: Slot;
  data: RuntimePayloadBySlot[Slot];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useRuntimeCachedView({
    slot,
    route: `${pathname}${search ? `?${search}` : ""}`,
    serverData: data,
  });

  return null;
}
