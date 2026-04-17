"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { setPaid } from "../actions";

// Toggle the project's payment state. V1: producer flips manually.
// Phase C: Stripe webhook does it automatically.
export function PaidToggle({
  projectId,
  depositPaid,
  finalPaid,
}: {
  projectId: string;
  depositPaid: boolean;
  finalPaid: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [d, setD] = useState(depositPaid);
  const [f, setF] = useState(finalPaid);

  function flip(kind: "deposit" | "final", value: boolean) {
    if (kind === "deposit") setD(value);
    else setF(value);
    startTransition(async () => {
      const res = await setPaid({ projectId, kind, value });
      if (!res.ok) {
        // Revert optimistic update on failure.
        if (kind === "deposit") setD(!value);
        else setF(!value);
        toast(res.error, "error");
        return;
      }
      toast(
        `${kind === "deposit" ? "Deposit" : "Final"} ${value ? "marked paid" : "cleared"}.`,
        "success",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={d ? "default" : "outline"}
        onClick={() => {
          flip("deposit", !d);
        }}
        disabled={pending}
      >
        {d ? "✓ Deposit paid" : "Mark deposit paid"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={f ? "default" : "outline"}
        onClick={() => {
          flip("final", !f);
        }}
        disabled={pending}
      >
        {f ? "✓ Final paid · downloads unlocked" : "Mark final paid"}
      </Button>
    </div>
  );
}
