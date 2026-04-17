"use client";

// Heavy-chunk half of the signer view: the actual `react-pdf` render +
// the per-field overlay it anchors. Split out from `signer-view.tsx`
// so the wrapper's dynamic-import with `{ ssr: false }` keeps
// pdfjs-dist (~600 kB gzipped) off the initial /sign/[token] client
// bundle. Nothing here is conceptually new — it's a verbatim lift of
// the original SignerPdfView / PagePane / FieldInput trio.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Document, Page } from "react-pdf";

import "~/components/contracts/pdf-worker";
import { cn } from "~/lib/cn";
import type { FieldType } from "~/lib/contracts/editor-helpers";

// Sentinel mirrors the wrapper — kept local to avoid cross-file
// constant-gymnastics just to dedupe a four-character string.
const CHECKED = "true";
const MIN_TAP_PX = 44;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export interface SignerField {
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

type ValueMap = Record<string, string>;

export interface SignerPdfViewProps {
  pdfUrl: string;
  fields: SignerField[];
  values: ValueMap;
  myRecipientId: string;
  readOnly: boolean;
  onTextChange: (fieldId: string, value: string) => void;
  onRequestSignature: (field: SignerField) => void;
}

export function SignerPdfView(props: SignerPdfViewProps) {
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
  const baseStyle: CSSProperties = {
    position: "absolute",
    left: `${String(field.x)}%`,
    top: `${String(field.y)}%`,
    width: `${String(field.w)}%`,
    height: `${String(field.h)}%`,
  };

  const innerStyle: CSSProperties = {
    minHeight: interactive ? MIN_TAP_PX : undefined,
    minWidth: interactive ? MIN_TAP_PX : undefined,
  };

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
