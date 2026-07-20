import {
  PaymentHistorySection,
  type PaymentHistoryCurrencyTotal,
  type PaymentHistoryProject,
  type PaymentHistoryRole,
  type PaymentHistorySectionDescriptor,
} from "./payment-history";

/** Serializable, adapter-friendly data supplied by an authorized SK-69 read projection. */
export interface PaymentHistoryViewData {
  section: PaymentHistorySectionDescriptor;
  currencyTotals: readonly PaymentHistoryCurrencyTotal[];
  projects: readonly PaymentHistoryProject[];
}

export interface PaymentHistoryViewProps {
  role: PaymentHistoryRole;
  data: PaymentHistoryViewData;
}

export function PaymentHistoryView({ role, data }: PaymentHistoryViewProps) {
  return (
    <PaymentHistorySection
      role={role}
      section={data.section}
      currencyTotals={data.currencyTotals}
      projects={data.projects}
    />
  );
}

export type {
  PaymentHistoryAcceptance,
  PaymentHistoryCancellation,
  PaymentHistoryCorrection,
  PaymentHistoryCurrencyTotal,
  PaymentHistoryDownloadOverride,
  PaymentHistoryFrozenTerms,
  PaymentHistoryFrozenTermDetail,
  PaymentHistoryInstallment,
  PaymentHistoryInstructionField,
  PaymentHistoryInstructions,
  PaymentHistoryLineItem,
  PaymentHistoryNextPayment,
  PaymentHistoryPauseEvent,
  PaymentHistoryPayment,
  PaymentHistoryPlan,
  PaymentHistoryProject,
  PaymentHistoryProof,
  PaymentHistoryPurchase,
  PaymentHistoryRole,
  PaymentHistorySectionDescriptor,
  PaymentHistoryStatus,
  PaymentHistoryTone,
  PaymentHistoryWaiver,
} from "./payment-history";
