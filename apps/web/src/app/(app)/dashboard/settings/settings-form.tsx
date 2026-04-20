"use client";

import { type SyntheticEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label, Select } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import {
  ValidationHint,
  validateDisplayName,
  validateSlug,
  type ValidationState,
} from "~/components/ui/validation";
import { updateProducer } from "./actions";

interface ProducerProfile {
  displayName: string;
  slug: string;
  defaultCurrency: "USD" | "EUR" | "GBP" | "ILS";
  timezone: string;
  brand: {
    primary?: string;
    accent?: string;
    logoUrl?: string;
  };
}

// Defaults matching globals.css :root — used as placeholders on the
// color inputs when the producer hasn't set their own. Mirrors the
// Studio Monitor palette so the color pickers land somewhere sensible.
const DEFAULT_PRIMARY = "#D4960A";
const DEFAULT_ACCENT = "#B06830";

function sanitizeSlug(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

export function SettingsForm({ profile }: { profile: ProducerProfile }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [slug, setSlug] = useState(profile.slug);
  const [defaultCurrency, setDefaultCurrency] = useState(profile.defaultCurrency);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [primary, setPrimary] = useState(profile.brand.primary ?? DEFAULT_PRIMARY);
  const [accent, setAccent] = useState(profile.brand.accent ?? DEFAULT_ACCENT);
  const [logoUrl, setLogoUrl] = useState(profile.brand.logoUrl ?? "");
  // "Touched" bookkeeping — fields don't flash required/invalid until
  // the user has interacted with them. Keeps first paint calm.
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  const displayNameState: ValidationState = displayNameTouched
    ? validateDisplayName(displayName)
    : { kind: "idle" };
  // Slug mirrors the server's zod contract (3-48 chars, lowercase +
  // digits + single dashes). We don't query the DB here for "taken"
  // availability — the server is source of truth on uniqueness and the
  // form still submits; a future availability check would plug into
  // the `pending → valid/invalid` transition without touching callers.
  const slugState: ValidationState = slugTouched
    ? validateSlug(slug)
    : { kind: "idle" };

  // Detect which fields actually changed so we only ship a minimal PATCH.
  // zod's .optional() at the server also accepts "same value"; this is
  // mostly about being kind on the wire and not bumping updatedAt
  // unnecessarily.
  const patch = useMemo(() => {
    const out: Parameters<typeof updateProducer>[0] = {};
    if (displayName !== profile.displayName) out.displayName = displayName;
    if (slug !== profile.slug) out.slug = slug;
    if (defaultCurrency !== profile.defaultCurrency) out.defaultCurrency = defaultCurrency;
    if (timezone !== profile.timezone) out.timezone = timezone;
    const brand: NonNullable<typeof out.brand> = {};
    if (primary !== (profile.brand.primary ?? DEFAULT_PRIMARY)) brand.primary = primary;
    if (accent !== (profile.brand.accent ?? DEFAULT_ACCENT)) brand.accent = accent;
    if (logoUrl !== (profile.brand.logoUrl ?? "")) {
      // Empty-string means "clear the logo" — we don't currently
      // support that server-side (the schema treats logoUrl as string).
      // Send only non-empty.
      if (logoUrl.length > 0) brand.logoUrl = logoUrl;
    }
    if (Object.keys(brand).length > 0) out.brand = brand;
    return out;
  }, [displayName, slug, defaultCurrency, timezone, primary, accent, logoUrl, profile]);

  const dirty = Object.keys(patch).length > 0;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!dirty) return;
    startTransition(async () => {
      const res = await updateProducer(patch);
      if (res.ok) {
        toast("Settings saved.", "success");
        // Refresh so the header (which reads displayName + slug) and
        // other server-rendered surfaces update immediately.
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* Profile block */}
      <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6">
        <header className="mb-5">
          <h2 className="font-display text-xl tracking-tight">Studio profile</h2>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            What leads see when they land on your public page.
          </p>
        </header>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
              }}
              onBlur={() => {
                setDisplayNameTouched(true);
              }}
              required
              aria-invalid={
                displayNameState.kind === "invalid" || displayNameState.kind === "required"
              }
            />
            <ValidationHint state={displayNameState} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="slug">Studio URL</Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-xs text-[rgb(var(--fg-muted))]">
                /p/
              </span>
              <Input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlug(sanitizeSlug(e.target.value));
                }}
                onBlur={() => {
                  setSlugTouched(true);
                }}
                required
                className="pl-10 font-mono"
                pattern="[a-z0-9-]+"
                minLength={3}
                maxLength={48}
                aria-invalid={
                  slugState.kind === "invalid" || slugState.kind === "required"
                }
              />
            </div>
            <ValidationHint
              state={slugState}
              hint="Changing this invalidates your old URL. Any outstanding magic links stay valid (they redirect by producer ID, not slug)."
            />
          </div>
          <div>
            <Label htmlFor="defaultCurrency">Currency</Label>
            <Select
              id="defaultCurrency"
              value={defaultCurrency}
              onChange={(e) => {
                setDefaultCurrency(e.target.value as ProducerProfile["defaultCurrency"]);
              }}
            >
              <option value="USD">USD · $</option>
              <option value="EUR">EUR · €</option>
              <option value="GBP">GBP · £</option>
              <option value="ILS">ILS · ₪</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              type="text"
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
              }}
              required
              className="font-mono"
            />
          </div>
        </div>
      </section>

      {/* Brand block — white-label-lite preview */}
      <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-xl tracking-tight">Brand</h2>
            <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
              These colors tint your public portfolio. Producers' brand always wins inside their
              own workspace surface.
            </p>
          </div>
          <BrandPreview primary={primary} accent={accent} logoUrl={logoUrl} />
        </header>
        <div className="grid gap-5 sm:grid-cols-2">
          <ColorField
            id="primary"
            label="Primary"
            value={primary}
            onChange={setPrimary}
            hint="Main accent on your public portfolio."
          />
          <ColorField
            id="accent"
            label="Accent"
            value={accent}
            onChange={setAccent}
            hint="Secondary highlight — used sparingly."
          />
          <div className="sm:col-span-2">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              type="url"
              value={logoUrl}
              onChange={(e) => {
                setLogoUrl(e.target.value);
              }}
              placeholder="https://…"
            />
            <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
              Shown as the avatar on your public portfolio. Square PNG/JPG up to 1024px ideal.
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.82)] px-5 py-3 backdrop-blur">
        <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
          {dirty
            ? `${String(Object.keys(patch).length)} unsaved change${
                Object.keys(patch).length === 1 ? "" : "s"
              }`
            : "No changes"}
        </p>
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-1.5">
        {/* Native color picker — pushed to 44x44 for touch. */}
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className="h-10 w-10 shrink-0 cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className="w-full bg-transparent px-1 font-mono text-sm text-[rgb(var(--fg-primary))] focus:outline-none"
          pattern="#[0-9a-fA-F]{6}"
          maxLength={7}
          aria-label={`${label} hex value`}
        />
      </div>
      <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">{hint}</p>
    </div>
  );
}

// Live preview card showing the brand colors in context — a miniature
// version of the public portfolio hero. Producers can see their choices
// before committing.
function BrandPreview({
  primary,
  accent,
  logoUrl,
}: {
  primary: string;
  accent: string;
  logoUrl: string;
}) {
  return (
    <div
      className="relative h-20 w-48 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]"
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 20% 20%, ${primary}22 0%, transparent 55%), radial-gradient(ellipse at 90% 90%, ${accent}22 0%, transparent 55%)`,
        }}
      />
      <div className="relative flex h-full items-center gap-2 p-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] overflow-hidden"
          style={{
            background: logoUrl ? "transparent" : `linear-gradient(135deg, ${primary}, ${accent})`,
          }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div
          className="h-px flex-1"
          style={{ background: primary }}
        />
      </div>
    </div>
  );
}
