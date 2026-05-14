"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "~/components/ui/toast";
import { updateProducer } from "./actions";
import { PaymentCard } from "./payment-card";
import { StripeCard } from "./stripe-card";
import {
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationState,
  type SettingsSectionKey,
  SUB_NAV,
} from "./settings-keys";

// One screen, five sections, one savebar. The whole flow lives in this
// client component so the savebar can corral edits across sections
// without losing local state on switch (state moves UP to here; the
// individual sections are stateless render functions that receive
// the slice they care about).
//
// Stripe + Tranzila + (future) Google Calendar have their own actions
// and don't ride the savebar — they each commit on click. The savebar
// only debounces edits to fields owned by `form` and `notifs`.

interface InitialState {
  displayName: string;
  defaultCurrency: "USD" | "EUR" | "GBP" | "ILS";
  weekStart: "sun" | "mon";
  plan: "free" | "pro";
  notifications: NotificationState;
}

interface IdentityState {
  avatarUrl: string | null;
  initials: string;
  email: string;
}

interface IntegrationsState {
  tranzilaConnected: boolean;
  stripeConnected: boolean;
  stripeChargesEnabled: boolean;
  billingEmail: string;
  defaultBusinessName: string;
}

interface FormState {
  displayName: string;
  defaultCurrency: "USD" | "EUR" | "GBP" | "ILS";
  weekStart: "sun" | "mon";
}

export function SettingsClient({
  initialActive,
  initial,
  identity,
  integrations,
}: {
  initialActive: SettingsSectionKey;
  initial: InitialState;
  identity: IdentityState;
  integrations: IntegrationsState;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // Section state — purely local. Initial value comes from `?section=`
  // URL param (server-resolved) so deep-links still work; subsequent
  // sub-nav clicks update only this state (no URL change) so unsaved
  // edits in `form` / `notifs` survive a section switch.
  const [active, setActive] = useState<SettingsSectionKey>(initialActive);

  const initialForm: FormState = {
    displayName: initial.displayName,
    defaultCurrency: initial.defaultCurrency,
    weekStart: initial.weekStart,
  };

  // `form` holds in-progress edits; `savedForm` is the last persisted
  // snapshot. Dirty = JSON-different from saved. (Stringify-compare is
  // fine here — primitive fields only, no Date objects to worry about.)
  const [form, setForm] = useState<FormState>(initialForm);
  const [savedForm, setSavedForm] = useState<FormState>(initialForm);

  const [notifs, setNotifs] = useState<NotificationState>(initial.notifications);
  const [savedNotifs, setSavedNotifs] = useState<NotificationState>(
    initial.notifications,
  );

  const dirty = useMemo(() => {
    return (
      JSON.stringify(form) !== JSON.stringify(savedForm) ||
      JSON.stringify(notifs) !== JSON.stringify(savedNotifs)
    );
  }, [form, savedForm, notifs, savedNotifs]);

  function onDiscard() {
    setForm(savedForm);
    setNotifs(savedNotifs);
  }

  function onSave() {
    if (!dirty || pending) return;

    // Build a minimal patch — only the fields that actually changed.
    // Shipping a smaller payload is cheap-and-friendly, and the
    // server's `update` mutation merges jsonb partials.
    const patch: Parameters<typeof updateProducer>[0] = {};
    if (form.displayName !== savedForm.displayName)
      patch.displayName = form.displayName;
    if (form.defaultCurrency !== savedForm.defaultCurrency)
      patch.defaultCurrency = form.defaultCurrency;
    if (form.weekStart !== savedForm.weekStart) patch.weekStart = form.weekStart;
    if (JSON.stringify(notifs) !== JSON.stringify(savedNotifs)) {
      // Send only the event keys whose value diverges from saved.
      // The server's NotificationPrefsInput is a partial map; missing
      // keys keep their existing column value via the merge logic.
      const notifPatch: NotificationState = {};
      for (const ev of NOTIFICATION_EVENTS) {
        const prev = savedNotifs[ev.key];
        const next = notifs[ev.key];
        if (!prev || !next) continue;
        if (prev.email !== next.email || prev.app !== next.app) {
          notifPatch[ev.key] = next;
        }
      }
      if (Object.keys(notifPatch).length > 0) {
        patch.notificationPrefs = notifPatch;
      }
    }

    startTransition(async () => {
      const res = await updateProducer(patch);
      if (res.ok) {
        setSavedForm(form);
        setSavedNotifs(notifs);
        toast("Settings saved.", "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="s-layout">
      {/* Left sub-nav. Eyebrow + H1 hidden on mobile (the nav becomes a
          horizontal chip rail). */}
      <nav className="s-nav" aria-label="Settings sections">
        <span className="s-eyebrow">Workspace</span>
        <h1>Settings</h1>
        {SUB_NAV.map((item) => {
          const Icon = ICONS[item.iconKey];
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={isActive ? "s-active" : ""}
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                setActive(item.key);
              }}
            >
              <Icon />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Right content — single section mounted at a time so the
          reveal animation re-runs on every switch (key={active}). */}
      <div className="s-content">
        <div className="s-content-inner" key={active}>
          {active === "profile" && (
            <ProfileSection
              form={form}
              setForm={setForm}
              identity={identity}
            />
          )}
          {active === "plan" && <PlanSection plan={initial.plan} />}
          {active === "notif" && (
            <NotifSection notifs={notifs} setNotifs={setNotifs} />
          )}
          {active === "int" && (
            <IntegrationsSection integrations={integrations} />
          )}
          {active === "region" && (
            <RegionSection form={form} setForm={setForm} />
          )}
        </div>
      </div>

      {/* Save bar — slides up only when dirty. Disabled while saving. */}
      <div
        className={`s-savebar${dirty ? " s-show" : ""}`}
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
            disabled={pending || !dirty}
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
        <p>
          How you appear on your public producer page and in client invitations.
        </p>
      </header>
      <div className="s-card">
        <div className="s-row">
          <div>
            <div className="s-row-label">Avatar</div>
            <div className="s-row-hint">
              Synced from your Google account. Change it where you signed in.
            </div>
          </div>
          <div
            className="s-row-field"
            style={{ display: "flex", alignItems: "center", gap: 14 }}
          >
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
                  background:
                    "linear-gradient(135deg, #fcd34d, #fb923c)",
                }}
              >
                {identity.initials}
              </div>
            )}
            <span className="text-xs text-[rgb(var(--fg-muted))]">
              {identity.email}
            </span>
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
  // Hard-coded usage numbers for v1. Real artist count + GB storage
  // measurement land in a separate Plan & Billing task (the design's
  // "Free has 3 artists + 5 GB" limits are not yet enforced).
  const artistsUsed = 2;
  const artistsLim = 3;
  const storageUsed = 3.2;
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
            <span
              className="s-dot"
              style={{ background: "rgb(255 255 255 / 0.4)" }}
            />
            Current plan · No card on file
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h3>Free</h3>
            <span
              className="s-mono"
              style={{ fontSize: 13, color: "rgb(255 255 255 / 0.7)" }}
            >
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
          <div className="s-plan-ctas">
            <ComingSoonButton kind="amber">Upgrade to Pro</ComingSoonButton>
            <ComingSoonButton kind="ghost">See what&apos;s in Pro</ComingSoonButton>
          </div>
        </div>
        <div className="s-usage-grid">
          <UsageCell
            num={artistsUsed.toString()}
            suffix={`/ ${artistsLim.toString()} artists`}
            label="Artists"
            barPct={(artistsUsed / artistsLim) * 100}
          />
          <UsageCell
            num={`${storageUsed.toString()} GB`}
            suffix={`/ ${storageLim.toString()} GB`}
            label="Storage"
            barPct={(storageUsed / storageLim) * 100}
            barAmber
          />
        </div>
      </div>

      <div className="s-card">
        <div className="s-row">
          <div>
            <div className="s-row-label">Pro plan</div>
            <div className="s-row-hint">Lift the limits without leaving the app.</div>
          </div>
          <div
            className="s-row-field"
            style={{ display: "flex", alignItems: "center", gap: 14 }}
          >
            <div style={{ flex: 1 }}>
              <div
                className="s-mono"
                style={{ fontSize: 12, color: "rgb(var(--fg-muted))" }}
              >
                Unlimited artists · 100 GB storage · Custom storefront ·
                Payment automation
              </div>
              <div
                className="mt-1 font-extrabold"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 18,
                  letterSpacing: "-0.02em",
                }}
              >
                $12{" "}
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
            <ComingSoonButton kind="amber">Upgrade</ComingSoonButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanProView() {
  const artistsCount = 12;
  const storageUsed = 47;
  const storageLim = 100;
  return (
    <section className="s-reveal" aria-labelledby="settings-plan-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Plan &amp; billing</span>
        <h2 id="settings-plan-h">Plan</h2>
        <p>You&apos;re on Pro. Renewal handled by Stripe — change anytime.</p>
      </header>

      <div className="s-card">
        <div className="s-plan-hero s-plan-hero-pro">
          <div className="s-plan-crown s-plan-crown-pro">
            <span
              className="s-dot"
              style={{ background: "rgb(var(--brand-primary))" }}
            />
            Current plan · Renews Jun 12, 2026
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h3>Pro</h3>
            <span
              className="s-mono"
              style={{ fontSize: 13, color: "rgb(255 255 255 / 0.7)" }}
            >
              $12 / month
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
            Unlimited artists · 100 GB storage · Custom storefront ·
            Payment automation.
          </div>
          <div className="s-plan-ctas">
            <ComingSoonButton kind="ghost">Manage billing</ComingSoonButton>
            <ComingSoonButton kind="link-muted">
              Switch to Free
            </ComingSoonButton>
          </div>
        </div>
        <div className="s-usage-grid">
          <UsageCell
            num={artistsCount.toString()}
            suffix="artists · no limit"
            label="Artists"
            barPct={8}
          />
          <UsageCell
            num={`${storageUsed.toString()} GB`}
            suffix={`/ ${storageLim.toString()} GB`}
            label="Storage"
            barPct={(storageUsed / storageLim) * 100}
            barAmber
          />
        </div>
      </div>

      <div className="s-card">
        <div className="s-row">
          <div>
            <div className="s-row-label">Payment method</div>
            <div className="s-row-hint">
              Charged via Stripe on the 12th of each month.
            </div>
          </div>
          <div
            className="s-row-field"
            style={{ display: "flex", alignItems: "center", gap: 14 }}
          >
            <div
              className="font-extrabold"
              style={{
                width: 40,
                height: 28,
                borderRadius: 6,
                background: "#1A1F71",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
                fontSize: 11,
                letterSpacing: "-0.02em",
              }}
            >
              VISA
            </div>
            <div>
              <div className="s-mono" style={{ fontSize: 13.5, fontWeight: 700 }}>
                •••• 4242
              </div>
              <div
                style={{ fontSize: 11.5, color: "rgb(var(--fg-muted))" }}
              >
                Expires 09/27
              </div>
            </div>
            <ComingSoonButton kind="ghost" style={{ marginLeft: "auto" }}>
              Update
            </ComingSoonButton>
          </div>
        </div>
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

// Pro/Upgrade-style CTAs that don't have a destination yet. Toasting on
// click is friendlier than swallowing the press — the producer at least
// knows the button works.
function ComingSoonButton({
  kind,
  children,
  style,
}: {
  kind: "amber" | "ghost" | "link-muted";
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { toast } = useToast();
  const cls =
    kind === "amber"
      ? "s-btn s-btn-amber"
      : kind === "ghost"
      ? "s-btn s-btn-ghost"
      : "s-plan-link-muted";
  return (
    <button
      type="button"
      className={cls}
      style={style}
      onClick={() => {
        toast("Coming soon.", "success");
      }}
    >
      {children}
    </button>
  );
}

/* ─── Notifications section ────────────────────────────────────────── */
function NotifSection({
  notifs,
  setNotifs,
}: {
  notifs: NotificationState;
  setNotifs: (next: NotificationState) => void;
}) {
  function set(eventKey: string, channel: NotificationChannel, value: boolean) {
    const prev = notifs[eventKey] ?? { email: false, app: false };
    setNotifs({ ...notifs, [eventKey]: { ...prev, [channel]: value } });
  }

  return (
    <section className="s-reveal" aria-labelledby="settings-notif-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Inbox</span>
        <h2 id="settings-notif-h">Notifications</h2>
        <p>Choose how Skitza pings you about activity in your workspace.</p>
      </header>
      <div className="s-card">
        <div className="s-notif-head" role="row">
          <div className="s-h s-h-lead">Event</div>
          <div className="s-h">Email</div>
          <div className="s-h">In-app</div>
        </div>
        {NOTIFICATION_EVENTS.map((ev) => {
          const cur = notifs[ev.key] ?? ev.defaults;
          return (
            <div className="s-notif-row" role="row" key={ev.key}>
              <div>
                <div className="s-notif-name">{ev.name}</div>
                <div className="s-notif-sub">{ev.sub}</div>
              </div>
              <div className="s-notif-cell">
                <Toggle
                  on={cur.email}
                  onChange={(v) => {
                    set(ev.key, "email", v);
                  }}
                  ariaLabel={`Email notifications for ${ev.name}`}
                />
              </div>
              <div className="s-notif-cell">
                <Toggle
                  on={cur.app}
                  onChange={(v) => {
                    set(ev.key, "app", v);
                  }}
                  ariaLabel={`In-app notifications for ${ev.name}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-[rgb(var(--fg-muted))]">
        Email + in-app delivery for each event is currently being wired up
        feature-by-feature. Toggles save here; live notifications switch on as
        each feature ships.
      </p>
    </section>
  );
}

function Toggle({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className="s-toggle"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={() => {
        onChange(!on);
      }}
    />
  );
}

/* ─── Integrations section ─────────────────────────────────────────── */
function IntegrationsSection({
  integrations,
}: {
  integrations: IntegrationsState;
}) {
  const paymentsConnected =
    integrations.tranzilaConnected ||
    (integrations.stripeConnected && integrations.stripeChargesEnabled);

  return (
    <section className="s-reveal" aria-labelledby="settings-int-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">External tools</span>
        <h2 id="settings-int-h">Integrations</h2>
        <p>
          Wire up the tools you already use. Authorized connections sync in both
          directions.
        </p>
      </header>
      <div className="s-card">
        <div className="s-intlist">
          {/* Payments — one consolidated row. Tranzila (Israel) or
              Stripe (rest of world). The detail cards below this card
              are where the producer actually does the connecting; the
              row is the summary status. */}
          <div className="s-introw">
            <div
              className="s-introw-logo"
              style={{ background: "#111009", color: "#fff" }}
            >
              ₪$
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="s-introw-title">
                Payments
                {paymentsConnected && (
                  <span className="s-chip s-chip-success">
                    <span
                      className="s-dot"
                      style={{ background: "rgb(var(--fg-success))" }}
                    />
                    Connected
                  </span>
                )}
              </div>
              <div className="s-introw-sub">
                Tranzila for Israeli producers, Stripe for the rest of the world.
              </div>
            </div>
          </div>

          {/* Google Calendar — coming soon. No connect button to avoid
              promising a flow that doesn't exist yet. */}
          <div className="s-introw">
            <div
              className="s-introw-logo"
              style={{
                background: "#fff",
                color: "#4285F4",
                border: "1px solid rgb(var(--border-subtle))",
              }}
            >
              G
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="s-introw-title">
                Google Calendar
                <span className="s-chip s-chip-neutral">Coming soon</span>
              </div>
              <div className="s-introw-sub">Two-way session sync.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Payment setup detail. Both regional flows visible so the
          producer can pick whichever applies — country auto-detection
          will land with the future Studio section. */}
      <div className="mt-8 space-y-6">
        <div>
          <h3 className="font-display text-base font-bold tracking-tight">
            Payments — Israel (Tranzila)
          </h3>
          <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
            Direct payouts to your Tranzila terminal. Approved manually by Skitza
            once you submit the form.
          </p>
          <div className="mt-3 rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
            <PaymentCard
              connected={integrations.tranzilaConnected}
              defaultBusinessName={integrations.defaultBusinessName}
              defaultContactEmail={integrations.billingEmail}
            />
          </div>
        </div>

        <div>
          <h3 className="font-display text-base font-bold tracking-tight">
            Payments — rest of world (Stripe)
          </h3>
          <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
            Stripe Connect onboarding. Skitza adds no platform fee — you keep
            everything minus Stripe&apos;s standard rates.
          </p>
          <div className="mt-3 rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
            <StripeCard
              connected={integrations.stripeConnected}
              chargesEnabled={integrations.stripeChargesEnabled}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Language & region section ────────────────────────────────────── */
function RegionSection({
  form,
  setForm,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
}) {
  return (
    <section className="s-reveal" aria-labelledby="settings-region-h">
      <header className="s-section-head">
        <span className="s-section-eyebrow">Localization</span>
        <h2 id="settings-region-h">Language &amp; region</h2>
        <p>Defaults for storefront pricing and the calendar week.</p>
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
                  defaultCurrency: e.target
                    .value as FormState["defaultCurrency"],
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
            <div className="s-row-label">Week starts on</div>
            <div className="s-row-hint">Used by the calendar week grid.</div>
          </div>
          <div className="s-row-field">
            <div className="s-seg" role="radiogroup" aria-label="Week starts on">
              {(
                [
                  ["sun", "Sunday"],
                  ["mon", "Monday"],
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
