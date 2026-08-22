export type GoogleDriveDeliverableLink = Readonly<{ label: string; href: string }>;

export type PaymentDeliveryInput = Readonly<{
  fullyPaid: boolean;
  totalCents: number;
  paidCents: number;
  waivedCents: number;
  remainingCents: number;
  overdue: boolean;
  activeOverrideVersionLabels: readonly string[];
  googleDriveLinks: readonly GoogleDriveDeliverableLink[];
  withheldGoogleDriveLinkCount: number;
}>;

export type PaymentDeliveryState = Readonly<{
  key:
    | "no_payment_required"
    | "paid"
    | "early_override"
    | "overdue_locked"
    | "waived_locked"
    | "locked";
  label: string;
  description: string;
  paidCents: number;
  waivedCents: number;
  remainingCents: number;
  overdue: boolean;
  activeOverrideVersionLabels: readonly string[];
  googleDriveLinks: readonly GoogleDriveDeliverableLink[];
  withheldGoogleDriveLinkCount: number;
}>;

function safeGoogleDriveUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "drive.google.com" && url.hostname !== "docs.google.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Keep accepted deliverable labels visible while separating protected Drive URLs. */
export function splitGoogleDriveDeliverables(deliverables: readonly string[]): Readonly<{
  labels: readonly string[];
  googleDriveLinks: readonly GoogleDriveDeliverableLink[];
}> {
  const links: GoogleDriveDeliverableLink[] = [];
  const labels = deliverables.map((deliverable) => {
    const matches = deliverable.match(/https:\/\/(?:drive|docs)\.google\.com\/[^\s)]+/giu) ?? [];
    let label = deliverable;
    for (const rawMatch of matches) {
      const candidate = rawMatch.replace(/[.,;:]+$/u, "");
      const href = safeGoogleDriveUrl(candidate);
      if (!href) continue;
      label = label.replace(rawMatch, "");
      const cleanLabel = label.replace(/[·|—–:-]+\s*$/u, "").trim();
      links.push({ label: cleanLabel || "Google Drive deliverable", href });
    }
    return label.replace(/[·|—–:-]+\s*$/u, "").trim() || "Google Drive deliverable";
  });
  return { labels, googleDriveLinks: links };
}

/** Map the shared server ledger projection into delivery copy and link visibility. */
export function mapPaymentDeliveryState(input: PaymentDeliveryInput): PaymentDeliveryState {
  const common = {
    paidCents: input.paidCents,
    waivedCents: input.waivedCents,
    remainingCents: input.remainingCents,
    overdue: input.overdue,
    activeOverrideVersionLabels: input.activeOverrideVersionLabels,
  };
  if (input.totalCents === 0) {
    return {
      ...common,
      key: "no_payment_required",
      label: "No payment required · downloads available",
      description:
        "This agreement has no cash total. Access comes from the agreement, not a verified payment.",
      googleDriveLinks: input.googleDriveLinks,
      withheldGoogleDriveLinkCount: 0,
    };
  }
  if (input.fullyPaid) {
    return {
      ...common,
      key: "paid",
      label: "Paid · downloads available",
      description: "Every still-stored version owned by this purchase is downloadable.",
      googleDriveLinks: input.googleDriveLinks,
      withheldGoogleDriveLinkCount: 0,
    };
  }
  if (input.activeOverrideVersionLabels.length > 0) {
    return {
      ...common,
      key: "early_override",
      label: `Early access · ${input.activeOverrideVersionLabels.join(", ")} only`,
      description:
        "Only the listed audio version is unlocked early. Paid, waived, and remaining amounts stay visible; extra deliverables stay locked.",
      googleDriveLinks: [],
      withheldGoogleDriveLinkCount: input.withheldGoogleDriveLinkCount,
    };
  }
  if (input.overdue) {
    return {
      ...common,
      key: "overdue_locked",
      label: "Overdue · downloads locked",
      description: "Listening remains available, but downloads require full payment.",
      googleDriveLinks: [],
      withheldGoogleDriveLinkCount: input.withheldGoogleDriveLinkCount,
    };
  }
  if (input.waivedCents > 0 && input.remainingCents === 0) {
    return {
      ...common,
      key: "waived_locked",
      label: "Settled by waiver · downloads locked",
      description: "The waiver removed debt but did not count as payment or unlock delivery.",
      googleDriveLinks: [],
      withheldGoogleDriveLinkCount: input.withheldGoogleDriveLinkCount,
    };
  }
  return {
    ...common,
    key: "locked",
    label: "Downloads locked",
    description: "Downloads and extra deliverables unlock only after full payment.",
    googleDriveLinks: [],
    withheldGoogleDriveLinkCount: input.withheldGoogleDriveLinkCount,
  };
}
