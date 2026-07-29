"use client";

import { useState } from "react";

import {
  isSuccessfulAdminUnlock,
  requestAdminUnlock,
  type AdminUnlockResult,
} from "~/lib/unlock-request";

type ReauthenticationResult = Extract<
  AdminUnlockResult,
  { reauthenticationRequired: true }
>;

export function UnlockButton({ finishing = false }: { finishing?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reauthentication, setReauthentication] =
    useState<ReauthenticationResult | null>(null);

  async function handleUnlock() {
    setBusy(true);
    setError(null);
    try {
      const response = await requestAdminUnlock();
      if (!isSuccessfulAdminUnlock(response)) {
        if ("accessLoginRequired" in response) {
          window.location.assign(window.location.href);
          return;
        }
        if ("reauthenticationRequired" in response) {
          setReauthentication(response);
          setBusy(false);
          return;
        }
        throw new Error("unlock_failed");
      }
      window.location.assign("/");
    } catch {
      setError("Secure re-entry was not completed.");
      setBusy(false);
    }
  }

  if (reauthentication) {
    return (
      <div style={{ marginTop: "1.5rem" }}>
        <p className="access-copy" style={{ fontSize: "0.82rem" }}>
          Re-entry needs a newly issued Cloudflare Access proof. Sign out of
          Access in a separate tab, then return here to continue through MFA.
        </p>
        <a
          className="primary-button"
          href={reauthentication.logoutPath}
          rel="noopener noreferrer"
          style={{
            display: "block",
            marginTop: "1rem",
            textAlign: "center",
            textDecoration: "none",
            width: "100%",
          }}
          target="_blank"
        >
          Start secure re-entry
        </a>
        <button
          className="secondary-button"
          style={{ marginTop: "0.75rem", width: "100%" }}
          type="button"
          onClick={() => {
            window.location.assign("/unlock?complete=1");
          }}
        >
          Continue after sign-out
        </button>
      </div>
    );
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
        {busy
          ? "Verifying…"
          : finishing
            ? "Finish unlocking"
            : "Unlock admin"}
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
