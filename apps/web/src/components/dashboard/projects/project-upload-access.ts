export type UploadProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export type UploadPurchaseReference = Readonly<{
  id: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
}>;

/**
 * Uploads and new song spaces require both an Active project and the exact
 * purchase that owns the work to remain Active. Reopening a canceled project
 * intentionally does not restore its canceled purchase, so project status
 * alone is never sufficient upload authority.
 */
export function canCreatePurchaseOwnedProjectWork(input: Readonly<{
  projectLifecycleStatus: UploadProjectLifecycleStatus;
  purchaseId: string | null;
  purchases: readonly UploadPurchaseReference[];
}>): boolean {
  return (
    input.projectLifecycleStatus === "active" &&
    input.purchaseId !== null &&
    input.purchases.some(
      (purchase) => purchase.id === input.purchaseId && purchase.lifecycleStatus === "active",
    )
  );
}
