"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { updateAvailabilitySettings } from "./actions";

// Segmented control matching the StudioFlow "session duration" picker.
// Presets are the most common session lengths producers run; "Custom"
// reveals a numeric input so you can pick any integer-minute value from
// 15 min to 8 h. Changes auto-save on selection — no separate save button
// since the field is a single scalar.

const PRESETS = [
  { min: 60, label: "1h" },
  { min: 90, label: "1:30" },
  { min: 120, label: "2h" },
  { min: 180, label: "3h" },
  { min: 240, label: "4h" },
] as const;

const MIN_CUSTOM = 15;
const MAX_CUSTOM = 8 * 60;

function isPreset(min: number): boolean {
  return PRESETS.some((p) => p.min === min);
}

export function DurationPicker({
  initialDefaultMin,
}: {
  initialDefaultMin: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialDefaultMin);
  // Custom mode tracks whether the user explicitly opened the "Custom"
  // branch — otherwise a non-preset value (e.g. 75 min) would collapse
  // back into the segmented control on every re-render.
  const [customMode, setCustomMode] = useState(!isPreset(initialDefaultMin));
  const [customDraft, setCustomDraft] = useState(String(initialDefaultMin));

  function save(next: number) {
    if (next < MIN_CUSTOM || next > MAX_CUSTOM) {
      toast(
        `Duration must be between ${String(MIN_CUSTOM)} and ${String(MAX_CUSTOM)} minutes.`,
        "error",
      );
      return;
    }
    if (next === value) return;
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res = await updateAvailabilitySettings({ defaultSessionMin: next });
      if (res.ok) {
        toast("Default session length saved.", "success");
        router.refresh();
      } else {
        setValue(prev); // rollback on failure
        toast(res.error, "error");
      }
    });
  }

  function pickPreset(min: number) {
    setCustomMode(false);
    save(min);
  }

  function commitCustom() {
    const parsed = Number.parseInt(customDraft, 10);
    if (!Number.isFinite(parsed)) {
      toast("Enter a number of minutes.", "error");
      return;
    }
    save(parsed);
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
      <div className="mb-3">
        <h3
          className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 700 }}
        >
          Default session length
        </h3>
        <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
          The default duration we book for — used to seed new services and as a
          fallback when one isn&apos;t pinned. Change it any time.
        </p>
      </div>

      {/* Segmented preset control. Uses flex-wrap on mobile so the full
          row stays tappable even when 6 options run past the viewport. */}
      <div
        role="radiogroup"
        aria-label="Default session length preset"
        className="flex flex-wrap gap-2"
      >
        {PRESETS.map((p) => {
          const active = !customMode && value === p.min;
          return (
            <button
              key={p.min}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => {
                pickPreset(p.min);
              }}
              className={[
                "min-h-11 min-w-[4rem] rounded-[var(--radius-md)] border px-4 py-2 text-sm font-mono transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
                active
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.1)] text-[rgb(var(--brand-primary))] font-semibold"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))]",
                pending ? "opacity-50" : "",
              ].join(" ")}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={customMode}
          disabled={pending}
          onClick={() => {
            setCustomMode(true);
            setCustomDraft(String(value));
          }}
          className={[
            "min-h-11 min-w-[5rem] rounded-[var(--radius-md)] border px-4 py-2 text-sm font-mono transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
            customMode
              ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.1)] text-[rgb(var(--brand-primary))] font-semibold"
              : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))]",
            pending ? "opacity-50" : "",
          ].join(" ")}
        >
          Custom
        </button>
      </div>

      {customMode ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="default-session-custom">Custom minutes</Label>
            <Input
              id="default-session-custom"
              type="number"
              inputMode="numeric"
              min={MIN_CUSTOM}
              max={MAX_CUSTOM}
              step={5}
              value={customDraft}
              onChange={(e) => {
                setCustomDraft(e.target.value);
              }}
              onBlur={commitCustom}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCustom();
                }
              }}
              className="w-28 font-mono text-base"
              disabled={pending}
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="min-h-11"
            onClick={commitCustom}
            disabled={pending}
          >
            {pending ? "Saving…" : "Apply"}
          </Button>
          <p className="basis-full text-xs text-[rgb(var(--fg-muted))]">
            Integer minutes, {String(MIN_CUSTOM)}-{String(MAX_CUSTOM)}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
