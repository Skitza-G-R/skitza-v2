"use client";

import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input, Label, Select } from "~/components/ui/input";
import { QrCode } from "~/components/ui/qr-code";
import { useToast } from "~/components/ui/toast";
import { issueLeadLink, revokeLeadLink } from "./actions";
import { type LinkStatus } from "./status";

// "Copied" pill auto-reverts after this many ms.
const COPIED_RESET_MS = 2000;

// keep in sync with magic-link.ts:14 TargetEnum — duplicated as a literal
// so the client bundle doesn't pull in the server router file.
const TARGETS = ["portfolio", "booking"] as const;
type Target = (typeof TARGETS)[number];

// Server zod caps ttlHours at [1, 720]. UX hints only — server is the source of truth.
const TTL_MIN_HOURS = 1;
const TTL_MAX_HOURS = 720;
const TTL_DEFAULT_HOURS = 24;

export function StatusPill({ status }: { status: LinkStatus }) {
  if (status === "active") return <Badge variant="active" dot>Active</Badge>;
  if (status === "expired") return <Badge variant="warning" dot>Expired</Badge>;
  return <Badge variant="danger" dot>Revoked</Badge>;
}

interface IssuedBanner {
  url: string;
  linkId: string;
}

export function IssueForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("portfolio");
  const [ttlHours, setTtlHours] = useState<number>(TTL_DEFAULT_HOURS);
  const [leadId, setLeadId] = useState("");
  const [issued, setIssued] = useState<IssuedBanner | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref for the just-issued banner — scrolled into view after issue so
  // a producer who submitted while scrolled doesn't miss the one-shot URL.
  const bannerRef = useRef<HTMLDivElement | null>(null);

  // Scroll the banner into view whenever a new URL is issued. `smooth`
  // is polite; `block: "nearest"` avoids jumping if already visible.
  useEffect(() => {
    if (issued && bannerRef.current) {
      bannerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [issued]);

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
        ...(trimmedLead ? { leadId: trimmedLead } : {}),
      });
      if (res.ok) {
        setIssued(res.data);
        setLeadId("");
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  async function onCopy() {
    if (!issued) return;
    // The URL is one-shot — only sha256(token) is persisted, so a silent
    // clipboard failure means the producer loses the URL entirely with no
    // way to recover it. Always surface the failure and direct them to
    // copy the visible <code> block manually.
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
    toast("URL copied — paste it wherever.", "success");
    if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => {
      setCopied(false);
      copyResetTimer.current = null;
    }, COPIED_RESET_MS);
  }

  return (
    <div className="space-y-4">
      {issued ? (
        // Microcopy is load-bearing: the table cannot redisplay this URL,
        // so the producer MUST be told copying is one-shot.
        <div
          ref={bannerRef}
          role="status"
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.07)] p-4 reveal-up"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]">
                <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))] pulse-green" />
                New link issued
              </p>
              <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">
                Copy this URL now — we never store the raw token, so we can&apos;t show it to you again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIssued(null);
                setCopied(false);
                setCopyError(null);
              }}
              aria-label="Dismiss banner"
              className="shrink-0 font-mono text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
            {/* URL + copy */}
            <div className="flex flex-1 flex-col gap-2">
              <code className="flex-1 truncate rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 font-mono text-xs text-[rgb(var(--fg-primary))]">
                {issued.url}
              </code>
              <Button type="button" size="sm" onClick={() => void onCopy()} className="self-start">
                {copied ? "✓ Copied" : "Copy URL"}
              </Button>
              <p className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                Or scan the code → ships the link straight to a phone.
              </p>
            </div>
            {/* QR — scan-ready, shipped for IRL hand-offs (print, a
                screen-to-screen pass, etc). Wrapped in a muted card so
                it reads as a secondary surface to the primary URL. */}
            <div className="flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-2">
              <QrCode value={issued.url} size={96} />
            </div>
          </div>
          {copyError ? (
            <p role="alert" className="mt-2 text-sm text-[rgb(var(--fg-danger))]">
              {copyError}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
          <div>
            <Label htmlFor="target">Target</Label>
            <Select
              id="target"
              value={target}
              onChange={(e) => { setTarget(e.target.value as Target); }}
            >
              {TARGETS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ttlHours">TTL · hours</Label>
            <Input
              id="ttlHours"
              type="number"
              min={TTL_MIN_HOURS}
              max={TTL_MAX_HOURS}
              value={ttlHours}
              onChange={(e) => { setTtlHours(Number(e.target.value)); }}
              required
            />
          </div>
          <div>
            <Label htmlFor="leadId">Lead ID · optional</Label>
            <Input
              id="leadId"
              type="text"
              value={leadId}
              onChange={(e) => { setLeadId(e.target.value); }}
              placeholder="attach a lead UUID"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Issuing…" : "Issue link"}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger))]">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}

export function RevokeButton({ id, disabled }: { id: string; disabled: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Two-step revoke to match the portfolio Delete pattern. Revoke is
  // destructive (404s all in-flight holders of the URL) so a single
  // click shouldn't be enough.
  const [confirm, setConfirm] = useState(false);

  function onRevoke() {
    setError(null);
    startTransition(async () => {
      const res = await revokeLeadLink({ id });
      if (res.ok) {
        toast("Link revoked. Any outstanding opens will 404.", "success");
        setConfirm(false);
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      {confirm ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onRevoke}
            disabled={pending || disabled}
          >
            {pending ? "Revoking…" : "Confirm"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirm(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => {
            setConfirm(true);
          }}
          disabled={disabled}
        >
          Revoke
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
