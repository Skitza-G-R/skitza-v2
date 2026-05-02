/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — New Product modal. Pairs with the storefront's
// "Add new product" tile. Captures the minimum-viable session product:
// title, session length (duration), and price. Defaults for kind /
// pricingModel / currency / deposit etc. are filled in by the
// createProduct Server Action so the modal stays a 3-field form.
//
// The session-length picker has explicit presets (30m, 60m, 90m, 2h,
// 3h, 4h) plus a "Custom (min)" number input. This is the surface
// the Calendar Availability "default session length" was intentionally
// removed from (#5) — duration belongs on each product, not on the
// producer.

import { type CSSProperties, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "./primitives";
import { createProduct } from "./product-actions";
import { validateNewProductInput } from "./create-validators";

const inputCss: CSSProperties = {
  all: "unset",
  width: "100%",
  fontSize: 13,
  fontFamily: "inherit",
  color: "rgb(var(--fg-default))",
  padding: "10px 12px",
  border: "1px solid rgb(var(--border-subtle))",
  borderRadius: 8,
  background: "rgb(var(--bg-elevated))",
  boxSizing: "border-box",
};

const DURATION_PRESETS: { label: string; min: number }[] = [
  { label: "30m", min: 30 },
  { label: "60m", min: 60 },
  { label: "90m", min: 90 },
  { label: "2h", min: 120 },
  { label: "3h", min: 180 },
  { label: "4h", min: 240 },
];

export function NewProductModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [durationMin, setDurationMin] = useState(120);
  const [priceDollars, setPriceDollars] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDurationMin(120);
    setPriceDollars("");
    setError(null);
    const t = window.setTimeout(() => titleRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, pending, onClose]);

  if (!open) return null;

  const submit = () => {
    const priceNum = Number(priceDollars);
    const priceCents = Number.isFinite(priceNum) ? Math.round(priceNum * 100) : 0;
    const input = { title, durationMin, priceCents };
    const localError = validateNewProductInput(input);
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    startTransition(() => {
      void (async () => {
        const result = await createProduct(input);
        if (result.ok) {
          router.refresh();
          onClose();
        } else {
          setError(result.error);
        }
      })();
    });
  };

  const isPreset = DURATION_PRESETS.some((p) => p.min === durationMin);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-product-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="sk-pop-center"
        style={{
          width: "100%",
          maxWidth: 480,
          background: "rgb(var(--bg-background))",
          border: "1px solid rgb(var(--border-subtle))",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span className="label-tiny" style={{ display: "block", marginBottom: 4 }}>
              Storefront
            </span>
            <h2
              id="new-product-title"
              className="font-syne"
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.05,
              }}
            >
              New product
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending ? "not-allowed" : "pointer",
              padding: 6,
              borderRadius: 8,
              color: "rgb(var(--fg-muted))",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="label-tiny">Product title</span>
            <input
              ref={titleRef}
              style={inputCss}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Mixing session"
              maxLength={120}
            />
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label-tiny">Session length</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.min}
                  type="button"
                  onClick={() => setDurationMin(p.min)}
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    padding: "7px 11px",
                    borderRadius: 7,
                    fontSize: 11.5,
                    fontWeight: 700,
                    fontFamily: "JetBrains Mono",
                    background:
                      durationMin === p.min
                        ? "rgb(var(--fg-default))"
                        : "rgb(var(--bg-elevated))",
                    color:
                      durationMin === p.min
                        ? "rgb(var(--bg-background))"
                        : "rgb(var(--fg-default))",
                    border: "1px solid rgb(var(--border-subtle))",
                  }}
                >
                  {p.label}
                </button>
              ))}
              <input
                type="number"
                min={5}
                max={24 * 60}
                step={5}
                value={isPreset ? "" : durationMin}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) setDurationMin(Math.floor(n));
                }}
                placeholder="Custom"
                style={{
                  ...inputCss,
                  width: 90,
                  padding: "7px 9px",
                  fontSize: 11.5,
                  fontFamily: "JetBrains Mono",
                }}
                aria-label="Custom session length in minutes"
              />
            </div>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="label-tiny">Price (USD)</span>
            <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
              <span
                style={{
                  fontSize: 13,
                  fontFamily: "JetBrains Mono",
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "10px 12px",
                  background: "rgb(var(--bg-sidebar))",
                  color: "rgb(var(--bg-background))",
                  border: "1px solid rgb(var(--border-subtle))",
                  borderRight: "none",
                  borderTopLeftRadius: 8,
                  borderBottomLeftRadius: 8,
                }}
              >
                $
              </span>
              <input
                style={{
                  ...inputCss,
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  fontFamily: "JetBrains Mono",
                }}
                type="number"
                min={0}
                step="0.01"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                placeholder="250"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !pending) submit();
                }}
              />
            </div>
          </label>
        </div>

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: "rgb(var(--fg-danger))" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending ? "not-allowed" : "pointer",
              padding: "9px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              background: "transparent",
              color: "rgb(var(--fg-muted))",
              border: "1px solid rgb(var(--border-subtle))",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending ? "not-allowed" : "pointer",
              padding: "9px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              background: "rgb(var(--brand-primary))",
              color: "#111009",
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending ? "Creating…" : "Create product"}
          </button>
        </div>
      </div>
    </div>
  );
}
