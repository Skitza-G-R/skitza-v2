"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { archivePackage, restorePackage } from "~/app/(producer)/dashboard/booking/actions";
import { useToast } from "~/components/ui/toast";

import type { ProductRemovalAction } from "./product-removal-modal";

export interface ProductRemovalTarget {
  id: string;
  name: string;
  action: ProductRemovalAction;
}

export type ProductRemovalOutcome =
  | { action: "archive"; undoable: true }
  | { action: "delete"; undoable: false };

/**
 * Requests removal, then trusts the server's transaction-time history check.
 * The list's action controls confirmation copy only; the returned outcome is
 * authoritative because history may be created after the list was rendered.
 */
export function useProductRemoval(): (
  target: ProductRemovalTarget,
) => Promise<ProductRemovalOutcome | null> {
  const router = useRouter();
  const { toast } = useToast();

  return useCallback(
    async (target: ProductRemovalTarget): Promise<ProductRemovalOutcome | null> => {
      const removal = await archivePackage({ id: target.id });
      if (!removal.ok) {
        toast(removal.error, "error");
        return null;
      }
      router.refresh();

      if (removal.data.outcome === "deleted") {
        toast(`"${target.name}" deleted.`, "success");
        return { action: "delete", undoable: false };
      }

      toast(`"${target.name}" archived.`, "success", {
        durationMs: 4500,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              const restore = await restorePackage({ id: target.id });
              if (restore.ok) {
                toast(`"${target.name}" restored as hidden.`, "success");
                router.refresh();
              } else {
                toast(restore.error, "error");
              }
            })();
          },
        },
      });
      return { action: "archive", undoable: true };
    },
    [router, toast],
  );
}
