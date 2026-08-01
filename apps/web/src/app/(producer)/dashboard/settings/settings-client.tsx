"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PushPreferences } from "~/components/push/push-preferences";
import { useToast } from "~/components/ui/toast";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useProducerDisplayNameDraft } from "~/components/runtime-state/use-runtime-state";
import { PUBLIC_BRAND_ORIGIN, buildJoinUrl } from "~/lib/share/public-url";
import { markMeaningfulInstallAction } from "~/lib/pwa/install-guidance";
import { useTabSwipe } from "~/components/native/use-tab-swipe";
import { updateProducer } from "./actions";
import {
  SETTINGS_SECTION_KEYS,
  type SettingsSectionKey,
  SUB_NAV,
} from "./settings-keys";

// One screen, five sections, one savebar. The whole flow lives in this
// client component so the savebar can corral edits across sections
// without losing local state on switch (state moves UP to here; the
// individual sections are stateless render functions that receive
// the slice they care about).
//
// Future integrations have their own actions and don't ride the savebar.
// Producer-owned settings, including payment instructions, use the same
// savebar so edits survive section switches.

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
  paymentInstructions: PaymentInstructionsState;
}

export function SettingsClient({
  initialActive,
  initial,
  identity,
}: {
  initialActive: SettingsSectionKey;
  initial: InitialState;
  identity: IdentityState;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();

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
    paymentInstructions: initial.paymentInstructions,
  };

  // `form` holds in-progress edits; `savedForm` is the last persisted
  // snapshot. Dirty = JSON-different from saved. (Stringify-compare is
  // fine here — strings and one string-only nested object, no Dates.)
  const [form, setForm] = useState<FormState>(initialForm);
  const [savedForm, setSavedForm] = useState<FormState>(initialForm);
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
  //   payment instructions     → int
  // Plan doesn't own savebar-managed fields, so it never appears here.
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
    if (
      JSON.stringify(form.paymentInstructions) !== JSON.stringify(savedForm.paymentInstructions)
    ) {
      out.add("int");
    }
    return out;
  }, [form, savedForm]);

  function onDiscard() {
    displayNameDraft.clearDraft();
    setForm(savedForm);
  }

  function onSave() {
    if (!dirty || pending) return;
    if (!online) {
      toast("Reconnect to save settings.", "error");
      return;
    }

    // Build a minimal patch — only the fields that actually changed.
    // Shipping a smaller payload is cheap-and-friendly, and the
    // server's `update` mutation merges jsonb partials.
    const patch: Parameters<typeof updateProducer>[0] = {};
    if (form.displayName !== savedForm.displayName) patch.displayName = form.displayName;
    if (form.defaultCurrency !== savedForm.defaultCurrency)
      patch.defaultCurrency = form.defaultCurrency;
    if (form.taxMode !== savedForm.taxMode) patch.taxMode = form.taxMode;
    if (form.taxRatePct !== savedForm.taxRatePct) patch.taxRatePct = form.taxRatePct;
    if (form.weekStart !== savedForm.weekStart) patch.weekStart = form.weekStart;
    if (
      JSON.stringify(form.paymentInstructions) !== JSON.stringify(savedForm.paymentInstructions)
    ) {
      patch.paymentInstructions = form.paymentInstructions;
    }
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
              paymentInstructions: res.saved?.paymentInstructions
                ? form.paymentInstructions
                : current.paymentInstructions,
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

  return (
    <div
      className="s-layout"
      data-role-switch-unsaved={dirty ? "true" : undefined}
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

      {/* Right content — one stable swipe panel with a single section
          mounted at a time so each section still enters independently. */}
      <div
        className="s-content [touch-action:pan-y_pinch-zoom]"
        data-tab-swipe-surface
        {...tabSwipeHandlers}
      >
        <div className="s-content-inner" data-tab-swipe-panel>
          {active === "profile" && (
            <ProfileSection form={form} setForm={setForm} identity={identity} />
          )}
          {active === "plan" && <PlanSection plan={initial.plan} />}
          {active === "notif" && <NotifSection />}
          {active === "int" && (
            <IntegrationsSection
              paymentInstructions={form.paymentInstructions}
              onChange={(paymentInstructions) => {
                setForm({ ...form, paymentInstructions });
              }}
            />
          )}
          {active === "region" && <RegionSection form={form} setForm={setForm} />}
        </div>
      </div>

      {/* Save bar — slides up only when dirty. Disabled while saving. */}
      <div
        className={`s-savebar${dirty ? "s-show" : ""}`}
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
            disabled={pending}
          >
            Discard
          </button>
          <button
            type="button"
            className="s-btn s-btn-amber"
            onClick={onSave}
            disabled={pending || !dirty || !online}
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

/* ─── Plan section (fake but pretty) ───────────────────────────────── */
function PlanSection({ plan }: { plan: "free" | "pro" }) {
  if (plan === "pro") return <PlanProView />;
  return <PlanFreeView />;
}

function PlanFreeView() {
  // Free-plan limits ("3 artists, 5 GB") for the suffix copy. Actual
  // usage measurement (count of producer.artists rows, sum of
  // audioAsset bytes) lands in a separate task — until then the cells
  // show em-dash placeholders so the producer never sees wrong
  // numbers and loses trust in the rest of the page.
  const artistsLim = 3;
  const storageLim = 5;
  return (
    <section className="s-reveal" aria-labelledby="settings-plan-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Plan &amp; billing</span>
        <h2 id="settings-plan-h">Plan</h2>
        <p>You&apos;re on the Free plan. Upgrade to Pro for more artists and storage.</p>
      </header>

      <div className="s-card">
        <div className="s-plan-hero s-plan-hero-free">
          <div className="s-plan-crown s-plan-crown-free">
            <span className="s-dot" style={{ background: "rgb(255 255 255 / 0.4)" }} />
            Current plan
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h3>Free</h3>
            <span className="s-mono" style={{ fontSize: 13, color: "rgb(255 255 255 / 0.7)" }}>
              $0 / month
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
            Up to 3 artists · 5 GB storage · Standard storefront.
          </div>
        </div>
        <div className="s-usage-grid">
          <UsageCell
            num="—"
            suffix={`of ${artistsLim.toString()} artists`}
            label="Artists"
            barPct={0}
          />
          <UsageCell
            num="—"
            suffix={`of ${storageLim.toString()} GB`}
            label="Storage"
            barPct={0}
            barAmber
          />
        </div>
        <p className="s-usage-soft">
          Live usage tracking ships shortly — we&apos;ll fill these in automatically once it&apos;s
          on.
        </p>
      </div>

      <div className="s-card">
        <div className="s-row">
          <div>
            <div className="s-row-label">Pro plan</div>
            <div className="s-row-hint">Lift the limits without leaving the app.</div>
          </div>
          <div className="s-row-field" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div className="s-mono" style={{ fontSize: 12, color: "rgb(var(--fg-muted))" }}>
                Unlimited artists · 100 GB storage · Custom storefront
              </div>
              <div
                className="mt-1 font-extrabold"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 18,
                  letterSpacing: "-0.02em",
                }}
              >
                $29{" "}
                <span
                  className="s-mono"
                  style={{
                    fontWeight: 500,
                    fontSize: 12,
                    color: "rgb(var(--fg-muted))",
                  }}
                >
                  / month
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanProView() {
  // Pro plan: 100 GB storage cap is the documented limit, artists are
  // unlimited. Real usage figures land alongside the Free-plan
  // measurement (same task) — until then, em-dash placeholders.
  const storageLim = 100;
  return (
    <section className="s-reveal" aria-labelledby="settings-plan-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Plan &amp; billing</span>
        <h2 id="settings-plan-h">Plan</h2>
        <p>You&apos;re on Pro.</p>
      </header>

      <div className="s-card">
        <div className="s-plan-hero s-plan-hero-pro">
          <div className="s-plan-crown s-plan-crown-pro">
            <span className="s-dot" style={{ background: "rgb(var(--brand-primary))" }} />
            Current plan · Renews Jun 12, 2026
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h3>Pro</h3>
            <span className="s-mono" style={{ fontSize: 13, color: "rgb(255 255 255 / 0.7)" }}>
              $29 / month
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
            Unlimited artists · 100 GB storage · Custom storefront.
          </div>
        </div>
        <div className="s-usage-grid">
          <UsageCell num="—" suffix="artists · no limit" label="Artists" barPct={0} />
          <UsageCell
            num="—"
            suffix={`of ${storageLim.toString()} GB`}
            label="Storage"
            barPct={0}
            barAmber
          />
        </div>
        <p className="s-usage-soft">
          Live usage tracking ships shortly — we&apos;ll fill these in automatically once it&apos;s
          on.
        </p>
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

/* ─── Integrations section ─────────────────────────────────────────── */
function IntegrationsSection({
  paymentInstructions,
  onChange,
}: {
  paymentInstructions: PaymentInstructionsState;
  onChange: (next: PaymentInstructionsState) => void;
}) {
  return (
    <section className="s-reveal" aria-labelledby="settings-int-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Payments &amp; tools</span>
        <h2 id="settings-int-h">Integrations</h2>
        <p>Tell artists how to pay you directly.</p>
      </header>

      <div className="s-card">
        <div className="s-payment-boundary" role="note">
          <span className="s-payment-boundary-dot" aria-hidden="true" />
          <div>
            <div className="s-payment-boundary-title">Payment instructions</div>
            <div className="s-payment-boundary-copy">
              Artists pay you directly. Skitza only keeps the record—it never holds, routes, splits,
              refunds, or credits money.
            </div>
          </div>
        </div>

        <div className="s-row">
          <div>
            <label className="s-row-label" htmlFor="settings-bank-transfer">
              Bank transfer
            </label>
            <div className="s-row-hint">Account name, bank, branch, and account number.</div>
          </div>
          <div className="s-row-field">
            <textarea
              id="settings-bank-transfer"
              className="s-input s-textarea"
              rows={4}
              maxLength={500}
              value={paymentInstructions.bankTransfer}
              placeholder={"Account name\nBank · branch · account number"}
              onChange={(event) => {
                onChange({
                  ...paymentInstructions,
                  bankTransfer: event.target.value,
                });
              }}
            />
          </div>
        </div>

        <div className="s-row">
          <div>
            <label className="s-row-label" htmlFor="settings-bit-phone">
              Bit
            </label>
            <div className="s-row-hint">The phone number linked to your Bit account.</div>
          </div>
          <div className="s-row-field">
            <input
              id="settings-bit-phone"
              className="s-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={32}
              value={paymentInstructions.bitPhone}
              placeholder="+972 50 123 4567"
              onChange={(event) => {
                onChange({
                  ...paymentInstructions,
                  bitPhone: event.target.value,
                });
              }}
            />
          </div>
        </div>

        <div className="s-row">
          <div>
            <label className="s-row-label" htmlFor="settings-payment-note">
              Payment note
            </label>
            <div className="s-row-hint">Optional note shown with your payment details.</div>
          </div>
          <div className="s-row-field">
            <textarea
              id="settings-payment-note"
              className="s-input s-textarea s-textarea-compact"
              rows={3}
              maxLength={500}
              value={paymentInstructions.note}
              placeholder="Add a reference, timing note, or other instruction"
              onChange={(event) => {
                onChange({
                  ...paymentInstructions,
                  note: event.target.value,
                });
              }}
            />
          </div>
        </div>
      </div>
    </section>
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
              <div className="s-row-hint">
                Use a whole-number percentage, such as 18%.
              </div>
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
                    taxRatePct: Number.isFinite(next)
                      ? Math.max(0, Math.min(100, next))
                      : 0,
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
  plug: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 11-12 0zM12 18v3" />
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
