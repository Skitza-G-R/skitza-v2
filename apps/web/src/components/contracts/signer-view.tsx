"use client";

// Signer UI — the artist-side of the contract flow. Orchestrates the
// three public contract procedures via server actions (sign-actions.ts).
//
// Layout: sticky top bar (title + progress), PDF pages with absolutely-
// positioned input overlays in the middle, sticky bottom bar with the
// sign CTA. On successful sign the SignedSeal overlay plays.
//
// This component deliberately does NOT reuse PdfCanvas — the editor
// component has drag/resize wired to pointer events which would fight
// native input controls on mobile. A simpler SignerPdfView is inlined
// below: it only renders pages + field overlays.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Document, Page } from "react-pdf";

import "~/components/contracts/pdf-worker";
import { SignatureModal } from "~/components/contracts/signature-modal";
import { SignedSeal } from "~/components/contracts/signed-seal";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import type { FieldType } from "~/lib/contracts/editor-helpers";
import {
  fillField,
  signContract,
} from "~/app/(public)/sign/[token]/sign-actions";

// Sentinel for cached "true" booleans from the server. The server
// stores checkbox state as the literal string "true" / "false" in
// signedValue; nothing fancier is needed.
const CHECKED = "true";

// Narrow an `unknown` into a plain object (or null) for options-bag
// access. jsonb columns come back typed `unknown` from drizzle — we
// runtime-guard at each use site rather than trusting the shape.
function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

// Field shape as returned by contract.publicByToken. `options` comes
// back as `unknown` (jsonb column, drizzle doesn't type the shape)
// and is narrowed per-field-type at the call site below.
interface SignerField {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type: FieldType;
  required: boolean;
  recipientId: string | null;
  prefilledValue: string | null;
  signedValue: string | null;
  options: unknown;
}

interface SignerViewProps {
  token: string;
  initial: {
    contract: {
      id: string;
      title: string;
      status: string;
      pdfUrl: string;
    };
    recipient: {
      id: string;
      name: string;
      email: string;
      signedAt: Date | null;
    };
    fields: SignerField[];
  };
}

// Local state is a map fieldId → current value (data URL for
// signatures, string for everything else). We seed it from the server
// so a returning signer who already filled some fields sees their
// values persist.
type ValueMap = Record<string, string>;

function seedValues(fields: SignerField[]): ValueMap {
  const out: ValueMap = {};
  for (const f of fields) {
    const v = f.signedValue ?? f.prefilledValue;
    if (v !== null) out[f.id] = v;
  }
  return out;
}

// Drop a minimum of 44px tap target onto any field wrapper so the
// rendered box at the current page width doesn't fall below the iOS
// HIG recommendation. The wrapper uses flex so smaller-than-44px
// rects still center the actual input visually.
const MIN_TAP_PX = 44;

export function SignerView({ token, initial }: SignerViewProps) {
  const { toast } = useToast();
  const [values, setValues] = useState<ValueMap>(() => seedValues(initial.fields));
  const [submitting, setSubmitting] = useState(false);
  const [signed, setSigned] = useState(initial.recipient.signedAt !== null);
  const [showSeal, setShowSeal] = useState(false);
  const [allSigned, setAllSigned] = useState(false);
  const [sigModalFor, setSigModalFor] = useState<{
    fieldId: string;
    kind: "signature" | "initial";
  } | null>(null);

  // Partition fields into "mine" (interactive) vs "others" (read-only
  // overlay showing their signedValue if present). Sender-prefilled
  // fields (recipientId === null) are not interactive; they render as
  // static text so the signer can see any pre-typed context.
  const myFields = useMemo(
    () => initial.fields.filter((f) => f.recipientId === initial.recipient.id),
    [initial.fields, initial.recipient.id],
  );

  const requiredCount = myFields.filter((f) => f.required).length;
  const filledRequiredCount = myFields.filter(
    (f) => f.required && Boolean(values[f.id] && values[f.id] !== "false"),
  ).length;
  const allRequiredFilled = filledRequiredCount === requiredCount;

  // Fire-and-forget persistence — the UI stays responsive; on failure
  // we toast so the user can retry. Local value stays as-is so their
  // input isn't lost; a subsequent successful write overwrites.
  const persist = useCallback(
    async (fieldId: string, value: string) => {
      const res = await fillField({ token, fieldId, value });
      if (!res.ok) {
        toast(res.error, "error");
      }
    },
    [token, toast],
  );

  const setAndPersist = useCallback(
    (fieldId: string, value: string) => {
      setValues((prev) => ({ ...prev, [fieldId]: value }));
      void persist(fieldId, value);
    },
    [persist],
  );

  const onSign = useCallback(async () => {
    if (submitting || signed) return;
    setSubmitting(true);
    const res = await signContract({ token });
    setSubmitting(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    setAllSigned(res.data.allSigned);
    setSigned(true);
    setShowSeal(true);
    // Hide the seal after 2.5s but keep the "signed" view.
    window.setTimeout(() => {
      setShowSeal(false);
    }, 2500);
  }, [submitting, signed, token, toast]);

  // If the recipient has already signed (returning visitor), render a
  // stripped-down read-only view. The PDF still renders so they can
  // verify what they agreed to.
  const readOnly = signed;

  return (
    <>
      <StickyTopBar
        title={initial.contract.title}
        recipientName={initial.recipient.name}
        filled={filledRequiredCount}
        total={requiredCount}
        signed={readOnly}
      />

      <div className="mx-auto w-full max-w-[900px] px-3 pb-40 pt-6 sm:px-6">
        <SignerPdfView
          pdfUrl={initial.contract.pdfUrl}
          fields={initial.fields}
          values={values}
          myRecipientId={initial.recipient.id}
          readOnly={readOnly}
          onTextChange={setAndPersist}
          onRequestSignature={(field) => {
            setSigModalFor({
              fieldId: field.id,
              kind: field.type === "initial" ? "initial" : "signature",
            });
          }}
        />
      </div>

      {!readOnly ? (
        <StickyBottomBar
          disabled={!allRequiredFilled || submitting}
          label={submitting ? "Signing…" : "Sign contract"}
          onSign={() => {
            void onSign();
          }}
          remaining={requiredCount - filledRequiredCount}
        />
      ) : (
        <SignedFooter allSigned={allSigned} />
      )}

      {sigModalFor ? (
        <SignatureModal
          kind={sigModalFor.kind}
          onClose={() => {
            setSigModalFor(null);
          }}
          onSave={(dataUrl) => {
            setAndPersist(sigModalFor.fieldId, dataUrl);
            setSigModalFor(null);
          }}
        />
      ) : null}

      {showSeal ? <SignedSeal /> : null}
    </>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────
function StickyTopBar(props: {
  title: string;
  recipientName: string;
  filled: number;
  total: number;
  signed: boolean;
}) {
  const pct = props.total === 0 ? 100 : (props.filled / props.total) * 100;
  return (
    <header className="sticky top-0 z-30 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.92)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-2 px-3 py-3 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1
            className="font-display text-lg tracking-tight sm:text-xl"
            style={{ fontWeight: 700 }}
          >
            {props.title}
          </h1>
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Signing as {props.recipientName}
          </p>
        </div>
        {props.signed ? (
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-success))]">
            Signed
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgb(var(--bg-sunken))]"
            >
              <div
                className="h-full bg-[rgb(var(--brand-primary))] transition-[width] duration-200"
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              {props.filled} of {props.total} required filled
            </p>
          </div>
        )}
      </div>
    </header>
  );
}

// ─── Bottom bar ───────────────────────────────────────────────────────
function StickyBottomBar(props: {
  disabled: boolean;
  label: string;
  onSign: () => void;
  remaining: number;
}) {
  return (
    <div
      // env(safe-area-inset-bottom) keeps the bar clear of the iOS home
      // indicator. Tailwind doesn't have a utility for this, so inline.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.94)] backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex w-full max-w-[900px] items-center justify-between gap-4 px-3 py-3 sm:px-6">
        <p className="font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {props.remaining > 0
            ? `${String(props.remaining)} field${props.remaining === 1 ? "" : "s"} left`
            : "Ready to sign"}
        </p>
        <button
          type="button"
          disabled={props.disabled}
          onClick={props.onSign}
          className={cn(
            "inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] px-5 py-2 font-medium transition-colors",
            "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]",
            "hover:bg-[rgb(var(--brand-primary)/0.9)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {props.label}
        </button>
      </div>
    </div>
  );
}

function SignedFooter(props: { allSigned: boolean }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.94)] backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-start gap-1 px-3 py-3 sm:px-6">
        <p className="text-sm text-[rgb(var(--fg-primary))]">
          {props.allSigned
            ? "Signed successfully. Your producer has been notified."
            : "Signed successfully. Waiting on other signers to finalise the contract."}
        </p>
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Download a copy (PDF available soon)
        </p>
      </div>
    </div>
  );
}

// ─── PDF + field overlay ──────────────────────────────────────────────
interface SignerPdfViewProps {
  pdfUrl: string;
  fields: SignerField[];
  values: ValueMap;
  myRecipientId: string;
  readOnly: boolean;
  onTextChange: (fieldId: string, value: string) => void;
  onRequestSignature: (field: SignerField) => void;
}

function SignerPdfView(props: SignerPdfViewProps) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageWidth, setPageWidth] = useState<number>(820);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Fit the rendered page to the available width on mobile, up to a
  // readable-on-desktop cap. Listen to the wrap element width rather
  // than window width so a sidebar or zoom doesn't desync us.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      // Floor to 320 so we never render something absurdly small if
      // the container collapses mid-layout.
      setPageWidth(Math.max(320, Math.min(860, w)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const file = useMemo(() => ({ url: props.pdfUrl }), [props.pdfUrl]);

  return (
    <div ref={wrapRef} className="flex flex-col items-center gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.07)] px-4 py-3 text-sm text-[rgb(var(--fg-danger))]"
        >
          {error}
        </p>
      ) : null}
      <Document
        file={file}
        onLoadSuccess={(info) => {
          setPageCount(info.numPages);
          setError(null);
        }}
        onLoadError={(e) => {
          setError(e.message || "Failed to load PDF");
        }}
        loading={
          <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
            Loading PDF…
          </p>
        }
        error={null}
      >
        {pageCount !== null
          ? Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <PagePane
                key={n}
                pageNumber={n}
                pageWidth={pageWidth}
                fields={props.fields.filter((f) => f.page === n)}
                values={props.values}
                myRecipientId={props.myRecipientId}
                readOnly={props.readOnly}
                onTextChange={props.onTextChange}
                onRequestSignature={props.onRequestSignature}
              />
            ))
          : null}
      </Document>
    </div>
  );
}

interface PagePaneProps {
  pageNumber: number;
  pageWidth: number;
  fields: SignerField[];
  values: ValueMap;
  myRecipientId: string;
  readOnly: boolean;
  onTextChange: (fieldId: string, value: string) => void;
  onRequestSignature: (field: SignerField) => void;
}

function PagePane(props: PagePaneProps) {
  const paneRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={paneRef}
      className="relative shadow-[0_2px_20px_-4px_rgb(0_0_0_/_0.4)] ring-1 ring-[rgb(var(--border-subtle))]"
    >
      <Page
        pageNumber={props.pageNumber}
        width={props.pageWidth}
        renderAnnotationLayer={false}
        renderTextLayer={false}
      />
      <div className="absolute inset-0">
        {props.fields.map((f) => (
          <FieldInput
            key={f.id}
            field={f}
            value={props.values[f.id]}
            interactive={!props.readOnly && f.recipientId === props.myRecipientId}
            onTextChange={props.onTextChange}
            onRequestSignature={props.onRequestSignature}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Single field renderer ────────────────────────────────────────────
interface FieldInputProps {
  field: SignerField;
  value: string | undefined;
  interactive: boolean;
  onTextChange: (fieldId: string, value: string) => void;
  onRequestSignature: (field: SignerField) => void;
}

function FieldInput({
  field,
  value,
  interactive,
  onTextChange,
  onRequestSignature,
}: FieldInputProps) {
  // Wrapper is absolutely positioned by percent — the actual input
  // fills it with a min-size floor so tiny rects still have a 44×44
  // tap area (centered, via negative margins on the box itself).
  const baseStyle: CSSProperties = {
    position: "absolute",
    left: `${String(field.x)}%`,
    top: `${String(field.y)}%`,
    width: `${String(field.w)}%`,
    height: `${String(field.h)}%`,
  };

  // When a rect is small, push the inner hit-target out to 44px.
  // We do this with a pseudo-wrapper (div > inner) so the outer keeps
  // its exact geometry for visual alignment, but the clickable inner
  // overflows to reach 44px. `pointer-events-auto` on the inner plus
  // `pointer-events-none` on the outer container (set by the parent)
  // would be cleaner, but here nothing else intercepts events so a
  // plain min-h/min-w on the inner works.
  const innerStyle: CSSProperties = {
    minHeight: interactive ? MIN_TAP_PX : undefined,
    minWidth: interactive ? MIN_TAP_PX : undefined,
  };

  // Read-only display — either our own already-filled value, a
  // sender-prefilled value, or another signer's signedValue.
  if (!interactive) {
    const display = value ?? "";
    const isImage = display.startsWith("data:image/");
    return (
      <div style={baseStyle} aria-hidden>
        <div
          style={innerStyle}
          className={cn(
            "flex h-full w-full items-center justify-center rounded-sm",
            display ? "bg-transparent" : "bg-[rgb(var(--bg-sunken)/0.4)]",
            display ? "" : "border border-dashed border-[rgb(var(--border-subtle))]",
          )}
        >
          {isImage ? (
            // Rendering via <img> rather than <Image> — data URLs don't
            // play well with next/image and it's bounded by parent size.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={display}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : display === CHECKED ? (
            <span aria-hidden className="text-lg leading-none">✓</span>
          ) : display === "false" ? null : (
            <span className="truncate px-1 text-xs text-[rgb(var(--fg-primary))]">
              {display}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Interactive field — branch by type.
  switch (field.type) {
    case "signature":
    case "initial": {
      const placeholder = field.type === "initial" ? "Tap to initial" : "Tap to sign";
      const hasValue = Boolean(value && value.startsWith("data:image/"));
      return (
        <div style={baseStyle}>
          <button
            type="button"
            aria-label={placeholder}
            onClick={() => {
              onRequestSignature(field);
            }}
            style={{ ...innerStyle, touchAction: "manipulation" }}
            className={cn(
              "flex h-full w-full items-center justify-center rounded-sm border-2 border-dashed p-1 transition-colors",
              hasValue
                ? "border-[rgb(var(--fg-success))] bg-transparent"
                : "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] hover:bg-[rgb(var(--brand-primary)/0.14)]",
            )}
          >
            {hasValue && value ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="truncate font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                {placeholder}
              </span>
            )}
          </button>
        </div>
      );
    }

    case "text": {
      return (
        <div style={baseStyle}>
          <input
            type="text"
            defaultValue={value ?? ""}
            onBlur={(e) => {
              onTextChange(field.id, e.currentTarget.value);
            }}
            onFocus={(e) => {
              e.currentTarget.scrollIntoView({
                block: "center",
                behavior: "smooth",
              });
            }}
            style={innerStyle}
            className={cn(
              "h-full w-full rounded-sm border border-[rgb(var(--brand-primary)/0.6)] bg-[rgb(var(--bg-elevated))] px-2",
              "text-base text-[rgb(var(--fg-primary))]",
              "focus:border-[rgb(var(--brand-primary))] focus:outline-none",
            )}
            aria-required={field.required}
          />
        </div>
      );
    }

    case "date": {
      const opts = asRecord(field.options);
      const defaultToday = opts?.defaultToday === true;
      const initial =
        value ?? (defaultToday ? new Date().toISOString().slice(0, 10) : "");
      return (
        <div style={baseStyle}>
          <input
            type="date"
            defaultValue={initial}
            onChange={(e) => {
              onTextChange(field.id, e.currentTarget.value);
            }}
            onFocus={(e) => {
              e.currentTarget.scrollIntoView({
                block: "center",
                behavior: "smooth",
              });
            }}
            style={innerStyle}
            className={cn(
              "h-full w-full rounded-sm border border-[rgb(var(--brand-primary)/0.6)] bg-[rgb(var(--bg-elevated))] px-2",
              "text-base text-[rgb(var(--fg-primary))]",
              "focus:border-[rgb(var(--brand-primary))] focus:outline-none",
            )}
            aria-required={field.required}
          />
        </div>
      );
    }

    case "number": {
      const opts = asRecord(field.options);
      const min = typeof opts?.min === "number" ? opts.min : undefined;
      const max = typeof opts?.max === "number" ? opts.max : undefined;
      return (
        <div style={baseStyle}>
          <input
            type="number"
            defaultValue={value ?? ""}
            min={min}
            max={max}
            onBlur={(e) => {
              onTextChange(field.id, e.currentTarget.value);
            }}
            onFocus={(e) => {
              e.currentTarget.scrollIntoView({
                block: "center",
                behavior: "smooth",
              });
            }}
            style={innerStyle}
            className={cn(
              "h-full w-full rounded-sm border border-[rgb(var(--brand-primary)/0.6)] bg-[rgb(var(--bg-elevated))] px-2",
              "text-base text-[rgb(var(--fg-primary))]",
              "focus:border-[rgb(var(--brand-primary))] focus:outline-none",
            )}
            aria-required={field.required}
          />
        </div>
      );
    }

    case "checkbox": {
      const checked = value === CHECKED;
      return (
        <div style={baseStyle}>
          <label
            style={innerStyle}
            className="flex h-full w-full cursor-pointer items-center justify-center rounded-sm border-2 border-dashed border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] hover:bg-[rgb(var(--brand-primary)/0.14)]"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                onTextChange(field.id, e.currentTarget.checked ? CHECKED : "false");
              }}
              className="h-5 w-5 accent-[rgb(var(--brand-primary))]"
              aria-required={field.required}
            />
          </label>
        </div>
      );
    }

    case "dropdown": {
      const opts = asRecord(field.options);
      const rawChoices = opts?.choices;
      const choices = Array.isArray(rawChoices)
        ? rawChoices.filter((c): c is string => typeof c === "string")
        : [];
      return (
        <div style={baseStyle}>
          <select
            defaultValue={value ?? ""}
            onChange={(e) => {
              onTextChange(field.id, e.currentTarget.value);
            }}
            style={innerStyle}
            className={cn(
              "h-full w-full rounded-sm border border-[rgb(var(--brand-primary)/0.6)] bg-[rgb(var(--bg-elevated))] px-2",
              "text-base text-[rgb(var(--fg-primary))]",
              "focus:border-[rgb(var(--brand-primary))] focus:outline-none",
            )}
            aria-required={field.required}
          >
            <option value="" disabled>
              Select…
            </option>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      );
    }

    default: {
      // Exhaustive guard — if a new FieldType is added we'll get a
      // compile error here before runtime renders a blank box.
      const _never: never = field.type;
      return _never;
    }
  }
}
