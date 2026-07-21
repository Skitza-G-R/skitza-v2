export type VersionDeliveryPermission =
  | "purchase_fully_paid"
  | "version_override"
  | "payment_required"
  | "audio_deleted";

export type VersionDeliveryState = Readonly<{
  purchaseId: string;
  permission: VersionDeliveryPermission;
  fullyPaid: boolean;
  remainingCents: number;
  currency: string;
  overdue: boolean;
  totalCents: number;
}>;

export type PresentedVersionDelivery = Readonly<{
  key: "paid" | "early_override" | "locked" | "overdue" | "deleted";
  badge: string;
  title: string;
  description: string;
  canDownload: boolean;
  remainingCents: number;
  currency: string;
}>;

/**
 * Present one backend-authorized purchase/version result. This helper never
 * derives entitlement from money; `permission` is supplied by audio delivery.
 */
export function presentVersionDelivery(state: VersionDeliveryState): PresentedVersionDelivery {
  if (state.permission === "audio_deleted") {
    return {
      key: "deleted",
      badge: "Audio deleted",
      title: "Audio deleted",
      description: "This version keeps its history, but it has no play or download action.",
      canDownload: false,
      remainingCents: state.remainingCents,
      currency: state.currency,
    };
  }
  if (state.permission === "purchase_fully_paid") {
    return {
      key: "paid",
      badge: "Paid",
      title:
        state.totalCents === 0
          ? "No-charge purchase · download available"
          : "Paid · download available",
      description: "This stored version belongs to a fully paid purchase.",
      canDownload: true,
      remainingCents: state.remainingCents,
      currency: state.currency,
    };
  }
  if (state.permission === "version_override") {
    return {
      key: "early_override",
      badge: "Early access",
      title: "Early download allowed for this version",
      description:
        "The producer unlocked this exact version early. The purchase's paid and waived amounts are unchanged.",
      canDownload: true,
      remainingCents: state.remainingCents,
      currency: state.currency,
    };
  }
  if (state.overdue) {
    return {
      key: "overdue",
      badge: "Overdue · locked",
      title: "Download locked · payment overdue",
      description:
        "Listening stays available. Download unlocks only when the backend entitlement allows it.",
      canDownload: false,
      remainingCents: state.remainingCents,
      currency: state.currency,
    };
  }
  return {
    key: "locked",
    badge: "Locked",
    title: "Download locked until full payment",
    description: "Listening stays available while this purchase still has a balance.",
    canDownload: false,
    remainingCents: state.remainingCents,
    currency: state.currency,
  };
}
