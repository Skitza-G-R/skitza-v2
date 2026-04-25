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
    <div className="rounded-[var(--radius-md)] bg-[rgb(var(--bg-overlay)/0.5)] px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[0.78rem] font-semibold text-[rgb(var(--fg-primary))]">
          Default session length
        </h3>
        <span className="text-[0.66rem] text-[rgb(var(--fg-muted))]">
          Seeds new services
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="Default session length preset"
        className="flex flex-wrap gap-1.5"
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
                "h-7 min-w-[3rem] rounded-[var(--radius-sm)] border px-2.5 text-xs font-mono transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
                active
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
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
            "h-7 rounded-[var(--radius-sm)] border px-2.5 text-xs font-mono transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
            customMode
              ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
              : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
            pending ? "opacity-50" : "",
          ].join(" ")}
        >
          Custom
        </button>
      </div>

      {customMode ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Label htmlFor="default-session-custom" className="sr-only">
            Custom minutes
          </Label>
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
            className="h-8 w-20 font-mono text-base"
            disabled={pending}
          />
          <span className="text-xs text-[rgb(var(--fg-muted))]">min</span>
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={commitCustom}
            disabled={pending}
          >
            {pending ? "…" : "Apply"}
          </Button>
          <span className="text-[0.66rem] text-[rgb(var(--fg-muted))]">
            {String(MIN_CUSTOM)}–{String(MAX_CUSTOM)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
