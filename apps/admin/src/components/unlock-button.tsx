"use client";

import { useState } from "react";
import { useReverification } from "@clerk/nextjs";

import {
  isSuccessfulAdminUnlock,
  requestAdminUnlock,
} from "~/lib/unlock-request";

export function UnlockButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlock = useReverification(requestAdminUnlock);

  async function handleUnlock() {
    setBusy(true);
    setError(null);
    try {
      const response = await unlock();
      if (!isSuccessfulAdminUnlock(response)) {
        throw new Error("unlock_failed");
      }
      window.location.assign("/");
    } catch {
      setError("Secure re-entry was not completed.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="primary-button"
        style={{ marginTop: "1.5rem", width: "100%" }}
        type="button"
        disabled={busy}
        onClick={() => {
          void handleUnlock();
        }}
      >
        {busy ? "Verifying…" : "Unlock admin"}
      </button>
      {error ? (
        <p
          role="alert"
          style={{
            color: "rgb(var(--live))",
            fontSize: "0.8rem",
            margin: "0.75rem 0 0",
          }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
