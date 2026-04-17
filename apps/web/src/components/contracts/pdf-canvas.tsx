"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Document, Page } from "react-pdf";

import { cn } from "~/lib/cn";
import {
  FIELD_LABELS,
  clampRect,
  colorFor,
  type FieldLike,
} from "~/lib/contracts/editor-helpers";

// One-shot worker-src assignment. Must run before the first <Document>
// render; importing it here ensures exactly one registration regardless
// of how many <PdfCanvas> mount.
import "~/components/contracts/pdf-worker";

// Fixed render width on desktop. react-pdf derives page height from the
// PDF's own aspect ratio once its geometry is known, so a single width
// value is enough to drive layout. A smaller width on mobile keeps the
// whole page visible without horizontal scrolling.
const DESKTOP_PAGE_WIDTH = 820;

// pdf.js's Document onLoadSuccess gives us total page count.
interface PdfCanvasProps {
  pdfUrl: string;
  fields: FieldLike[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onUpdate: (index: number, updater: (f: FieldLike) => FieldLike) => void;
  onDelete: (index: number) => void;
  recipientMap: Map<string, string>; // id → display name
  readOnly?: boolean;
  // Click-to-place support: the Editor tells us which type (if any) is
  // armed for placement; when the producer clicks a page, we emit a
  // create event with the percent coords and the page number.
  pendingPlaceType: FieldLike["type"] | null;
  onPlace: (args: {
    page: number;
    centerX: number;
    centerY: number;
  }) => void;
}

export function PdfCanvas({
  pdfUrl,
  fields,
  selectedIndex,
  onSelect,
  onUpdate,
  onDelete,
  recipientMap,
  readOnly,
  pendingPlaceType,
  onPlace,
}: PdfCanvasProps) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // File config passed to <Document>. Memoised so we don't re-open the
  // PDF on every parent re-render (each re-open tears down the rendered
  // pages and flashes white).
  const file = useMemo(() => ({ url: pdfUrl }), [pdfUrl]);

  const onDocumentLoad = useCallback((info: { numPages: number }) => {
    setPageCount(info.numPages);
    setPageError(null);
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      {pageError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.07)] px-4 py-3 text-sm text-[rgb(var(--fg-danger))]"
        >
          {pageError}
        </p>
      ) : null}
      <Document
        file={file}
        onLoadSuccess={onDocumentLoad}
        onLoadError={(err) => {
          setPageError(err.message || "Failed to load PDF");
        }}
        loading={
          <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
            Loading PDF…
          </p>
        }
        error={null}
      >
        {pageCount !== null
          ? Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
              <PdfPageWithFields
                key={pageNumber}
                pageNumber={pageNumber}
                fields={fields}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onUpdate={onUpdate}
                onDelete={onDelete}
                recipientMap={recipientMap}
                readOnly={readOnly ?? false}
                pendingPlaceType={pendingPlaceType}
                onPlace={onPlace}
              />
            ))
          : null}
      </Document>
    </div>
  );
}

interface PdfPageProps {
  pageNumber: number;
  fields: FieldLike[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onUpdate: (index: number, updater: (f: FieldLike) => FieldLike) => void;
  onDelete: (index: number) => void;
  recipientMap: Map<string, string>;
  readOnly: boolean;
  pendingPlaceType: FieldLike["type"] | null;
  onPlace: (args: { page: number; centerX: number; centerY: number }) => void;
}

function PdfPageWithFields({
  pageNumber,
  fields,
  selectedIndex,
  onSelect,
  onUpdate,
  onDelete,
  recipientMap,
  readOnly,
  pendingPlaceType,
  onPlace,
}: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);

  const handlePageClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (readOnly) return;
      // Only respond to clicks on the page surface itself, not on
      // field tiles or their handles.
      if (e.target !== e.currentTarget) return;
      if (!pendingPlaceType) {
        onSelect(null);
        return;
      }
      const rect = pageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const centerX = ((e.clientX - rect.left) / rect.width) * 100;
      const centerY = ((e.clientY - rect.top) / rect.height) * 100;
      onPlace({ page: pageNumber, centerX, centerY });
    },
    [readOnly, pendingPlaceType, pageNumber, onPlace, onSelect],
  );

  // Indices (in parent array) of fields on this page. We pass indices
  // rather than field ids so saveFields can continue to diff by the
  // in-memory list; ids may not exist yet for freshly-created fields.
  const pageFieldIndices = fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.page === pageNumber);

  return (
    <div
      className={cn(
        "relative shadow-[0_2px_20px_-4px_rgb(0_0_0_/_0.4)] ring-1 ring-[rgb(var(--border-subtle))]",
        pendingPlaceType ? "cursor-crosshair" : "cursor-default",
      )}
      data-page-id={pageNumber}
    >
      <Page
        pageNumber={pageNumber}
        width={DESKTOP_PAGE_WIDTH}
        renderAnnotationLayer={false}
        renderTextLayer={false}
      />
      {/* Overlay: absolute, sits exactly on top of the rasterised page.
          Click events on empty space either deselect (no armed type)
          or place a new field (armed). */}
      <div
        ref={pageRef}
        className="absolute inset-0"
        onPointerDown={handlePageClick}
      >
        {pageFieldIndices.map(({ f, i }) => (
          <FieldTile
            key={f.id ?? `new-${String(i)}`}
            field={f}
            index={i}
            selected={selectedIndex === i}
            onSelect={onSelect}
            onUpdate={onUpdate}
            onDelete={onDelete}
            pageRef={pageRef}
            recipientLabel={
              f.recipientId ? (recipientMap.get(f.recipientId) ?? "Signer") : "Sender"
            }
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

interface FieldTileProps {
  field: FieldLike;
  index: number;
  selected: boolean;
  onSelect: (index: number | null) => void;
  onUpdate: (index: number, updater: (f: FieldLike) => FieldLike) => void;
  onDelete: (index: number) => void;
  pageRef: React.RefObject<HTMLDivElement | null>;
  recipientLabel: string;
  readOnly: boolean;
}

function FieldTile({
  field,
  index,
  selected,
  onSelect,
  onUpdate,
  onDelete,
  pageRef,
  recipientLabel,
  readOnly,
}: FieldTileProps) {
  // Two gesture modes, same event stream: drag the whole tile, or
  // resize from the bottom-right handle. We prefer a tiny custom
  // pointer handler over dnd-kit here because dnd-kit doesn't give us
  // percentage-of-container deltas cheaply, and we want two axes of
  // continuous motion (not snap-to-grid).
  const draggingRef = useRef<{
    mode: "move" | "resize";
    startClientX: number;
    startClientY: number;
    startRect: { x: number; y: number; w: number; h: number };
    pageRect: DOMRect;
  } | null>(null);

  const beginGesture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, mode: "move" | "resize") => {
      if (readOnly) return;
      const pageEl = pageRef.current;
      if (!pageEl) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = {
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startRect: { x: field.x, y: field.y, w: field.w, h: field.h },
        pageRect: pageEl.getBoundingClientRect(),
      };
      onSelect(index);
    },
    [readOnly, pageRef, field.x, field.y, field.w, field.h, onSelect, index],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = draggingRef.current;
      if (!s) return;
      const dxPct = ((e.clientX - s.startClientX) / s.pageRect.width) * 100;
      const dyPct = ((e.clientY - s.startClientY) / s.pageRect.height) * 100;
      if (s.mode === "move") {
        const rect = clampRect({
          x: s.startRect.x + dxPct,
          y: s.startRect.y + dyPct,
          w: s.startRect.w,
          h: s.startRect.h,
        });
        onUpdate(index, (f) => ({ ...f, x: rect.x, y: rect.y }));
      } else {
        const rect = clampRect({
          x: s.startRect.x,
          y: s.startRect.y,
          w: Math.max(1, s.startRect.w + dxPct),
          h: Math.max(1, s.startRect.h + dyPct),
        });
        onUpdate(index, (f) => ({ ...f, w: rect.w, h: rect.h }));
      }
    },
    [onUpdate, index],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (draggingRef.current) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        draggingRef.current = null;
      }
    },
    [],
  );

  // Delete key while selected = remove. Only when the tile has focus
  // (producer just tabbed to it) — we don't want a global listener.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (readOnly) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDelete(index);
      }
    },
    [onDelete, index, readOnly],
  );

  const tint = colorFor(field.recipientId);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${FIELD_LABELS[field.type]} field for ${recipientLabel}`}
      aria-pressed={selected}
      onPointerDown={(e) => {
        beginGesture(e, "move");
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onFocus={() => {
        onSelect(index);
      }}
      style={{
        position: "absolute",
        left: `${String(field.x)}%`,
        top: `${String(field.y)}%`,
        width: `${String(field.w)}%`,
        height: `${String(field.h)}%`,
        borderColor: tint,
        backgroundColor: selected
          ? "rgb(var(--brand-primary) / 0.18)"
          : "rgb(0 0 0 / 0.04)",
        boxShadow: selected ? `0 0 0 2px ${tint}` : undefined,
        touchAction: "none",
      }}
      className={cn(
        "border-2 border-dashed rounded-sm flex items-center justify-center",
        "text-[0.62rem] font-mono uppercase tracking-wider",
        "transition-[background-color,box-shadow] duration-100",
        readOnly ? "cursor-default" : "cursor-move",
        "focus-visible:outline-none",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none truncate px-1"
        style={{ color: tint }}
      >
        {FIELD_LABELS[field.type]}
        {field.required ? "*" : ""}
        <span className="ml-1 opacity-70">· {recipientLabel}</span>
      </span>
      {!readOnly && (
        <div
          role="presentation"
          aria-hidden
          onPointerDown={(e) => {
            beginGesture(e, "resize");
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute bottom-0 right-0 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-sm border border-white bg-[rgb(var(--brand-primary))]"
          style={{ touchAction: "none" }}
        />
      )}
    </div>
  );
}

// Escape hatch so the editor can force-remount the Document on pdfUrl
// swap (e.g. when a signed URL expires mid-session). Kept out of the
// main component to keep the hook list there trivial.
export function useRemountKey(url: string): string {
  const [key, setKey] = useState(() => url);
  useEffect(() => {
    setKey(url);
  }, [url]);
  return key;
}
