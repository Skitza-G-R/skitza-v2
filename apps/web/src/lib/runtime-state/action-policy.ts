export type RuntimeActionKind = "safe-edit" | "booking" | "payment" | "availability" | "live";

export type RuntimeActionResult<T> =
  | { status: "confirmed"; value: T }
  | { status: "blocked-offline" }
  | { status: "rolled-back"; error: unknown }
  | { status: "failed"; error: unknown };

export interface RuntimeActionOptions<T> {
  kind: RuntimeActionKind;
  online: boolean;
  execute: () => Promise<T>;
  applyOptimistic?: () => void;
  rollback?: () => void;
}

export function requiresOnlineConfirmation(kind: RuntimeActionKind): boolean {
  return kind !== "safe-edit";
}

/**
 * Ordinary edits may update locally and roll back on failure. Important
 * transactions never apply optimistically and never call the server offline.
 */
export async function runRuntimeAction<T>({
  kind,
  online,
  execute,
  applyOptimistic,
  rollback,
}: RuntimeActionOptions<T>): Promise<RuntimeActionResult<T>> {
  if (requiresOnlineConfirmation(kind) && !online) {
    return { status: "blocked-offline" };
  }

  const optimistic = kind === "safe-edit" && Boolean(applyOptimistic);
  if (optimistic) applyOptimistic?.();

  try {
    return { status: "confirmed", value: await execute() };
  } catch (error) {
    if (optimistic) {
      rollback?.();
      return { status: "rolled-back", error };
    }
    return { status: "failed", error };
  }
}
