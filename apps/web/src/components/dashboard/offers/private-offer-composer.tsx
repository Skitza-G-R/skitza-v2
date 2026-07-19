"use client";

import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  loadPrivateOfferProjectOptionsAction,
  sendPrivateOfferAction,
  type PrivateOfferProjectOption,
  updatePrivateOfferAction,
} from "~/app/(producer)/dashboard/store/private-offer-actions";
import { TaxModeSegmented } from "~/components/dashboard/tax-mode-segmented";
import { useToast } from "~/components/ui/toast";
import type { PrivateOfferInput } from "~/server/domain/private-offers/service";
import type { TaxMode } from "~/lib/tax-mode";

export type PrivateOfferCurrency = "USD" | "EUR" | "GBP" | "ILS";

export interface PrivateOfferComposerProject {
  id: string;
  title: string;
}

export interface PrivateOfferComposerRecipient {
  id: string;
  name: string;
  email: string;
  projects: PrivateOfferComposerProject[];
}

export type PrivateOfferComposerRecipientPayload =
  | { kind: "existing"; clientContactId: string }
  | { kind: "new"; name: string; email: string };

export type PrivateOfferComposerTargetPayload =
  | { kind: "new" }
  | { kind: "existing"; projectId: string };

export interface PrivateOfferComposerInitialOffer {
  id: string;
  clientContactId: string;
  targetProjectId: string | null;
  terms: PrivateOfferInput;
  expiresAt: string;
  expectedUpdatedAt: string;
}

export interface SendPrivateOfferComposerPayload {
  recipient: PrivateOfferComposerRecipientPayload;
  target: PrivateOfferComposerTargetPayload;
  terms: PrivateOfferInput;
  expiresAt: string;
}

export interface UpdatePrivateOfferComposerPayload {
  offerId: string;
  expectedUpdatedAt: string;
  recipient: PrivateOfferComposerRecipientPayload;
  target: PrivateOfferComposerTargetPayload;
  terms: PrivateOfferInput;
  expiresAt: string;
}

export interface PrivateOfferComposerProps {
  recipients: PrivateOfferComposerRecipient[];
  lockedClientId?: string;
  taxMode: TaxMode;
  taxRatePct: number;
  defaultCurrency: PrivateOfferCurrency;
  initialOffer?: PrivateOfferComposerInitialOffer;
}

type RoyaltyMode = "none" | "percentage" | "agreement";
type LimitMode = "fixed" | "unlimited";

interface ComposerDraft {
  recipientKind: "existing" | "new";
  clientContactId: string;
  newRecipientName: string;
  newRecipientEmail: string;
  targetKind: "new" | "existing";
  targetProjectId: string;
  name: string;
  tagline: string;
  service: string;
  deliverables: string;
  includedSongSpaces: string;
  hasSessionAllowance: boolean;
  sessionLimitMode: LimitMode;
  sessionCount: string;
  sessionDurationMin: string;
  sessionLocationType: string;
  sessionBufferMinutes: string;
  sessionMinLeadHours: string;
  cashPrice: string;
  currency: PrivateOfferCurrency;
  taxMode: TaxMode;
  taxRatePct: string;
  fullPlan: boolean;
  splitPlan: boolean;
  monthlyPlan: boolean;
  monthlyInstallments: string;
  masterMode: RoyaltyMode;
  masterPercentage: string;
  compositionMode: RoyaltyMode;
  compositionPercentage: string;
  royaltyNotes: string;
  rights: string;
  revisionMode: LimitMode;
  revisionCount: string;
  agreementText: string;
  expiresAtLocal: string;
}

const INPUT_CLASS =
  "min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:border-[rgb(var(--brand-primary))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.18)] focus:outline-none sm:min-h-10 sm:rounded-[var(--radius-md)] sm:text-[13px]";
const TEXTAREA_CLASS = `${INPUT_CLASS} resize-y py-2.5 leading-relaxed`;
const CHECKBOX_CLASS = "h-5 w-5 shrink-0 accent-[rgb(var(--brand-primary))]";
const CURRENCIES: readonly PrivateOfferCurrency[] = ["USD", "EUR", "GBP", "ILS"];
const MAX_CASH_PRICE_CENTS = 2_147_483_647;
const MAX_SERVICE_LENGTH = 200;
const MAX_DELIVERABLES = 20;
const MAX_DELIVERABLE_LENGTH = 500;
const MAX_DELIVERABLES_TEXT_LENGTH =
  MAX_DELIVERABLES * MAX_DELIVERABLE_LENGTH + (MAX_DELIVERABLES - 1);
const MAX_RIGHTS = 20;
const MAX_RIGHT_LENGTH = 1_000;
const MAX_RIGHTS_TEXT_LENGTH = MAX_RIGHTS * MAX_RIGHT_LENGTH + (MAX_RIGHTS - 1);
const MAX_AGREEMENT_LENGTH = 50_000;

function optionMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function privateOfferProjectOptionLabel(project: PrivateOfferProjectOption): string {
  const createdAt = new Date(project.createdAtIso);
  const date = Number.isNaN(createdAt.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(createdAt);
  const songs = `${String(project.songCount)} ${project.songCount === 1 ? "song" : "songs"}`;
  const balance =
    project.balances.length === 0
      ? "No purchase balance"
      : project.balances.every(({ remainingCents }) => remainingCents === 0)
        ? "Paid"
        : `Balance: ${project.balances
            .filter(({ remainingCents }) => remainingCents !== 0)
            .map(({ currency, remainingCents }) => optionMoney(remainingCents, currency))
            .join(" + ")}`;
  return `${project.title} · ${date} · ${songs} · ${balance}`;
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function priceCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  return Number.isSafeInteger(cents) ? cents : null;
}

function percentageBps(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:\d{1,3}(?:\.\d{1,2})?|\.\d{1,2})$/.test(trimmed)) return null;
  const [whole = "", fraction = ""] = trimmed.split(".");
  const bps =
    Number.parseInt(whole || "0", 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  return bps >= 1 && bps <= 10_000 ? bps : null;
}

function bpsPercentage(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  if (fraction % 10 === 0) return `${String(whole)}.${String(fraction / 10)}`;
  return `${String(whole)}.${String(fraction).padStart(2, "0")}`;
}

function centsPrice(cents: number): string {
  return `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}

function dateToLocalInput(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function defaultExpiryLocal(): string {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 14);
  expiry.setSeconds(0, 0);
  return dateToLocalInput(expiry);
}

function isoToLocalInput(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? defaultExpiryLocal() : dateToLocalInput(parsed);
}

function selectedPlanState(
  plans: readonly PaymentPlan[],
): Pick<ComposerDraft, "fullPlan" | "splitPlan" | "monthlyPlan" | "monthlyInstallments"> {
  const monthly = plans.find((plan) => plan.kind === "monthly");
  return {
    fullPlan: plans.some((plan) => plan.kind === "full"),
    splitPlan: plans.some((plan) => plan.kind === "split_50_50"),
    monthlyPlan: monthly !== undefined,
    monthlyInstallments: monthly?.kind === "monthly" ? String(monthly.installments) : "4",
  };
}

function royaltySeed(
  terms: PrivateOfferInput["royaltyTerms"],
): Pick<
  ComposerDraft,
  "masterMode" | "masterPercentage" | "compositionMode" | "compositionPercentage" | "royaltyNotes"
> {
  return {
    masterMode: terms?.master.mode ?? "none",
    masterPercentage: terms?.master.mode === "percentage" ? bpsPercentage(terms.master.bps) : "",
    compositionMode: terms?.composition.mode ?? "none",
    compositionPercentage:
      terms?.composition.mode === "percentage" ? bpsPercentage(terms.composition.bps) : "",
    royaltyNotes: terms?.notes ?? "",
  };
}

function seedDraft(props: PrivateOfferComposerProps): ComposerDraft {
  const initial = props.initialOffer?.terms;
  const lockedClientId = props.lockedClientId ?? props.initialOffer?.clientContactId;
  const firstRecipientId = lockedClientId ?? props.recipients[0]?.id ?? "";
  const session = initial?.session ?? null;
  const revisions = initial?.revisionRule ?? { kind: "fixed" as const, count: 0 };
  const plans = selectedPlanState(
    initial?.enabledPaymentPlans ?? (initial?.cashPriceCents === 0 ? [] : [{ kind: "full" }]),
  );

  return {
    recipientKind: firstRecipientId ? "existing" : "new",
    clientContactId: firstRecipientId,
    newRecipientName: "",
    newRecipientEmail: "",
    targetKind: props.initialOffer?.targetProjectId ? "existing" : "new",
    targetProjectId: props.initialOffer?.targetProjectId ?? "",
    name: initial?.name ?? "",
    tagline: initial?.tagline ?? "",
    service: initial?.service ?? "",
    deliverables: initial?.deliverables.join("\n") ?? "",
    includedSongSpaces: String(initial?.includedSongSpaces ?? 0),
    hasSessionAllowance: session !== null,
    sessionLimitMode: session?.limit.kind ?? "fixed",
    sessionCount: session?.limit.kind === "fixed" ? String(session.limit.count) : "1",
    sessionDurationMin: String(session?.durationMin ?? 60),
    sessionLocationType: session?.locationType ?? "studio",
    sessionBufferMinutes: String(session?.bufferMinutes ?? 0),
    sessionMinLeadHours: String(session?.minLeadHours ?? 24),
    cashPrice: centsPrice(initial?.cashPriceCents ?? 0),
    currency:
      (initial?.currency.toUpperCase() as PrivateOfferCurrency | undefined) ??
      props.defaultCurrency,
    taxMode: initial?.taxMode ?? props.taxMode,
    taxRatePct: String(initial?.taxRatePct ?? props.taxRatePct),
    ...plans,
    ...royaltySeed(initial?.royaltyTerms ?? null),
    rights: initial?.rights.join("\n") ?? "",
    revisionMode: revisions.kind,
    revisionCount: revisions.kind === "fixed" ? String(revisions.count) : "0",
    agreementText: initial?.agreementText ?? "",
    expiresAtLocal: props.initialOffer
      ? isoToLocalInput(props.initialOffer.expiresAt)
      : defaultExpiryLocal(),
  };
}

function positiveInteger(value: string, minimum: number, maximum: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function royaltySide(mode: RoyaltyMode, percentage: string): ProductRoyaltyTerms["master"] | null {
  if (mode !== "percentage") return { mode };
  const bps = percentageBps(percentage);
  return bps === null ? null : { mode: "percentage", bps };
}

function buildTerms(draft: ComposerDraft): { terms: PrivateOfferInput } | { error: string } {
  const name = draft.name.trim();
  if (!name) return { error: "Add an offer name." };
  const service = draft.service.trim();
  if (!service) return { error: "Add the service this offer covers." };
  if (service.length > MAX_SERVICE_LENGTH) {
    return { error: "Service must be 200 characters or fewer." };
  }
  const deliverables = splitLines(draft.deliverables);
  if (deliverables.length === 0) return { error: "Add at least one deliverable." };
  if (deliverables.length > MAX_DELIVERABLES) {
    return { error: "Add no more than 20 deliverables." };
  }
  if (deliverables.some((deliverable) => deliverable.length > MAX_DELIVERABLE_LENGTH)) {
    return { error: "Each deliverable must be 500 characters or fewer." };
  }

  const cashPriceCents = priceCents(draft.cashPrice);
  if (cashPriceCents === null)
    return { error: "Enter a valid cash price with up to two decimals." };
  if (cashPriceCents > MAX_CASH_PRICE_CENTS) {
    return { error: "Cash price cannot exceed 21,474,836.47." };
  }
  const includedSongSpaces = positiveInteger(draft.includedSongSpaces, 0, 1_000);
  if (includedSongSpaces === null) {
    return { error: "Song spaces must be a whole number from 0 to 1,000." };
  }
  const taxRatePct = positiveInteger(draft.taxRatePct, 0, 100);
  if (taxRatePct === null) return { error: "Tax must be a whole percentage from 0 to 100." };

  let session: PrivateOfferInput["session"] = null;
  if (draft.hasSessionAllowance) {
    const durationMin = positiveInteger(draft.sessionDurationMin, 1, 1_440);
    const bufferMinutes = positiveInteger(draft.sessionBufferMinutes, 0, 1_440);
    const minLeadHours = positiveInteger(draft.sessionMinLeadHours, 0, 8_760);
    if (durationMin === null) return { error: "Session duration must be from 1 to 1,440 minutes." };
    if (bufferMinutes === null) return { error: "Session buffer must be from 0 to 1,440 minutes." };
    if (minLeadHours === null) return { error: "Session notice must be from 0 to 8,760 hours." };
    const count =
      draft.sessionLimitMode === "fixed" ? positiveInteger(draft.sessionCount, 1, 1_000) : null;
    if (draft.sessionLimitMode === "fixed" && count === null) {
      return { error: "Session allowance must be from 1 to 1,000." };
    }
    session = {
      limit:
        draft.sessionLimitMode === "unlimited"
          ? { kind: "unlimited" }
          : { kind: "fixed", count: count ?? 1 },
      durationMin,
      locationType: draft.sessionLocationType.trim() || "studio",
      bufferMinutes,
      minLeadHours,
    };
  }

  const revisionCount =
    draft.revisionMode === "fixed" ? positiveInteger(draft.revisionCount, 0, 1_000) : null;
  if (draft.revisionMode === "fixed" && revisionCount === null) {
    return { error: "Revisions must be a whole number from 0 to 1,000." };
  }

  const master = royaltySide(draft.masterMode, draft.masterPercentage);
  if (master === null) return { error: "Enter a master royalty from 0.01% to 100%." };
  const composition = royaltySide(draft.compositionMode, draft.compositionPercentage);
  if (composition === null) {
    return { error: "Enter a composition royalty from 0.01% to 100%." };
  }

  const enabledPaymentPlans: PaymentPlan[] = [];
  if (cashPriceCents > 0) {
    if (draft.fullPlan) enabledPaymentPlans.push({ kind: "full" });
    if (draft.splitPlan) enabledPaymentPlans.push({ kind: "split_50_50" });
    if (draft.monthlyPlan) {
      const installments = positiveInteger(draft.monthlyInstallments, 2, 12);
      if (installments === null) return { error: "Monthly payments must be from 2 to 12." };
      enabledPaymentPlans.push({ kind: "monthly", installments });
    }
    if (enabledPaymentPlans.length === 0) {
      return { error: "Enable at least one payment option for a paid offer." };
    }
  }

  const rights = splitLines(draft.rights);
  if (rights.length === 0) return { error: "Write the rights included in this offer." };
  if (rights.length > MAX_RIGHTS) return { error: "Add no more than 20 rights." };
  if (rights.some((right) => right.length > MAX_RIGHT_LENGTH)) {
    return { error: "Each right must be 1,000 characters or fewer." };
  }
  const agreementText = draft.agreementText.trim();
  if (!agreementText) return { error: "Write the exact agreement the artist will accept." };
  if (agreementText.length > MAX_AGREEMENT_LENGTH) {
    return { error: "Exact agreement must be 50,000 characters or fewer." };
  }

  const notes = draft.royaltyNotes.trim();
  const royaltyTerms: ProductRoyaltyTerms = {
    master,
    composition,
    ...(notes ? { notes } : {}),
  };
  const tagline = draft.tagline.trim();

  return {
    terms: {
      name,
      ...(tagline ? { tagline } : {}),
      service,
      deliverables,
      cashPriceCents,
      currency: draft.currency,
      taxMode: draft.taxMode,
      taxRatePct,
      includedSongSpaces,
      session,
      revisionRule:
        draft.revisionMode === "unlimited"
          ? { kind: "unlimited" }
          : { kind: "fixed", count: revisionCount ?? 0 },
      royaltyTerms,
      rights,
      enabledPaymentPlans,
      agreementText,
    },
  };
}

function FieldLabel({
  htmlFor,
  children,
  optional = false,
}: {
  htmlFor: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[10.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
    >
      {children}
      {optional ? (
        <span className="ml-1 font-medium tracking-normal normal-case">(optional)</span>
      ) : null}
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.45)] p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="font-display text-[15px] font-bold text-[rgb(var(--fg-default))]">
          {title}
        </h3>
        {hint ? (
          <p className="mt-1 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">{hint}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function ToggleRow({
  id,
  checked,
  disabled = false,
  title,
  detail,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  title: string;
  detail: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="grid min-h-12 cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3 disabled:cursor-not-allowed"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className={CHECKBOX_CLASS}
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-[rgb(var(--fg-default))]">
          {title}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
          {detail}
        </span>
      </span>
    </label>
  );
}

export function PrivateOfferComposer(props: PrivateOfferComposerProps) {
  const {
    recipients,
    initialOffer,
    lockedClientId: lockedClientIdProp,
    taxMode,
    taxRatePct,
    defaultCurrency,
  } = props;
  const { toast } = useToast();
  const router = useRouter();
  const formId = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComposerDraft>(() => seedDraft(props));
  const [projectOptionsByClient, setProjectOptionsByClient] = useState<
    Record<string, readonly PrivateOfferProjectOption[]>
  >({});
  const [loadedProjectClientIds, setLoadedProjectClientIds] = useState<string[]>([]);
  const [loadingProjectClientId, setLoadingProjectClientId] = useState<string | null>(null);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const lockedClientId = lockedClientIdProp ?? initialOffer?.clientContactId;
  const editing = initialOffer !== undefined;

  useEffect(() => {
    if (!open) return;
    setDraft(
      seedDraft({
        recipients,
        ...(lockedClientIdProp ? { lockedClientId: lockedClientIdProp } : {}),
        taxMode,
        taxRatePct,
        defaultCurrency,
        ...(initialOffer ? { initialOffer } : {}),
      }),
    );
    setError(null);
  }, [defaultCurrency, initialOffer, lockedClientIdProp, open, recipients, taxMode, taxRatePct]);

  const selectedClientId = lockedClientId ?? draft.clientContactId;
  const selectedRecipient = useMemo(
    () => recipients.find((recipient) => recipient.id === selectedClientId),
    [recipients, selectedClientId],
  );
  const projectOptionsLoaded = selectedClientId
    ? loadedProjectClientIds.includes(selectedClientId)
    : false;
  const availableProjects = selectedClientId
    ? (projectOptionsByClient[selectedClientId] ?? [])
    : [];
  const selectedTargetProject = availableProjects.find(
    (project) => project.id === draft.targetProjectId,
  );
  const loadingProjects = loadingProjectClientId === selectedClientId;
  const currentPriceCents = priceCents(draft.cashPrice);
  const zeroCash = currentPriceCents === 0;

  useEffect(() => {
    if (
      !open ||
      draft.recipientKind === "new" ||
      !selectedClientId ||
      loadedProjectClientIds.includes(selectedClientId)
    ) {
      return;
    }

    let active = true;
    setLoadingProjectClientId(selectedClientId);
    setProjectLoadError(null);
    void loadPrivateOfferProjectOptionsAction(selectedClientId).then((result) => {
      if (!active) return;
      setLoadingProjectClientId(null);
      if (!result.ok) {
        setProjectLoadError(result.error);
        setProjectOptionsByClient((current) => ({ ...current, [selectedClientId]: [] }));
        return;
      }
      setLoadedProjectClientIds((current) =>
        current.includes(selectedClientId) ? current : [...current, selectedClientId],
      );
      setProjectOptionsByClient((current) => ({
        ...current,
        [selectedClientId]: result.data,
      }));
    });

    return () => {
      active = false;
    };
  }, [draft.recipientKind, loadedProjectClientIds, open, selectedClientId]);

  function patch(next: Partial<ComposerDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function handlePriceChange(value: string) {
    const nextCents = priceCents(value);
    patch({
      cashPrice: value,
      ...(nextCents === 0 ? { fullPlan: false, splitPlan: false, monthlyPlan: false } : {}),
    });
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let recipient: PrivateOfferComposerRecipientPayload;
    if (lockedClientId || draft.recipientKind === "existing") {
      const clientContactId = lockedClientId ?? draft.clientContactId;
      if (!clientContactId) {
        setError("Choose a recipient.");
        return;
      }
      recipient = { kind: "existing", clientContactId };
    } else {
      const name = draft.newRecipientName.trim();
      const email = draft.newRecipientEmail.trim().toLowerCase();
      if (!name) {
        setError("Add the new recipient’s name.");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError("Enter a valid recipient email.");
        return;
      }
      recipient = { kind: "new", name, email };
    }

    let target: PrivateOfferComposerTargetPayload = { kind: "new" };
    if (draft.targetKind === "existing") {
      if (!draft.targetProjectId) {
        setError("Choose an existing project or switch back to a new project.");
        return;
      }
      if (!availableProjects.some((project) => project.id === draft.targetProjectId)) {
        setError("That project is not available for this client.");
        return;
      }
      target = { kind: "existing", projectId: draft.targetProjectId };
    }

    const built = buildTerms(draft);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    const expiry = new Date(draft.expiresAtLocal);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      setError("Choose an expiry date in the future.");
      return;
    }

    startTransition(async () => {
      try {
        const expiresAt = expiry.toISOString();
        const result = initialOffer
          ? await updatePrivateOfferAction({
              offerId: initialOffer.id,
              expectedUpdatedAt: initialOffer.expectedUpdatedAt,
              recipient,
              target,
              terms: built.terms,
              expiresAt,
            } satisfies UpdatePrivateOfferComposerPayload)
          : await sendPrivateOfferAction({
              recipient,
              target,
              terms: built.terms,
              expiresAt,
            } satisfies SendPrivateOfferComposerPayload);

        if (!result.ok) {
          setError(result.error);
          toast(result.error, "error");
          return;
        }
        if (!editing && "emailDelivered" in result.data && !result.data.emailDelivered) {
          toast(
            "Offer saved, but the notification email could not be sent. It is still available in the app.",
            "info",
          );
        } else {
          toast(editing ? "Private offer updated." : "Private offer sent.", "success");
        }
        setOpen(false);
        router.refresh();
      } catch {
        const message = editing
          ? "The offer couldn’t be updated. Try again."
          : "The offer couldn’t be sent. Try again.";
        setError(message);
        toast(message, "error");
      }
    });
  }

  const id = (name: string) => `${formId}-${name}`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="sk-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-elevated))] shadow-sm transition-opacity hover:opacity-90"
        >
          <Send className="h-4 w-4" aria-hidden />
          {editing ? "Edit private offer" : "Send custom offer"}
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.56)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[760px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-xl)] bg-[rgb(var(--bg-background))] shadow-2xl max-sm:top-auto max-sm:right-0 max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[94dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-[var(--radius-xl)] max-sm:rounded-b-none">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[20px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] sm:text-[24px]">
                {editing ? "Edit private offer" : "Send a private offer"}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 max-w-[58ch] text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
                {editing
                  ? "Correct the terms or project before the artist accepts. Accepted offers stay locked."
                  : "The artist gets a notification. They can review these exact terms only after signing in with the invited email."}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="Close private offer composer"
              disabled={pending}
              className="sk-press -mt-1 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </header>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
              <Section
                title="Recipient & project"
                hint="A new project is the safe default. Existing projects are limited to the same client."
              >
                {lockedClientId ? (
                  <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3">
                    <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                      {selectedRecipient?.name ?? "Selected client"}
                    </p>
                    <p className="mt-0.5 text-[12px] break-all text-[rgb(var(--fg-muted))]">
                      {selectedRecipient?.email ?? "Recipient is locked for this offer"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <FieldLabel htmlFor={id("recipient")}>Recipient</FieldLabel>
                      <select
                        id={id("recipient")}
                        value={draft.recipientKind === "new" ? "__new__" : draft.clientContactId}
                        onChange={(event) => {
                          const value = event.target.value;
                          patch({
                            recipientKind: value === "__new__" ? "new" : "existing",
                            clientContactId: value === "__new__" ? "" : value,
                            targetKind: "new",
                            targetProjectId: "",
                          });
                        }}
                        className={INPUT_CLASS}
                      >
                        {recipients.map((recipient) => (
                          <option key={recipient.id} value={recipient.id}>
                            {recipient.name} — {recipient.email}
                          </option>
                        ))}
                        <option value="__new__">New recipient…</option>
                      </select>
                    </div>
                    {draft.recipientKind === "new" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                          <FieldLabel htmlFor={id("new-name")}>Recipient name</FieldLabel>
                          <input
                            id={id("new-name")}
                            type="text"
                            value={draft.newRecipientName}
                            maxLength={160}
                            onChange={(event) => {
                              patch({ newRecipientName: event.target.value });
                            }}
                            placeholder="Artist or band name"
                            className={INPUT_CLASS}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <FieldLabel htmlFor={id("new-email")}>Verified account email</FieldLabel>
                          <input
                            id={id("new-email")}
                            type="email"
                            value={draft.newRecipientEmail}
                            maxLength={320}
                            onChange={(event) => {
                              patch({ newRecipientEmail: event.target.value });
                            }}
                            placeholder="artist@example.com"
                            className={INPUT_CLASS}
                          />
                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                <fieldset>
                  <legend className="mb-2 text-[10.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                    Project after acceptance
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3">
                      <input
                        type="radio"
                        name={`${formId}-target`}
                        checked={draft.targetKind === "new"}
                        onChange={() => {
                          patch({ targetKind: "new", targetProjectId: "" });
                        }}
                        className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand-primary))]"
                      />
                      <span>
                        <span className="block text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                          New project
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                          Created only when the artist accepts.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3 has-disabled:cursor-not-allowed has-disabled:opacity-50">
                      <input
                        type="radio"
                        name={`${formId}-target`}
                        checked={draft.targetKind === "existing"}
                        disabled={
                          draft.recipientKind === "new" ||
                          !projectOptionsLoaded ||
                          loadingProjects ||
                          availableProjects.length === 0
                        }
                        onChange={() => {
                          patch({ targetKind: "existing" });
                        }}
                        className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand-primary))]"
                      />
                      <span>
                        <span className="block text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                          Existing project
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                          {loadingProjects
                            ? "Loading this client’s projects…"
                            : projectLoadError
                              ? "Projects could not be loaded. Keep the new-project target."
                              : projectOptionsLoaded && availableProjects.length === 0
                                ? "This client has no eligible active project."
                                : "Deliberately attach to this client’s work."}
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>
                {draft.targetKind === "existing" ? (
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={id("project")}>Same-client project</FieldLabel>
                    <select
                      id={id("project")}
                      value={draft.targetProjectId}
                      disabled={loadingProjects || !projectOptionsLoaded}
                      onChange={(event) => {
                        patch({ targetProjectId: event.target.value });
                      }}
                      className={INPUT_CLASS}
                    >
                      <option value="">Choose a project…</option>
                      {availableProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {privateOfferProjectOptionLabel(project)}
                        </option>
                      ))}
                    </select>
                    {selectedTargetProject ? (
                      <p className="rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-3 py-2 text-[11.5px] leading-relaxed [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                        Selected: {privateOfferProjectOptionLabel(selectedTargetProject)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Section>

              <Section title="Work included" hint="Write the exact scope the artist will accept.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={id("name")}>Offer name</FieldLabel>
                    <input
                      id={id("name")}
                      type="text"
                      value={draft.name}
                      maxLength={200}
                      onChange={(event) => {
                        patch({ name: event.target.value });
                      }}
                      placeholder="Custom EP production"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={id("service")}>Service</FieldLabel>
                    <input
                      id={id("service")}
                      type="text"
                      value={draft.service}
                      maxLength={MAX_SERVICE_LENGTH}
                      onChange={(event) => {
                        patch({ service: event.target.value });
                      }}
                      placeholder="Production"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor={id("tagline")} optional>
                    Short note
                  </FieldLabel>
                  <input
                    id={id("tagline")}
                    type="text"
                    value={draft.tagline}
                    maxLength={300}
                    onChange={(event) => {
                      patch({ tagline: event.target.value });
                    }}
                    placeholder="A one-line summary for the artist"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor={id("deliverables")}>Deliverables</FieldLabel>
                  <textarea
                    id={id("deliverables")}
                    value={draft.deliverables}
                    rows={4}
                    maxLength={MAX_DELIVERABLES_TEXT_LENGTH}
                    onChange={(event) => {
                      patch({ deliverables: event.target.value });
                    }}
                    placeholder={"Final mix\nInstrumental\nStems"}
                    className={TEXTAREA_CLASS}
                  />
                  <p className="text-[11.5px] text-[rgb(var(--fg-muted))]">
                    One deliverable per line.
                  </p>
                </div>
                <div className="flex max-w-[240px] flex-col gap-2">
                  <FieldLabel htmlFor={id("songs")}>Included song spaces</FieldLabel>
                  <input
                    id={id("songs")}
                    type="number"
                    min={0}
                    max={1_000}
                    step={1}
                    inputMode="numeric"
                    value={draft.includedSongSpaces}
                    onChange={(event) => {
                      patch({ includedSongSpaces: event.target.value });
                    }}
                    className={INPUT_CLASS}
                  />
                </div>
              </Section>

              <Section
                title="Session allowance"
                hint="Optional. This snapshots the allowance; scheduling is handled later."
              >
                <ToggleRow
                  id={id("has-sessions")}
                  checked={draft.hasSessionAllowance}
                  title="Include studio or remote sessions"
                  detail="Set a fixed number or an unlimited allowance."
                  onChange={(checked) => {
                    patch({ hasSessionAllowance: checked });
                  }}
                />
                {draft.hasSessionAllowance ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-2">
                        <FieldLabel htmlFor={id("session-limit")}>Allowance</FieldLabel>
                        <select
                          id={id("session-limit")}
                          value={draft.sessionLimitMode}
                          onChange={(event) => {
                            patch({ sessionLimitMode: event.target.value as LimitMode });
                          }}
                          className={INPUT_CLASS}
                        >
                          <option value="fixed">Fixed</option>
                          <option value="unlimited">Unlimited</option>
                        </select>
                      </div>
                      {draft.sessionLimitMode === "fixed" ? (
                        <div className="flex flex-col gap-2">
                          <FieldLabel htmlFor={id("session-count")}>Sessions</FieldLabel>
                          <input
                            id={id("session-count")}
                            type="number"
                            min={1}
                            max={1_000}
                            step={1}
                            value={draft.sessionCount}
                            onChange={(event) => {
                              patch({ sessionCount: event.target.value });
                            }}
                            className={INPUT_CLASS}
                          />
                        </div>
                      ) : null}
                      <div className="flex flex-col gap-2">
                        <FieldLabel htmlFor={id("session-duration")}>Minutes each</FieldLabel>
                        <input
                          id={id("session-duration")}
                          type="number"
                          min={1}
                          max={1_440}
                          step={1}
                          value={draft.sessionDurationMin}
                          onChange={(event) => {
                            patch({ sessionDurationMin: event.target.value });
                          }}
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-2">
                        <FieldLabel htmlFor={id("session-location")}>Location</FieldLabel>
                        <select
                          id={id("session-location")}
                          value={draft.sessionLocationType}
                          onChange={(event) => {
                            patch({ sessionLocationType: event.target.value });
                          }}
                          className={INPUT_CLASS}
                        >
                          <option value="studio">Studio</option>
                          <option value="remote">Remote</option>
                          <option value="on_location">On location</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <FieldLabel htmlFor={id("session-buffer")}>Buffer minutes</FieldLabel>
                        <input
                          id={id("session-buffer")}
                          type="number"
                          min={0}
                          max={1_440}
                          value={draft.sessionBufferMinutes}
                          onChange={(event) => {
                            patch({ sessionBufferMinutes: event.target.value });
                          }}
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <FieldLabel htmlFor={id("session-lead")}>Minimum notice (hours)</FieldLabel>
                        <input
                          id={id("session-lead")}
                          type="number"
                          min={0}
                          max={8_760}
                          value={draft.sessionMinLeadHours}
                          onChange={(event) => {
                            patch({ sessionMinLeadHours: event.target.value });
                          }}
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>
                  </>
                ) : null}
              </Section>

              <Section
                title="Price, tax & payment"
                hint="A true zero-cash offer has no payment plan or payment proof."
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={id("price")}>Cash price</FieldLabel>
                    <input
                      id={id("price")}
                      type="text"
                      inputMode="decimal"
                      value={draft.cashPrice}
                      onChange={(event) => {
                        handlePriceChange(event.target.value);
                      }}
                      placeholder="0.00"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={id("currency")}>Currency</FieldLabel>
                    <select
                      id={id("currency")}
                      value={draft.currency}
                      onChange={(event) => {
                        patch({ currency: event.target.value as PrivateOfferCurrency });
                      }}
                      className={INPUT_CLASS}
                    >
                      {CURRENCIES.map((currency) => (
                        <option key={currency}>{currency}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-[10.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                    Tax treatment
                  </span>
                  <TaxModeSegmented
                    value={draft.taxMode}
                    onChange={(next) => {
                      patch({ taxMode: next });
                    }}
                    size="lg"
                    ariaLabel="Private offer tax treatment"
                  />
                </div>
                {draft.taxMode !== "tax_free" ? (
                  <div className="flex max-w-[240px] flex-col gap-2">
                    <FieldLabel htmlFor={id("tax-rate")}>Tax rate (%)</FieldLabel>
                    <input
                      id={id("tax-rate")}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.taxRatePct}
                      onChange={(event) => {
                        patch({ taxRatePct: event.target.value });
                      }}
                      className={INPUT_CLASS}
                    />
                  </div>
                ) : null}
                <fieldset disabled={zeroCash} className={zeroCash ? "opacity-55" : ""}>
                  <legend className="mb-2 text-[10.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                    Enabled payment plans
                  </legend>
                  {zeroCash ? (
                    <p className="mb-3 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                      No plan is created for a ₪0 / royalty-only acceptance.
                    </p>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-3">
                    <ToggleRow
                      id={id("plan-full")}
                      checked={!zeroCash && draft.fullPlan}
                      disabled={zeroCash}
                      title="Pay in full"
                      detail="One payment."
                      onChange={(checked) => {
                        patch({ fullPlan: checked });
                      }}
                    />
                    <ToggleRow
                      id={id("plan-split")}
                      checked={!zeroCash && draft.splitPlan}
                      disabled={zeroCash}
                      title="50% / 50%"
                      detail="At acceptance and final approval."
                      onChange={(checked) => {
                        patch({ splitPlan: checked });
                      }}
                    />
                    <ToggleRow
                      id={id("plan-monthly")}
                      checked={!zeroCash && draft.monthlyPlan}
                      disabled={zeroCash}
                      title="Monthly"
                      detail="Two to twelve payments."
                      onChange={(checked) => {
                        patch({ monthlyPlan: checked });
                      }}
                    />
                  </div>
                </fieldset>
                {!zeroCash && draft.monthlyPlan ? (
                  <div className="flex max-w-[240px] flex-col gap-2">
                    <FieldLabel htmlFor={id("installments")}>Monthly payments</FieldLabel>
                    <input
                      id={id("installments")}
                      type="number"
                      min={2}
                      max={12}
                      step={1}
                      value={draft.monthlyInstallments}
                      onChange={(event) => {
                        patch({ monthlyInstallments: event.target.value });
                      }}
                      className={INPUT_CLASS}
                    />
                  </div>
                ) : null}
              </Section>

              <Section
                title="Royalties, rights & revisions"
                hint="Use percentage for a numeric share, agreement when the exact text below governs it, or none."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={id("master-mode")}>Master royalty</FieldLabel>
                    <select
                      id={id("master-mode")}
                      value={draft.masterMode}
                      onChange={(event) => {
                        patch({ masterMode: event.target.value as RoyaltyMode });
                      }}
                      className={INPUT_CLASS}
                    >
                      <option value="none">None</option>
                      <option value="percentage">Percentage</option>
                      <option value="agreement">In the agreement</option>
                    </select>
                    {draft.masterMode === "percentage" ? (
                      <input
                        aria-label="Master royalty percentage"
                        type="text"
                        inputMode="decimal"
                        value={draft.masterPercentage}
                        onChange={(event) => {
                          patch({ masterPercentage: event.target.value });
                        }}
                        placeholder="2.5%"
                        className={INPUT_CLASS}
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={id("composition-mode")}>Composition royalty</FieldLabel>
                    <select
                      id={id("composition-mode")}
                      value={draft.compositionMode}
                      onChange={(event) => {
                        patch({ compositionMode: event.target.value as RoyaltyMode });
                      }}
                      className={INPUT_CLASS}
                    >
                      <option value="none">None</option>
                      <option value="percentage">Percentage</option>
                      <option value="agreement">In the agreement</option>
                    </select>
                    {draft.compositionMode === "percentage" ? (
                      <input
                        aria-label="Composition royalty percentage"
                        type="text"
                        inputMode="decimal"
                        value={draft.compositionPercentage}
                        onChange={(event) => {
                          patch({ compositionPercentage: event.target.value });
                        }}
                        placeholder="5%"
                        className={INPUT_CLASS}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor={id("royalty-notes")} optional>
                    Royalty notes
                  </FieldLabel>
                  <textarea
                    id={id("royalty-notes")}
                    value={draft.royaltyNotes}
                    rows={2}
                    maxLength={4_000}
                    onChange={(event) => {
                      patch({ royaltyNotes: event.target.value });
                    }}
                    className={TEXTAREA_CLASS}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor={id("rights")}>Rights</FieldLabel>
                  <textarea
                    id={id("rights")}
                    value={draft.rights}
                    rows={3}
                    maxLength={MAX_RIGHTS_TEXT_LENGTH}
                    onChange={(event) => {
                      patch({ rights: event.target.value });
                    }}
                    placeholder="Artist owns the final master subject to the royalty above."
                    className={TEXTAREA_CLASS}
                  />
                  <p className="text-[11.5px] text-[rgb(var(--fg-muted))]">
                    One right or restriction per line.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={id("revision-mode")}>Revisions</FieldLabel>
                    <select
                      id={id("revision-mode")}
                      value={draft.revisionMode}
                      onChange={(event) => {
                        patch({ revisionMode: event.target.value as LimitMode });
                      }}
                      className={INPUT_CLASS}
                    >
                      <option value="fixed">Fixed</option>
                      <option value="unlimited">Unlimited</option>
                    </select>
                  </div>
                  {draft.revisionMode === "fixed" ? (
                    <div className="flex flex-col gap-2">
                      <FieldLabel htmlFor={id("revision-count")}>Revision rounds</FieldLabel>
                      <input
                        id={id("revision-count")}
                        type="number"
                        min={0}
                        max={1_000}
                        step={1}
                        value={draft.revisionCount}
                        onChange={(event) => {
                          patch({ revisionCount: event.target.value });
                        }}
                        className={INPUT_CLASS}
                      />
                    </div>
                  ) : null}
                </div>
              </Section>

              <Section
                title="Exact agreement & expiry"
                hint="This text and target lock when accepted. Later changes require a new offer."
              >
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor={id("agreement")}>Exact agreement</FieldLabel>
                  <textarea
                    id={id("agreement")}
                    value={draft.agreementText}
                    rows={8}
                    maxLength={MAX_AGREEMENT_LENGTH}
                    onChange={(event) => {
                      patch({ agreementText: event.target.value });
                    }}
                    placeholder="Write every additional term the artist is agreeing to…"
                    className={TEXTAREA_CLASS}
                  />
                </div>
                <div className="flex max-w-[320px] flex-col gap-2">
                  <FieldLabel htmlFor={id("expiry")}>Expires</FieldLabel>
                  <input
                    id={id("expiry")}
                    type="datetime-local"
                    value={draft.expiresAtLocal}
                    onChange={(event) => {
                      patch({ expiresAtLocal: event.target.value });
                    }}
                    className={INPUT_CLASS}
                  />
                  <p className="text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                    Defaults to 14 days from now. Expired offers leave the artist’s view but remain
                    in your history.
                  </p>
                </div>
              </Section>

              {error ? (
                <div
                  role="alert"
                  className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-[12.5px] font-medium text-[rgb(var(--fg-danger))]"
                >
                  {error}
                </div>
              ) : null}
            </div>

            <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 py-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom,0px))] sm:flex-row sm:items-center sm:justify-end sm:px-6 sm:py-4">
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  disabled={pending}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
                >
                  Cancel
                </button>
              </DialogPrimitive.Close>
              <button
                type="submit"
                disabled={pending}
                className="sk-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                <Send className="h-4 w-4" aria-hidden />
                {pending ? "Saving…" : editing ? "Save corrections" : "Send private offer"}
              </button>
            </footer>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
