"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Client-side QR renderer. Code-splits via dynamic import (the `qrcode`
// dep is ~30KB gzip — we lazy-load it only when a component mounts,
// so the pages that never issue a magic link don't pay the bytes).
//
// Renders as a data-URL <img> rather than dangerouslySetInnerHTML —
// safer (no SVG DOM injection surface), and the browser paints the
// pixel art crisply at integer sizes without aliasing.
export function QrCode({
  value,
  size = 128,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // PNG data URL keeps the payload compact and lets us use <img>
    // instead of SVG-in-innerHTML. Render at 2× the displayed size
    // so retina screens stay crisp.
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size * 2,
      // Warm off-white modules on transparent background — the wrapper
      // sets its own backdrop so the QR plays well on light or dark
      // surfaces.
      color: {
        // Dark modules on transparent so the QR reads on both LIGHT
        // dashboards (where the banner sits) and DARK surfaces alike.
        dark: "#1A1714",
        light: "#00000000",
      },
    })
      .then((result) => {
        if (!cancelled) setDataUrl(result);
      })
      .catch(() => {
        // Encoding failures (e.g. URL too long) are silent — the text
        // URL is already shown above the QR for manual copy.
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  // Reserve layout space while loading so the banner doesn't reflow.
  if (!dataUrl) {
    return (
      <div
        aria-hidden
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt="QR code for the magic link"
      width={size}
      height={size}
      className={className}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
