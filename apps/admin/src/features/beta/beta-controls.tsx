"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./beta.module.css";
import type { BetaInviteeStatus } from "./view-model";

// SK-273 — the interactive islands of the founder Beta page. Every mutation
// goes through the admin beta API with a fresh idempotency key and ends with
// router.refresh(), so the server view re-renders from database truth.

type PostResult = Readonly<{ ok: boolean; payload: unknown; status: number }>;

async function postBeta(
  path: "import" | "release" | "remove" | "wave",
  body: Readonly<Record<string, unknown>>,
): Promise<PostResult> {
  const response = await fetch(`/api/admin/beta/${path}`, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `beta-${path}-${crypto.randomUUID()}`,
    },
    method: "POST",
  });
  const payload: unknown = await response.json().catch(() => null);
  return { ok: response.ok, payload, status: response.status };
}

function isImportSummary(value: unknown): value is Readonly<{
  duplicates: number;
  inserted: number;
  invalidCount: number;
  invalidLines: readonly string[];
  skipped: number;
}> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.inserted === "number" &&
    typeof record.skipped === "number" &&
    typeof record.duplicates === "number" &&
    typeof record.invalidCount === "number" &&
    Array.isArray(record.invalidLines)
  );
}

function isReleaseSummary(value: unknown): value is Readonly<{
  attempted: number;
  failures: readonly Readonly<{ code: string; email: string }>[];
  invited: number;
}> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.attempted === "number" &&
    typeof record.invited === "number" &&
    Array.isArray(record.failures)
  );
}

export function ImportBetaList() {
  const router = useRouter();
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [invalidLines, setInvalidLines] = useState<readonly string[]>([]);

  async function submit() {
    if (busy || list.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setInvalidLines([]);
    try {
      const result = await postBeta("import", { list });
      if (!result.ok || !isImportSummary(result.payload)) {
        setError(
          result.status === 400
            ? "That list could not be read. One person per line: email, name, wave."
            : "The import did not complete. It is safe to try again.",
        );
        return;
      }
      const summary = result.payload;
      const parts = [`Added ${String(summary.inserted)}`];
      if (summary.skipped > 0) parts.push(`${String(summary.skipped)} already on the list`);
      if (summary.duplicates > 0) {
        parts.push(`${String(summary.duplicates)} repeated in the paste`);
      }
      if (summary.invalidCount > 0) parts.push(`${String(summary.invalidCount)} lines rejected`);
      setMessage(`${parts.join(" · ")}.`);
      setInvalidLines(summary.invalidLines);
      if (summary.inserted > 0) setList("");
      router.refresh();
    } catch {
      setError("The import did not complete. It is safe to try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Import beta list" className={styles.panel}>
      <h2 className={styles.panelTitle}>Add people to the list</h2>
      <p className={styles.panelHint}>
        Paste from your spreadsheet — one person per line, columns in this order: email, name, wave.
        Name and wave are optional (wave defaults to 1). Nobody is emailed at this step.
      </p>
      <textarea
        aria-label="Beta list to import"
        className={styles.textarea}
        disabled={busy}
        onChange={(event) => {
          setList(event.target.value);
        }}
        placeholder={"noa@example.com, Noa Levi, 1\ndan@example.com, Dan, 2\nmaya@example.com"}
        value={list}
      />
      <div className={styles.controlsRow}>
        <button
          className={styles.button}
          data-variant="primary"
          disabled={busy || list.trim().length === 0}
          onClick={() => {
            void submit();
          }}
          type="button"
        >
          {busy ? "Adding…" : "Add to list"}
        </button>
        {message ? <p className={styles.message}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
      {invalidLines.length > 0 ? (
        <ul className={styles.invalidList}>
          {invalidLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// SK-277: a bare failure count leaves the founder guessing whether an address
// was rejected or the server broke. Translate each server code into the next
// action a person can actually take.
const RELEASE_FAILURE_REASONS: Readonly<Record<string, string>> = {
  INVALID_REQUEST: "the address was rejected — check it for typos",
  TARGET_NOT_ELIGIBLE: "this account cannot be invited (already used, banned, or unverified)",
  UNAVAILABLE: "the invitation service did not answer — safe to retry",
};

function releaseFailureReason(code: string): string {
  return RELEASE_FAILURE_REASONS[code] ?? "unknown error — safe to retry";
}

export function ReleaseWaveButton({
  pendingCount,
  wave,
}: {
  pendingCount: number;
  wave: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failures, setFailures] = useState<readonly Readonly<{ code: string; email: string }>[]>(
    [],
  );

  async function release() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setFailures([]);
    try {
      const result = await postBeta("release", { wave });
      if (!result.ok || !isReleaseSummary(result.payload)) {
        setError("The wave was not released. It is safe to try again.");
        return;
      }
      const summary = result.payload;
      setMessage(
        summary.failures.length === 0
          ? `Sent ${String(summary.invited)} invitation${summary.invited === 1 ? "" : "s"}.`
          : `Sent ${String(summary.invited)} of ${String(summary.attempted)} — ${String(summary.failures.length)} failed, retry releases only those.`,
      );
      setFailures(summary.failures.slice(0, 10));
      setConfirming(false);
      router.refresh();
    } catch {
      setError("The wave was not released. It is safe to try again.");
    } finally {
      setBusy(false);
    }
  }

  if (pendingCount === 0 && !message && !error) return null;

  return (
    <div className={styles.releaseGroup}>
      {failures.length > 0 ? (
        <ul className={styles.failureList}>
          {failures.map((failure) => (
            <li key={failure.email}>
              {failure.email} — {releaseFailureReason(failure.code)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.rowActions}>
        {message ? <p className={styles.message}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        {pendingCount > 0 && !confirming ? (
          <button
            className={styles.button}
            data-variant="primary"
            onClick={() => {
              setConfirming(true);
            }}
            type="button"
          >
            Release wave {wave} ({pendingCount})
          </button>
        ) : null}
        {pendingCount > 0 && confirming ? (
          <>
            <button
              className={styles.button}
              data-variant="primary"
              disabled={busy}
              onClick={() => {
                void release();
              }}
              type="button"
            >
              {busy
                ? "Sending…"
                : `Send ${String(pendingCount)} invitation${pendingCount === 1 ? "" : "s"} now`}
            </button>
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
              type="button"
            >
              Cancel
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function BetaRowActions({
  email,
  status,
  wave,
}: {
  email: string;
  status: BetaInviteeStatus;
  wave: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<PostResult>, failure: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(failure);
        return;
      }
      setConfirmingRemove(false);
      router.refresh();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const movable = status === "pending" || status === "invited";

  return (
    <div className={styles.rowActions}>
      {movable ? (
        <select
          aria-label={`Wave for ${email}`}
          className={styles.waveSelect}
          disabled={busy}
          onChange={(event) => {
            void run(
              () =>
                postBeta("wave", {
                  emailAddress: email,
                  wave: Number(event.target.value),
                }),
              "The wave change was not saved.",
            );
          }}
          value={wave}
        >
          {Array.from({ length: 9 }, (_, index) => index + 1).map((option) => (
            <option key={option} value={option}>
              Wave {option}
            </option>
          ))}
        </select>
      ) : null}
      {status === "invited" ? (
        <button
          className={styles.button}
          disabled={busy}
          onClick={() => {
            void run(
              () => postBeta("release", { emailAddress: email }),
              "The invitation was not re-sent.",
            );
          }}
          type="button"
        >
          {busy ? "Working…" : "Re-invite"}
        </button>
      ) : null}
      {status === "pending" && !confirmingRemove ? (
        <button
          className={styles.button}
          data-variant="danger"
          disabled={busy}
          onClick={() => {
            setConfirmingRemove(true);
          }}
          type="button"
        >
          Remove
        </button>
      ) : null}
      {status === "pending" && confirmingRemove ? (
        <>
          <button
            className={styles.button}
            data-variant="danger"
            disabled={busy}
            onClick={() => {
              void run(
                () => postBeta("remove", { emailAddress: email }),
                "The row was not removed.",
              );
            }}
            type="button"
          >
            {busy ? "Removing…" : "Yes, remove"}
          </button>
          <button
            className={styles.button}
            disabled={busy}
            onClick={() => {
              setConfirmingRemove(false);
            }}
            type="button"
          >
            Keep
          </button>
        </>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
