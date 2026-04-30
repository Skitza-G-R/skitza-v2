"use client";

import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { type InitialPackageValues, NewPackageForm } from "./package-form";

// Wrapper so the Edit button + the inline form modal can live inside a
// Server Component page. Matches the PackageToolbar pattern — when
// closed, only the small button is hydrated; when open, the full form
// renders inside a modal overlay that floats above the grid (the card
// row itself is inside a CSS grid, so an inline expand would break
// layout — a modal sidesteps that cleanly).
//
// `values` is the current product's state straight from the DB
// (priceCents, minutes, etc.) — the form reshapes these into its own
// internal dollars + form state on mount.
export function EditPackageButton({
  values,
}: {
  values: InitialPackageValues;
}) {
  const [open, setOpen] = useState(false);

  // Close on Escape. Defensive against runaway focus traps — clicking
  // the backdrop is the primary dismiss path, this is the keyboard
  // fallback.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Edit
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${values.name}`}
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center sm:p-6"
          onClick={() => {
            setOpen(false);
          }}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="w-full max-w-2xl"
          >
            <NewPackageForm
              initialValues={values}
              onClose={() => {
                setOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
