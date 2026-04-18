"use client";

// Signer UI — the artist-side of the contract flow. Orchestrates the
// three public contract procedures via server actions (sign-actions.ts).
//
// Layout: sticky top bar (title + progress), PDF pages with absolutely-
// positioned input overlays in the middle, sticky bottom bar with the
// sign CTA. On successful sign the SignedSeal overlay plays.
//
// The PDF + overlay half now lives in `signer-pdf-view-inner.tsx` and
// is lazily loaded via `next/dynamic`. react-pdf + pdfjs-dist weighs
// ~600 kB gzipped, so deferring its arrival past the first paint on
// /sign/[token] is a big win on cold loads — the top/bottom bars
// render instantly with nothing but the lightweight shell.

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import { SignatureModal } from "~/components/contracts/signature-modal";
import { SignedSeal } from "~/components/contracts/signed-seal";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import {
  fillField,
  signContract,
} from "~/app/(public)/sign/[token]/sign-actions";

import type { SignerField, SignerPdfViewProps } from "./signer-pdf-view-inner";

const SignerPdfView = dynamic<SignerPdfViewProps>(
  () =>
    import("./signer-pdf-view-inner").then((m) => ({
      default: m.SignerPdfView,
    })),
  {
    ssr: false,
    loading: () => (
      <p className="font-mono text-xs text-[rgb(var(--fg-muted))] py-6 text-center">
        Loading PDF…
      </p>
    ),
  },
);

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
