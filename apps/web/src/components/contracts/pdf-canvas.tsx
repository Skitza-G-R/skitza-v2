"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { PdfCanvasProps } from "./pdf-canvas-inner";

// Thin wrapper around PdfCanvasInner that dynamically imports react-pdf
// + pdfjs-dist (~600 kB gzipped) only when the canvas is actually
// rendered. The contract editor and signer page account for the lion's
// share of our heavy client JS; this defer keeps it off every other
// route's First Load.
//
// `ssr: false` is required: react-pdf uses DOMMatrix and Canvas APIs
// during module init, and we never want to render the PDF on the
// server anyway.
const PdfCanvasInner = dynamic(
  () => import("./pdf-canvas-inner").then((m) => ({ default: m.PdfCanvasInner })),
  {
    ssr: false,
    loading: () => (
      <p className="font-mono text-xs text-[rgb(var(--fg-muted))] py-6 text-center">
        Loading PDF…
      </p>
    ),
  },
);

export function PdfCanvas(props: PdfCanvasProps) {
  return <PdfCanvasInner {...props} />;
}

// Escape hatch so the editor can force-remount the Document on pdfUrl
// swap (e.g. when a signed URL expires mid-session). Lives here so
// consumers don't pull the react-pdf chunk in just to import it.
export function useRemountKey(url: string): string {
  const [key, setKey] = useState(() => url);
  useEffect(() => {
    setKey(url);
  }, [url]);
  return key;
}
