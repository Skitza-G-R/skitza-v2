"use client";

import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { issueLeadLink, revokeLeadLink } from "./actions";
import { type LinkStatus } from "./status";

// "Copied" pill auto-reverts after this many ms. Long enough to register
// visually, short enough that a second copy click feels responsive.
const COPIED_RESET_MS = 2000;

// keep in sync with magic-link.ts:14 TargetEnum — duplicated as a literal
// so the client bundle doesn't pull in the server router file.
const TARGETS = ["portfolio", "booking"] as const;
type Target = (typeof TARGETS)[number];

// Server zod caps ttlHours at [1, 720]. These bounds are UX hints only;
// the server is the source of truth (see magic-link.ts IssueInput).
const TTL_MIN_HOURS = 1;
const TTL_MAX_HOURS = 720;
const TTL_DEFAULT_HOURS = 24;

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--fg-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary))]";

const labelClass =
  "block text-sm font-medium text-[rgb(var(--fg-primary))] mb-1";

export function StatusPill({ status }: { status: LinkStatus }) {
  const tone =
    status === "active"
      ? "border-[rgb(var(--brand-primary))] text-[rgb(var(--brand-primary))]"
      : "border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-secondary))]";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${tone}`}
    >
      {status}
    </span>
  );
}

interface IssuedBanner {
  url: string;
  linkId: string;
}

export function IssueForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("portfolio");
  const [ttlHours, setTtlHours] = useState<number>(TTL_DEFAULT_HOURS);
  const [leadId, setLeadId] = useState("");
  const [issued, setIssued] = useState<IssuedBanner | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  // Track the active "Copied" auto-reset timer so we can cancel it on
  // rapid re-clicks (no leaked timeouts) and on unmount (no setState
  // on an unmounted component).
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current !== null) {
        clearTimeout(copyResetTimer.current);
        copyResetTimer.current = null;
      }
    };
  }, []);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCopied(false);
    setCopyError(null);
    startTransition(async () => {
      const trimmedLead = leadId.trim();
      const res = await issueLeadLink({
        target,
        ttlHours,
        // Empty string means "no lead attached" — the server's zod schema
        // expects a UUID or omission, not "".
        ...(trimmedLead ? { leadId: trimmedLead } : {}),
      });
      if (res.ok) {
        setIssued(res.data);
        setLeadId("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  async function onCopy() {
    if (!issued) return;
    // The URL is one-shot — only sha256(token) is persisted, so a silent
    // clipboard failure (permissions denial, insecure context, focus
    // loss) means the producer loses the URL entirely with no way to
    // recover it. Always surface the failure and direct them to copy
    // the visible <code> block manually.
    try {
      await navigator.clipboard.writeText(issued.url);
    } catch {
      setCopied(false);
      setCopyError(
        "Copy failed — select the URL above and copy it manually before dismissing this banner.",
      );
      return;
    }
    setCopyError(null);
    setCopied(true);
    if (copyResetTimer.current !== null) {
      clearTimeout(copyResetTimer.current);
    }
    copyResetTimer.current = setTimeout(() => {
      setCopied(false);
      copyResetTimer.current = null;
    }, COPIED_RESET_MS);
  }

  return (
    <div className="space-y-4">
      {issued && (
        // Microcopy is load-bearing: the table cannot redisplay this URL
        // (only sha256(token) is in the DB), so the producer MUST be told
        // copying is one-shot. Without this wording they will assume they
        // can come back later.
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary))] bg-[rgb(var(--bg-elevated))] p-4"
        >
          <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
            Link issued. Copy this URL — it cannot be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1 font-mono text-xs text-[rgb(var(--fg-primary))]">
              {issued.url}
            </code>
            <button
              type="button"
              onClick={() => { void onCopy(); }}
              className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-3 py-1 text-xs font-medium text-[rgb(var(--fg-primary))]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => { setIssued(null); setCopied(false); setCopyError(null); }}
              className="text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
            >
              Dismiss
            </button>
          </div>
          {copyError && (
            <p
              role="alert"
              className="mt-2 text-sm text-[rgb(var(--fg-danger,239_68_68))]"
            >
              {copyError}
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      >
        <div>
          <label htmlFor="target" className={labelClass}>Target</label>
          <select
            id="target"
            value={target}
            onChange={(e) => { setTarget(e.target.value as Target); }}
            className={inputClass}
          >
            {TARGETS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ttlHours" className={labelClass}>TTL (hours)</label>
          <input
            id="ttlHours"
            type="number"
            min={TTL_MIN_HOURS}
            max={TTL_MAX_HOURS}
            value={ttlHours}
            onChange={(e) => { setTtlHours(Number(e.target.value)); }}
            className={inputClass}
            required
          />
        </div>
        <div>
          <label htmlFor="leadId" className={labelClass}>Lead ID (optional)</label>
          <input
            id="leadId"
            type="text"
            value={leadId}
            onChange={(e) => { setLeadId(e.target.value); }}
            placeholder="Lead UUID (optional)"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-medium text-[rgb(var(--bg-base))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.9)] disabled:opacity-50"
        >
          {pending ? "Issuing..." : "Issue link"}
        </button>
        {error && (
          <p
            role="alert"
            className="text-sm text-[rgb(var(--fg-danger,239_68_68))] sm:col-span-4"
          >
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

export function RevokeButton({ id, disabled }: { id: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRevoke() {
    setError(null);
    startTransition(async () => {
      const res = await revokeLeadLink({ id });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onRevoke}
        disabled={pending || disabled}
        className="text-sm text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-danger,239_68_68))] disabled:opacity-40"
      >
        {pending ? "Revoking..." : "Revoke"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-[rgb(var(--fg-danger,239_68_68))]">
          {error}
        </p>
      )}
    </div>
  );
}
