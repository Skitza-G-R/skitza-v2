"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { NewPackageForm } from "./package-form";

// The "+ New package" toggle lives as a client component so the page
// (a Server Component) stays server-only; only this small island is
// hydrated.
export function PackageToolbar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open ? (
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          + New package
        </Button>
      ) : null}
      {open ? (
        <div className="mt-4">
          <NewPackageForm
            onClose={() => {
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </>
  );
}
