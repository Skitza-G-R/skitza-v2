import { ProducerPaymentsDashboard } from "~/components/payments/producer-payments-dashboard";
import type {
  ProducerPaymentRecord,
  ProducerPaymentsData,
} from "~/components/payments/producer-payments-dashboard-model";

const INITIAL_NOW = "2026-08-08T12:00:00.000Z";

function fixtureRecord(index: number): ProducerPaymentRecord {
  const pendingProof = index === 1;
  const overdue = index === 0;
  const milestone = index === 2;
  const completed = index === 3;
  const currency = index % 4 === 0 ? "USD" : "ILS";
  const remainingCents = completed ? 0 : 48_000 + index * 7_350;
  const dueNowCents = overdue ? remainingCents : 0;
  const installmentId = `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`;
  const proofId = `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`;

  return {
    id: `purchase-sk183-${String(index)}`,
    producerId: "producer-sk183",
    clientContactId: `client-sk183-${String(index)}`,
    clientName:
      [
        "Noa Meridian",
        "Maya Vale",
        "Lior North",
        "Dana Bloom",
        "Ari Sol",
        "Romi Lake",
        "Niv Harbor",
        "Tali Moss",
        "Omer Lane",
        "Shira Moon",
        "Gal Wilder",
        "Yael Echo",
      ][index] ?? `Artist ${String(index + 1)}`,
    projectId: `project-sk183-${String(index)}`,
    projectTitle:
      ["Glass Hours", "First Light", "Afterimage", "Low Tide"][index % 4] ?? "Studio project",
    projectLifecycleStatus: index === 4 ? "completed" : "active",
    purchaseTitle: index % 2 === 0 ? "Single production" : "Mix and master",
    purchaseReference: `SK-183-${String(index + 1).padStart(3, "0")}`,
    purchaseLifecycleStatus: "active",
    isImportedExistingWork: false,
    currency,
    totalCents: 120_000 + index * 11_700,
    paidCents: completed ? 120_000 + index * 11_700 : 72_000,
    dueNowCents,
    totalRemainingCents: remainingCents,
    installments: [
      {
        id: installmentId,
        amountCents: completed ? 120_000 + index * 11_700 : remainingCents,
        paidCents: completed ? 120_000 + index * 11_700 : 0,
        waivedCents: 0,
        remainingCents,
        dueAtIso: milestone ? null : "2026-08-15T09:00:00.000Z",
        triggeredAtIso: milestone ? null : "2026-07-20T09:00:00.000Z",
        dueTrigger: milestone ? "artist_approval" : "monthly_anniversary",
        status: completed
          ? "confirmed"
          : overdue
            ? "overdue"
            : pendingProof
              ? "awaiting_review"
              : "not_paid",
      },
    ],
    nextPayment: completed
      ? null
      : {
          installmentId,
          amountCents: remainingCents,
          dueAtIso: milestone ? null : "2026-08-15T09:00:00.000Z",
          triggeredAtIso: milestone ? null : "2026-07-20T09:00:00.000Z",
          dueTrigger: milestone ? "artist_approval" : "monthly_anniversary",
          status: overdue ? "overdue" : pendingProof ? "awaiting_review" : "not_paid",
        },
    payments: [
      {
        id: `payment-sk183-${String(index)}`,
        installmentId,
        proofId: pendingProof ? proofId : null,
        source: pendingProof ? "proof" : "manual",
        originalAmountCents: index === 5 ? 84_000 : 72_000,
        effectiveAmountCents: index === 5 ? 79_000 : 72_000,
        paidAtIso: `2026-08-${String((index % 7) + 1).padStart(2, "0")}T09:00:00.000Z`,
        note: null,
      },
    ],
    corrections:
      index === 5
        ? [
            {
              id: "correction-sk183",
              paymentId: "payment-sk183-5",
              previousAmountCents: 84_000,
              newAmountCents: 79_000,
              reason: "Returned transfer fee",
              occurredAtIso: "2026-08-07T09:00:00.000Z",
            },
          ]
        : [],
    waivers: [],
    proofs: pendingProof
      ? [
          {
            id: proofId,
            installmentId,
            amountCents: remainingCents,
            currency,
            status: "pending",
            submittedAtIso: "2026-08-07T11:00:00.000Z",
            reviewedAtIso: null,
          },
        ]
      : [],
    cancellation: null,
  };
}

const FIXTURE = {
  records: Array.from({ length: 12 }, (_, index) => fixtureRecord(index)),
} satisfies ProducerPaymentsData;

export function Sk183ProducerPaymentsDevScreen() {
  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 py-5 pb-28 sm:px-6 sm:py-8 lg:pb-10">
      <header className="mb-5">
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
          Money dashboard
        </p>
        <h1 className="font-display mt-1.5 text-[clamp(2rem,6vw,3.15rem)] leading-none font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          Payments
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          See what came in, what is due, and what is still waiting on the work.
        </p>
      </header>
      <ProducerPaymentsDashboard
        data={FIXTURE}
        producerTimeZone="Asia/Jerusalem"
        initialNowIso={INITIAL_NOW}
      />
    </main>
  );
}
