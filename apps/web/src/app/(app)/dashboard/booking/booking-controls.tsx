"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { confirmBooking, rejectBooking } from "./actions";

export function BookingActionButtons({ id, artistName }: { id: string; artistName: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [rejectConfirm, setRejectConfirm] = useState(false);

  function onConfirm() {
    startTransition(async () => {
      const res = await confirmBooking({ id });
      if (res.ok) {
        toast(`Confirmed booking with ${artistName}.`, "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onReject() {
    startTransition(async () => {
      const res = await rejectBooking({ id });
      if (res.ok) {
        toast("Booking rejected.", "info");
        setRejectConfirm(false);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Button type="button" size="sm" onClick={onConfirm} disabled={pending}>
        {pending ? "…" : "Confirm"}
      </Button>
      {rejectConfirm ? (
        <>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onReject}
            disabled={pending}
          >
            {pending ? "…" : "Confirm reject"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRejectConfirm(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setRejectConfirm(true);
          }}
          disabled={pending}
        >
          Reject
        </Button>
      )}
    </div>
  );
}
