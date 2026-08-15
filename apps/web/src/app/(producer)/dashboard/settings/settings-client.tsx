"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Eye, Landmark, PencilLine, ShieldCheck, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  parseBankTransferDetails,
  serializeBankTransferDetails,
  type BankTransferFields,
} from "~/app/(onboarding)/onboarding/payment/bank-transfer";
import { PushPreferences } from "~/components/push/push-preferences";
import { useToast } from "~/components/ui/toast";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useProducerDisplayNameDraft } from "~/components/runtime-state/use-runtime-state";
import { PUBLIC_BRAND_ORIGIN, buildJoinUrl } from "~/lib/share/public-url";
import { markMeaningfulInstallAction } from "~/lib/pwa/install-guidance";
import { useTabSwipe } from "~/components/native/use-tab-swipe";
import { updateProducer } from "./actions";
import { SETTINGS_SECTION_KEYS, type SettingsSectionKey, SUB_NAV } from "./settings-keys";

// One screen, five sections, one savebar. The shared producer fields live in
// this client component so the savebar can corral edits across sections
// without losing local state on switch (state moves UP to here; the
// individual sections are stateless render functions that receive
// the slice they care about).
//
// Future integrations have their own actions and don't ride the savebar.
// Payment instructions also save locally inside Getting paid so the default
// surface can stay read-only and a producer never has to confirm the same
// payment edit twice.

interface PaymentInstructionsState {
  bankTransfer: string;
  bitPhone: string;
  note: string;
}

interface InitialState {
  displayName: string;
  defaultCurrency: "USD" | "EUR" | "GBP" | "ILS";
  taxMode: "tax_free" | "tax_included" | "tax_added";
  taxRatePct: number;
  weekStart: "sunday" | "monday";
  plan: "free" | "pro";
  paymentInstructions: PaymentInstructionsState;
}

interface IdentityState {
  avatarUrl: string | null;
  initials: string;
  email: string;
  // The producer's public-page slug. Surfaced in the Profile section
  // as a read-only `skitza.app/join/<slug>` preview row so producers
  // can see / copy their share URL without leaving Settings.
  // Editing the slug itself moves to the future /dashboard/public-page
  // route — until that lands, this row is preview-only.
  slug: string;
}

interface FormState {
  displayName: string;
  defaultCurrency: "USD" | "EUR" | "GBP" | "ILS";
  taxMode: "tax_free" | "tax_included" | "tax_added";
  taxRatePct: number;
  weekStart: "sunday" | "monday";
}

interface StorageUsageState {
  usedBytes: number;
  reservedBytes: number;
  committedBytes: number;
  availableBytes: number;
  limitBytes: number;
  warningBytes: number;
  isAtOrAboveWarning: boolean;
  isFull: boolean;
}

export function SettingsClient({
  initialActive,
  initial,
  identity,
  storageUsage,
}: {
  initialActive: SettingsSectionKey;
  initial: InitialState;
  identity: IdentityState;
  storageUsage: StorageUsageState;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [paymentSavePending, setPaymentSavePending] = useState(false);

  // Section state — purely local. Initial value comes from `?section=`
  // URL param (server-resolved) so deep-links still work; subsequent
  // sub-nav clicks update only this state (no URL change) so unsaved
  // edits in `form` survive a section switch.
  const [active, setActive] = useState<SettingsSectionKey>(initialActive);

  function changeSection(next: SettingsSectionKey) {
    setActive(next);
    // Update the URL bar via the raw History API so the server page
    // isn't re-fetched (router.replace would remount SettingsClient
    // and wipe in-flight edits in `form`).
    window.history.replaceState(null, "", `/dashboard/settings?section=${next}`);
  }

  const tabSwipeHandlers = useTabSwipe({
    items: SETTINGS_SECTION_KEYS,
    value: active,
    onChange: changeSection,
  });

  const initialForm: FormState = {
    displayName: initial.displayName,
    defaultCurrency: initial.defaultCurrency,
    taxMode: initial.taxMode,
    taxRatePct: initial.taxRatePct,
    weekStart: initial.weekStart,
  };

  // `form` holds in-progress edits; `savedForm` is the last persisted
  // snapshot. Dirty = JSON-different from saved. Payment instructions keep
  // their own saved state because Getting paid has local Save/Cancel actions.
  const [form, setForm] = useState<FormState>(initialForm);
  const [savedForm, setSavedForm] = useState<FormState>(initialForm);
  const [paymentInstructions, setPaymentInstructions] = useState<PaymentInstructionsState>(
    initial.paymentInstructions,
  );
  const [paymentDraftDirty, setPaymentDraftDirty] = useState(false);
  const displayNameDraft = useProducerDisplayNameDraft({
    value: form.displayName,
    savedValue: savedForm.displayName,
    onRestore(draft) {
      setForm((current) => ({ ...current, displayName: draft.displayName }));
    },
  });

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm],
  );

  // Per-section dirty breakdown. Drives the small amber dot we paint
  // on each sub-nav button so a producer can see at a glance WHICH
  // section has unsaved edits, not just THAT something is unsaved.
  // Fields → section ownership:
  //   displayName              → profile
  //   defaultCurrency, taxMode, taxRatePct, weekStart → region
  // Getting paid saves locally, and Plan doesn't own savebar-managed fields,
  // so neither appears here.
  const dirtySections = useMemo<Set<SettingsSectionKey>>(() => {
    const out = new Set<SettingsSectionKey>();
    if (form.displayName !== savedForm.displayName) out.add("profile");
    if (
      form.defaultCurrency !== savedForm.defaultCurrency ||
      form.taxMode !== savedForm.taxMode ||
      form.taxRatePct !== savedForm.taxRatePct ||
      form.weekStart !== savedForm.weekStart
    ) {
      out.add("region");
    }
    return out;
  }, [form, savedForm]);

  function onDiscard() {
    displayNameDraft.clearDraft();
    setForm(savedForm);
  }

  function onSave() {
    if (!dirty || pending || paymentSavePending) return;
    if (!online) {
      toast("Reconnect to save settings.", "error");
      return;
    }

    // Build a minimal patch with only the shared producer fields that changed.
    // Payment instructions use their focused local save path below.
    const patch: Parameters<typeof updateProducer>[0] = {};
    if (form.displayName !== savedForm.displayName) patch.displayName = form.displayName;
    if (form.defaultCurrency !== savedForm.defaultCurrency)
      patch.defaultCurrency = form.defaultCurrency;
    if (form.taxMode !== savedForm.taxMode) patch.taxMode = form.taxMode;
    if (form.taxRatePct !== savedForm.taxRatePct) patch.taxRatePct = form.taxRatePct;
    if (form.weekStart !== savedForm.weekStart) patch.weekStart = form.weekStart;
    startTransition(async () => {
      try {
        const res = await updateProducer(patch);
        if (res.ok) {
          displayNameDraft.clearDraft();
          setSavedForm(form);
          markMeaningfulInstallAction();
          toast("Settings saved.", "success");
          router.refresh();
        } else {
          if (res.saved?.producer || res.saved?.paymentInstructions) {
            if (res.saved.producer) displayNameDraft.clearDraft();
            setSavedForm((current) => ({
              displayName: res.saved?.producer ? form.displayName : current.displayName,
              defaultCurrency: res.saved?.producer ? form.defaultCurrency : current.defaultCurrency,
              taxMode: res.saved?.producer ? form.taxMode : current.taxMode,
              taxRatePct: res.saved?.producer ? form.taxRatePct : current.taxRatePct,
              weekStart: res.saved?.producer ? form.weekStart : current.weekStart,
            }));
            router.refresh();
          }
          toast(res.error, "error");
        }
      } catch {
        toast("Could not save settings. Please try again.", "error");
      }
    });
  }

  async function savePaymentInstructions(next: PaymentInstructionsState): Promise<boolean> {
    if (pending || paymentSavePending) return false;
    if (!online) {
      toast("Reconnect to save your payment details.", "error");
      return false;
    }

    setPaymentSavePending(true);
    try {
      // The focused payment service replaces the payment_details JSON object,
      // so every local save must carry Bank, Bit, and note together. Sending a
      // partial object here would silently clear whichever keys were omitted.
      const res = await updateProducer({ paymentInstructions: next });
      if (!res.ok) {
        toast(res.error, "error");
        return false;
      }

      setPaymentInstructions(next);
      markMeaningfulInstallAction();
      toast("Payment details saved.", "success");
      router.refresh();
      return true;
    } catch {
      toast("Could not save payment details. Please try again.", "error");
      return false;
    } finally {
      setPaymentSavePending(false);
    }
  }

  return (
    <div
      className="s-layout"
      data-role-switch-unsaved={dirty || paymentDraftDirty ? "true" : undefined}
    >
      {/* Left sub-nav. Eyebrow + H1 hidden on mobile (the nav becomes a
          horizontal chip rail). */}
      <nav className="s-nav" aria-label="Settings sections">
        <span className="s-eyebrow">Workspace</span>
        <h1>Settings</h1>
        {SUB_NAV.map((item) => {
          const Icon = ICONS[item.iconKey];
          const isActive = active === item.key;
          const isDirty = dirtySections.has(item.key);
          return (
            <button
              key={item.key}
              type="button"
              className={isActive ? "s-active" : ""}
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                changeSection(item.key);
              }}
            >
              <Icon />
              {item.label}
              {isDirty && (
                <span className="s-nav-dirty-dot" aria-label="Unsaved changes in this section" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Right content — one stable swipe panel. Getting paid stays mounted
          while hidden so its local Edit draft survives section switches. */}
      <div
        className="s-content [touch-action:pan-y_pinch-zoom]"
        data-tab-swipe-surface
        {...tabSwipeHandlers}
      >
        <div className="s-content-inner" data-tab-swipe-panel>
          {active === "profile" && (
            <ProfileSection form={form} setForm={setForm} identity={identity} />
          )}
          {active === "plan" && <PlanSection storageUsage={storageUsage} />}
          {active === "notif" && <NotifSection />}
          <div hidden={active !== "int"}>
            <IntegrationsSection
              paymentInstructions={paymentInstructions}
              onSave={savePaymentInstructions}
              onDraftDirtyChange={setPaymentDraftDirty}
              disabled={pending || paymentSavePending}
            />
          </div>
          {active === "region" && <RegionSection form={form} setForm={setForm} />}
        </div>
      </div>

      {/* Save bar — slides up only when dirty. Disabled while saving. */}
      <div
        className={dirty ? "s-savebar s-show" : "s-savebar"}
        role="region"
        aria-label="Unsaved changes"
        aria-hidden={!dirty}
      >
        <div className="s-savebar-lead">
          <span className="s-savebar-pulse" aria-hidden />
          <span>
            <b>Unsaved changes.</b> Your edits won&apos;t apply until you save.
          </span>
        </div>
        <div className="s-savebar-actions">
          <button
            type="button"
            className="s-btn s-btn-ghost"
            onClick={onDiscard}
            disabled={pending || paymentSavePending}
          >
            Discard
          </button>
          <button
            type="button"
            className="s-btn s-btn-amber"
            onClick={onSave}
            disabled={pending || paymentSavePending || !dirty || !online}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Profile section ──────────────────────────────────────────────── */
function ProfileSection({
  form,
  setForm,
  identity,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  identity: IdentityState;
}) {
  return (
    <section className="s-reveal" aria-labelledby="settings-profile-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Public identity</span>
        <h2 id="settings-profile-h">Profile</h2>
        <p>How you appear on your public producer page and in client invitations.</p>
      </header>
      <div className="s-card">
        <div className="s-row">
          <div>
            <div className="s-row-label">Avatar</div>
            <div className="s-row-hint">
              Synced from your Google account. Change it where you signed in.
            </div>
          </div>
          <div className="s-row-field" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {identity.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={identity.avatarUrl}
                alt=""
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <div
                className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-extrabold text-[rgb(var(--fg-default))]"
                style={{
                  background: "linear-gradient(135deg, #fcd34d, #fb923c)",
                }}
              >
                {identity.initials}
              </div>
            )}
            <span className="text-xs text-[rgb(var(--fg-muted))]">{identity.email}</span>
          </div>
        </div>

        <div className="s-row">
          <div>
            <div className="s-row-label">Display name</div>
            <div className="s-row-hint">
              Shown on your storefront, invoices, and the artist-facing app.
            </div>
          </div>
          <div className="s-row-field">
            <input
              className="s-input"
              value={form.displayName}
              onChange={(e) => {
                setForm({ ...form, displayName: e.target.value });
              }}
              placeholder="Your name"
              maxLength={80}
            />
          </div>
        </div>

        {/* Public-page URL preview. Slug-editing UI moves to the
            future /dashboard/public-page; until that ships, producers
            can at least see + copy their share link from here so they
            stop wondering where their "Skitza URL" lives. The visible
            host is the brand origin (skitza.app), not the deploy URL —
            see lib/share/public-url for the rationale. */}
        <div className="s-row">
          <div>
            <div className="s-row-label">Public page URL</div>
            <div className="s-row-hint">
              Edit your slug, bio, and brand colors from the public-page editor (coming soon).
            </div>
          </div>
          <div className="s-row-field">
            <div className="s-slug-preview">
              <span className="s-slug-host">
                {PUBLIC_BRAND_ORIGIN.replace(/^https?:\/\//, "")}/join/
              </span>
              <span className="s-slug-handle">{identity.slug}</span>
            </div>
            <a
              className="s-slug-open"
              href={buildJoinUrl(identity.slug)}
              target="_blank"
              rel="noreferrer"
            >
              Open ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Beta plan section ────────────────────────────────────────────── */
function PlanSection({ storageUsage }: { storageUsage: StorageUsageState }) {
  return <PlanFreeView storageUsage={storageUsage} />;
}

function PlanFreeView({ storageUsage }: { storageUsage: StorageUsageState }) {
  const usagePct = (storageUsage.committedBytes / storageUsage.limitBytes) * 100;
  const warningCopy = storageUsage.isFull
    ? "Your audio storage is full. Delete an old Version or Song before uploading."
    : storageUsage.isAtOrAboveWarning
      ? "You're close to the beta storage limit. Delete old Versions or Songs you no longer need."
      : null;
  return (
    <section className="s-reveal" aria-labelledby="settings-plan-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Plan &amp; billing</span>
        <h2 id="settings-plan-h">Beta access</h2>
        <p>Every beta producer has 1 GB of audio storage.</p>
      </header>

      <div className="s-card">
        <div className="s-plan-hero s-plan-hero-free">
          <div className="s-plan-crown s-plan-crown-free">
            <span className="s-dot" style={{ background: "rgb(255 255 255 / 0.4)" }} />
            Current access
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h3>Beta</h3>
            <span className="s-mono" style={{ fontSize: 13, color: "rgb(255 255 255 / 0.7)" }}>
              Free during beta
            </span>
          </div>
          <div
            className="mt-2"
            style={{
              fontSize: 13,
              color: "rgb(255 255 255 / 0.7)",
              maxWidth: 460,
            }}
          >
            Your completed audio Versions share one 1 GB storage limit.
          </div>
        </div>
        <div className="s-usage-grid">
          <UsageCell
            num={formatStorageBytes(storageUsage.usedBytes)}
            suffix="of 1 GB"
            label="Audio used"
            barPct={usagePct}
            barAmber={storageUsage.isAtOrAboveWarning}
          />
          <UsageCell
            num={formatStorageBytes(storageUsage.availableBytes)}
            suffix="available"
            label="Space left"
            barPct={Math.max(0, 100 - usagePct)}
          />
        </div>
        {storageUsage.reservedBytes > 0 ? (
          <p className="s-usage-soft">
            {formatStorageBytes(storageUsage.reservedBytes)} is held for an upload in progress.
          </p>
        ) : null}
        {warningCopy ? <p className="s-storage-warning">{warningCopy}</p> : null}
      </div>
    </section>
  );
}

function UsageCell({
  num,
  suffix,
  label,
  barPct,
  barAmber,
}: {
  num: string;
  suffix: string;
  label: string;
  barPct: number;
  barAmber?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, barPct));
  return (
    <div className="s-usage">
      <div className="s-usage-num">
        {num}
        <span className="s-mono s-usage-num-suffix">{suffix}</span>
      </div>
      <div className="s-usage-lbl">{label}</div>
      <div className="s-usage-bar" aria-hidden>
        <i
          className={barAmber ? "s-amber" : undefined}
          style={{ width: `${clamped.toString()}%` }}
        />
      </div>
    </div>
  );
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1_000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${trimTrailingZeros(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) return `${trimTrailingZeros(bytes / 1_000_000)} MB`;
  return `${trimTrailingZeros(bytes / 1_000_000_000, 2)} GB`;
}

function trimTrailingZeros(value: number, digits = 1): string {
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

/* ─── Notifications section ────────────────────────────────────────── */
function NotifSection() {
  return (
    <section className="s-reveal" aria-labelledby="settings-notif-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Device alerts</span>
        <h2 id="settings-notif-h">Notifications</h2>
        <p>Choose the real Skitza updates this browser can send you.</p>
      </header>
      <PushPreferences />
    </section>
  );
}

/* ─── Getting paid section ─────────────────────────────────────────── */
interface PaymentInstructionsDraft {
  bankFields: BankTransferFields;
  initialBankFields: BankTransferFields;
  originalBankTransfer: string;
  preservedBankText: string | null;
  bitPhone: string;
  note: string;
}

const SETTINGS_BANK_FIELDS: ReadonlyArray<{
  key: keyof BankTransferFields;
  id: string;
  label: string;
  placeholder: string;
  maxLength: number;
  autoComplete?: string;
}> = [
  {
    key: "accountOwner",
    id: "settings-account-owner",
    label: "Account owner",
    placeholder: "Your full name",
    maxLength: 100,
    autoComplete: "name",
  },
  {
    key: "bank",
    id: "settings-bank-name",
    label: "Bank",
    placeholder: "Bank name",
    maxLength: 100,
  },
  {
    key: "branch",
    id: "settings-bank-branch",
    label: "Branch",
    placeholder: "Branch number",
    maxLength: 80,
  },
  {
    key: "accountNumber",
    id: "settings-account-number",
    label: "Account number",
    placeholder: "Account number",
    maxLength: 100,
  },
];

function paymentInstructionsDraft(
  paymentInstructions: PaymentInstructionsState,
): PaymentInstructionsDraft {
  const parsed = parseBankTransferDetails(paymentInstructions.bankTransfer);
  return {
    bankFields: { ...parsed.fields },
    initialBankFields: { ...parsed.fields },
    originalBankTransfer: paymentInstructions.bankTransfer,
    preservedBankText: parsed.preservedText,
    bitPhone: paymentInstructions.bitPhone,
    note: paymentInstructions.note,
  };
}

function bankFieldsMatch(left: BankTransferFields, right: BankTransferFields): boolean {
  return SETTINGS_BANK_FIELDS.every(({ key }) => left[key] === right[key]);
}

function paymentInstructionsFromDraft(draft: PaymentInstructionsDraft): PaymentInstructionsState {
  return {
    // Unknown legacy text is intentionally written back untouched until a
    // producer changes a bank field. This is the same lossless boundary used
    // by onboarding and prevents a Bit/note-only edit from erasing bank data.
    bankTransfer: bankFieldsMatch(draft.bankFields, draft.initialBankFields)
      ? draft.originalBankTransfer
      : serializeBankTransferDetails(draft.bankFields, draft.preservedBankText),
    bitPhone: draft.bitPhone,
    note: draft.note,
  };
}

function samePaymentInstructions(
  left: PaymentInstructionsState,
  right: PaymentInstructionsState,
): boolean {
  return (
    left.bankTransfer === right.bankTransfer &&
    left.bitPhone === right.bitPhone &&
    left.note === right.note
  );
}

function IntegrationsSection({
  paymentInstructions,
  onSave,
  onDraftDirtyChange,
  disabled,
}: {
  paymentInstructions: PaymentInstructionsState;
  onSave: (next: PaymentInstructionsState) => Promise<boolean>;
  onDraftDirtyChange: (dirty: boolean) => void;
  disabled: boolean;
}) {
  const parsedBankDetails = useMemo(
    () => parseBankTransferDetails(paymentInstructions.bankTransfer),
    [paymentInstructions.bankTransfer],
  );
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<PaymentInstructionsDraft>(() =>
    paymentInstructionsDraft(paymentInstructions),
  );
  const previewInstructions = editing ? paymentInstructionsFromDraft(draft) : paymentInstructions;
  const bankTransfer = previewInstructions.bankTransfer.trim();
  const bitPhone = previewInstructions.bitPhone.trim();
  const paymentNote = previewInstructions.note.trim();
  const configuredMethods = Number(Boolean(bankTransfer)) + Number(Boolean(bitPhone));
  const setupStatus =
    configuredMethods === 0
      ? "Not set up"
      : configuredMethods === 1
        ? "1 method ready"
        : "2 methods ready";
  const busy = disabled || submitting;
  const draftDirty =
    editing && !samePaymentInstructions(paymentInstructionsFromDraft(draft), paymentInstructions);

  useEffect(() => {
    onDraftDirtyChange(draftDirty);
  }, [draftDirty, onDraftDirtyChange]);

  function beginEditing() {
    setDraft(paymentInstructionsDraft(paymentInstructions));
    setEditing(true);
  }

  function cancelEditing() {
    if (busy) return;
    setDraft(paymentInstructionsDraft(paymentInstructions));
    setEditing(false);
  }

  async function saveDraft() {
    if (busy) return;
    const next = paymentInstructionsFromDraft(draft);
    if (samePaymentInstructions(next, paymentInstructions)) {
      setEditing(false);
      return;
    }

    setSubmitting(true);
    try {
      if (await onSave(next)) setEditing(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="s-reveal s-payment-section" aria-labelledby="settings-int-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Direct payments</span>
        <h2 id="settings-int-h">How artists pay you</h2>
        <p>Add Bank, Bit, or both.</p>
      </header>

      <div className="s-payment-workspace">
        <div className="s-card s-payment-editor" data-mode={editing ? "edit" : "read"}>
          <div className="s-payment-editor-head">
            <div>
              <span className="s-payment-kicker">
                {editing ? "Editing payment details" : "Manual payment setup"}
              </span>
              <h3>Bank &amp; Bit</h3>
              <p>Only approved artists see these details when payment is due.</p>
            </div>
            <div className="s-payment-local-actions" data-tab-swipe-ignore>
              {!editing ? (
                <>
                  <span
                    className="s-payment-status"
                    data-ready={configuredMethods > 0 ? "true" : "false"}
                    aria-live="polite"
                  >
                    <span aria-hidden />
                    {setupStatus}
                  </span>
                  <button
                    type="button"
                    className="s-btn s-payment-edit-button"
                    onClick={beginEditing}
                    onPointerUp={(event) => {
                      // The Settings swipe surface can consume the follow-up
                      // click after a native pointer gesture. Enter edit mode
                      // on the primary release for desktop and mobile alike;
                      // onClick remains the keyboard/synthetic fallback.
                      if (event.button !== 0) return;
                      if (event.pointerType === "touch") event.preventDefault();
                      beginEditing();
                    }}
                    disabled={disabled}
                    data-tab-swipe-ignore
                  >
                    <PencilLine size={15} strokeWidth={2} aria-hidden />
                    Edit details
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="s-btn s-btn-ghost"
                    onClick={cancelEditing}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="settings-payment-details-form"
                    className="s-btn s-btn-primary"
                    disabled={busy}
                  >
                    {submitting ? "Saving…" : "Save details"}
                  </button>
                </>
              )}
            </div>
          </div>

          {!editing ? (
            <div className="s-payment-readonly" role="region" aria-label="Saved payment details">
              <div className="s-payment-method s-payment-method-bank">
                <PaymentMethodHeading kind="bank" />
                <dl className="s-payment-bank-grid">
                  {SETTINGS_BANK_FIELDS.map(({ key, label }) => {
                    const value = parsedBankDetails.fields[key];
                    return (
                      <div key={key} className="s-payment-readonly-field">
                        <dt>{label}</dt>
                        <dd data-empty={value ? "false" : "true"}>{value || "Not added"}</dd>
                      </div>
                    );
                  })}
                </dl>
                {parsedBankDetails.preservedText ? (
                  <PreservedBankDetails text={parsedBankDetails.preservedText} />
                ) : null}
              </div>

              <div className="s-payment-method s-payment-method-bit">
                <PaymentMethodHeading kind="bit" />
                <div className="s-payment-readonly-field">
                  <div className="s-payment-readonly-label">Bit phone number</div>
                  <div
                    className="s-payment-readonly-value"
                    data-empty={bitPhone ? "false" : "true"}
                  >
                    {bitPhone || "Not added"}
                  </div>
                </div>
              </div>

              <div className="s-payment-note-editor">
                <div className="s-payment-readonly-label">Payment note · Optional</div>
                <div
                  className="s-payment-readonly-value s-payment-readonly-note"
                  data-empty={paymentNote ? "false" : "true"}
                >
                  {paymentNote || "Not added"}
                </div>
              </div>
            </div>
          ) : (
            <form
              id="settings-payment-details-form"
              aria-label="Edit payment details"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDraft();
              }}
            >
              <fieldset disabled={busy} className="s-payment-edit-fields">
                <div className="s-payment-method s-payment-method-bank">
                  <PaymentMethodHeading kind="bank" />
                  <div className="s-payment-bank-grid">
                    {SETTINGS_BANK_FIELDS.map(
                      ({ key, id, label, placeholder, maxLength, autoComplete }) => (
                        <label key={key} className="s-payment-bank-field" htmlFor={id}>
                          <span className="s-payment-field-label">{label}</span>
                          <input
                            id={id}
                            className="s-input sk-native-field"
                            value={draft.bankFields[key]}
                            placeholder={placeholder}
                            maxLength={maxLength}
                            autoComplete={autoComplete}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDraft((current) => ({
                                ...current,
                                bankFields: { ...current.bankFields, [key]: value },
                              }));
                            }}
                          />
                        </label>
                      ),
                    )}
                  </div>
                  {draft.preservedBankText ? (
                    <PreservedBankDetails text={draft.preservedBankText} editing />
                  ) : null}
                </div>

                <div className="s-payment-method s-payment-method-bit">
                  <PaymentMethodHeading kind="bit" />
                  <div className="s-payment-method-field">
                    <label className="s-payment-field-label" htmlFor="settings-bit-phone">
                      Bit phone number
                    </label>
                    <input
                      id="settings-bit-phone"
                      className="s-input sk-native-field"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={32}
                      value={draft.bitPhone}
                      placeholder="+972 50 123 4567"
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, bitPhone: event.target.value }));
                      }}
                    />
                    <div className="s-payment-field-meta">
                      <span>Include country code when needed.</span>
                      <span>{draft.bitPhone.length}/32</span>
                    </div>
                  </div>
                </div>

                <div className="s-payment-note-editor">
                  <label className="s-payment-field-label" htmlFor="settings-payment-note">
                    Payment note <span>Optional</span>
                  </label>
                  <textarea
                    id="settings-payment-note"
                    className="s-input s-textarea s-textarea-compact sk-native-field"
                    rows={2}
                    maxLength={500}
                    value={draft.note}
                    placeholder="Reference or payment instruction"
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, note: event.target.value }));
                    }}
                  />
                  <div className="s-payment-field-meta s-payment-field-meta-end">
                    <span>{draft.note.length}/500</span>
                  </div>
                </div>
              </fieldset>
            </form>
          )}

          <div className="s-payment-boundary" role="note">
            <ShieldCheck size={17} strokeWidth={1.9} aria-hidden />
            <div>
              <div className="s-payment-boundary-title">Payment instructions</div>
              <div className="s-payment-boundary-copy">
                Artists pay you directly. Skitza only keeps the record—it never holds, routes,
                splits, refunds, or credits money.
              </div>
            </div>
          </div>
        </div>

        <aside className="s-payment-preview" aria-label="What the artist will see">
          <div className="s-payment-preview-glow" aria-hidden />
          <div className="s-payment-preview-head">
            <span>What the artist will see</span>
            <Eye size={16} strokeWidth={1.8} aria-hidden />
          </div>
          <div className="s-payment-preview-intro">
            <span>Payment details</span>
            <h3>Pay your producer.</h3>
            <p>Choose a method and keep your receipt.</p>
          </div>

          <div className="s-payment-preview-methods">
            <div className="s-payment-preview-method" data-empty={bankTransfer ? "false" : "true"}>
              <span className="s-payment-preview-icon" aria-hidden>
                <Landmark size={15} strokeWidth={1.8} />
              </span>
              <div>
                <span className="s-payment-preview-label">Bank transfer</span>
                <span className="s-payment-preview-value">{bankTransfer || "Not added yet"}</span>
              </div>
            </div>
            <div className="s-payment-preview-method" data-empty={bitPhone ? "false" : "true"}>
              <span className="s-payment-preview-icon" aria-hidden>
                <Smartphone size={15} strokeWidth={1.8} />
              </span>
              <div>
                <span className="s-payment-preview-label">Bit number</span>
                <span className="s-payment-preview-value">{bitPhone || "Not added yet"}</span>
              </div>
            </div>
          </div>

          {paymentNote ? (
            <div className="s-payment-preview-note">
              <span>Producer note</span>
              <p>{paymentNote}</p>
            </div>
          ) : null}

          <div className="s-payment-preview-foot">
            <ShieldCheck size={14} strokeWidth={1.9} aria-hidden />
            <span>Shown only after approval</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PaymentMethodHeading({ kind }: { kind: "bank" | "bit" }) {
  const bank = kind === "bank";
  return (
    <div className="s-payment-method-head">
      <span className="s-payment-method-icon" aria-hidden>
        {bank ? (
          <Landmark size={18} strokeWidth={1.8} />
        ) : (
          <Smartphone size={18} strokeWidth={1.8} />
        )}
      </span>
      <div>
        <h4>{bank ? "Bank transfer" : "Bit"}</h4>
        <p>
          {bank
            ? "Account owner, bank, branch, and account number."
            : "Phone linked to your Bit account."}
        </p>
      </div>
    </div>
  );
}

function PreservedBankDetails({ text, editing = false }: { text: string; editing?: boolean }) {
  return (
    <div className="s-payment-preserved" role="note">
      <div className="s-payment-readonly-label">Current saved bank details</div>
      <pre>{text}</pre>
      <p>
        {editing
          ? "Kept as-is unless you edit a bank field above."
          : "Stored in an older format and kept exactly as saved."}
      </p>
    </div>
  );
}

/* ─── Currency & region section ────────────────────────────────────── */
function RegionSection({ form, setForm }: { form: FormState; setForm: (next: FormState) => void }) {
  return (
    <section className="s-reveal" aria-labelledby="settings-region-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Localization</span>
        <h2 id="settings-region-h">Currency &amp; region</h2>
        <p>Defaults for Store pricing, tax, and the calendar week.</p>
      </header>
      <div className="s-card">
        <div className="s-row">
          <div>
            <div className="s-row-label">Currency</div>
            <div className="s-row-hint">
              Default for new storefront products. You can override per product.
            </div>
          </div>
          <div className="s-row-field" style={{ maxWidth: 220 }}>
            <select
              className="s-select"
              value={form.defaultCurrency}
              onChange={(e) => {
                setForm({
                  ...form,
                  defaultCurrency: e.target.value as FormState["defaultCurrency"],
                });
              }}
              aria-label="Default currency"
            >
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="ILS">ILS — Israeli Shekel</option>
              <option value="GBP">GBP — Pound Sterling</option>
            </select>
          </div>
        </div>
        <div className="s-row">
          <div>
            <label className="s-row-label" htmlFor="settings-tax-treatment">
              Tax treatment
            </label>
            <div className="s-row-hint">
              Applied to Store products and used as the default for new private offers.
            </div>
          </div>
          <div className="s-row-field" style={{ maxWidth: 260 }}>
            <select
              id="settings-tax-treatment"
              className="s-select"
              value={form.taxMode}
              onChange={(event) => {
                setForm({
                  ...form,
                  taxMode: event.target.value as FormState["taxMode"],
                });
              }}
            >
              <option value="tax_free">Tax-free</option>
              <option value="tax_included">Included in price</option>
              <option value="tax_added">Added at checkout</option>
            </select>
          </div>
        </div>
        {form.taxMode === "tax_free" ? null : (
          <div className="s-row">
            <div>
              <label className="s-row-label" htmlFor="settings-tax-rate">
                Tax rate
              </label>
              <div className="s-row-hint">Use a whole-number percentage, such as 18%.</div>
            </div>
            <div className="s-row-field" style={{ maxWidth: 160 }}>
              <input
                id="settings-tax-rate"
                className="s-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                value={form.taxRatePct}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  setForm({
                    ...form,
                    taxRatePct: Number.isFinite(next) ? Math.max(0, Math.min(100, next)) : 0,
                  });
                }}
              />
            </div>
          </div>
        )}
        <div className="s-row">
          <div>
            <div className="s-row-label">Week starts on</div>
            <div className="s-row-hint">Used by the calendar week grid.</div>
          </div>
          <div className="s-row-field">
            <div className="s-seg" role="radiogroup" aria-label="Week starts on">
              {(
                [
                  ["sunday", "Sunday"],
                  ["monday", "Monday"],
                ] as const
              ).map(([k, label]) => {
                const isOn = form.weekStart === k;
                return (
                  <button
                    key={k}
                    type="button"
                    className={isOn ? "s-active" : ""}
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => {
                      setForm({ ...form, weekStart: k });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Icons ────────────────────────────────────────────────────────── */
// Tiny inline SVGs matching the reference. Kept local so the settings
// page has no dependency on a third-party icon set. 14px size matches
// the sub-nav row metrics.
const ICONS = {
  user: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </svg>
  ),
  bolt: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  bell: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 004 0" />
    </svg>
  ),
  wallet: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M4 7V5.5A2.5 2.5 0 016.5 3H18v4" />
      <path d="M4 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a3 3 0 01-3-3V7.5A2.5 2.5 0 014.5 5H18" />
      <path d="M17 12h5v4h-5a2 2 0 010-4z" />
    </svg>
  ),
  globe: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </svg>
  ),
} as const;
