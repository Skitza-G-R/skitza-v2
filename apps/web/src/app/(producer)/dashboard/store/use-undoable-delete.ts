// use-undoable-delete.ts
//
// Wraps the Phase-2 delete flow so callers (StoreScreen) call a single
// function and get the optimistic delete + 4.5s Undo toast for free.
// On the success path: archive the product server-side, refresh the
// list, raise a toast with an Undo action that calls restorePackage
// (which clears archivedAt and forces active=false). The window is
// 4500ms — long enough to read and act, short enough that producers
// don't see a stale "is now live" button after the toast expires.

"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import {
  archivePackage,
  restorePackage,
} from "~/app/(producer)/dashboard/booking/actions";
import { useToast } from "~/components/ui/toast";

export interface DeleteTarget {
  id: string;
  name: string;
}

export function useUndoableDelete(): (target: DeleteTarget) => Promise<void> {
  const router = useRouter();
  const { toast } = useToast();

  return useCallback(
    async (target: DeleteTarget): Promise<void> => {
      const archive = await archivePackage({ id: target.id });
      if (!archive.ok) {
        toast(archive.error, "error");
        return;
      }
      router.refresh();
      toast(`"${target.name}" deleted.`, "success", {
        durationMs: 4500,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              const restore = await restorePackage({ id: target.id });
              if (restore.ok) {
                toast(`"${target.name}" restored.`, "success");
                router.refresh();
              } else {
                toast(restore.error, "error");
              }
            })();
          },
        },
      });
    },
    [router, toast],
  );
}
