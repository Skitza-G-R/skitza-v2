"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";

// UI-only stub for Google Calendar sync status. Real OAuth integration
// is tracked as a separate project — this component just lays the
// surface so the feature is discoverable.
//
// Current behavior: always renders "Not connected" with a Connect CTA
// that opens an inline "coming soon" modal. When OAuth lands the
// `status` prop will flip to "connected" based on a real server lookup.

type Status = "connected" | "not_connected";

export function GCalSyncBadge({
  // Accept the future status as a prop so the wiring is in place; the
  // caller hard-codes "not_connected" today. When the OAuth flow ships,
  // page.tsx reads the real state off the producer row and passes it
  // through — no consumer changes needed.
  status = "not_connected",
}: {
  status?: Status;
} = {}) {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [notified, setNotified] = useState(false);

  const isConnected = status === "connected";

  return (
    <>
      {/* Inline badge — first thing producers see on the Availability
          tab. Compact single-row layout: icon + label + status chip on
          the left, CTA on the right. Hint copy collapses on mobile. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--bg-overlay)/0.5)] px-3 py-2">
        <GoogleIcon />
        <span className="text-xs font-semibold text-[rgb(var(--fg-primary))]">
          Google Calendar
        </span>
        {isConnected ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[rgb(var(--fg-success)/0.12)] px-1.5 py-px text-[0.62rem] text-[rgb(var(--fg-success))]">
              <CheckIcon />
              Connected
            </span>
            <button
              type="button"
              className="ms-auto inline-flex h-7 items-center rounded-[var(--radius-sm)] px-2 text-xs text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-base))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              onClick={() => {
                toast(
                  "Disconnect is part of the Google Calendar integration — coming soon.",
                  "info",
                );
              }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center rounded-[var(--radius-sm)] bg-[rgb(var(--fg-warning)/0.14)] px-1.5 py-px text-[0.62rem] text-[rgb(var(--fg-warning))]">
              Not connected
            </span>
            <span className="hidden text-[0.66rem] text-[rgb(var(--fg-muted))] sm:inline">
              · Auto-block busy times
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="ms-auto h-7 px-2.5 text-xs"
              onClick={() => {
                setModalOpen(true);
              }}
            >
              Connect
            </Button>
          </>
        )}
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(var(--bg-base)/0.7)] p-4 backdrop-blur-sm sm:items-center"
          onClick={() => {
            setModalOpen(false);
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gcal-waitlist-title"
            className="w-full max-w-md rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-2xl"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="flex items-start gap-3">
              <GoogleIcon large />
              <div className="min-w-0 flex-1">
                <h3
                  id="gcal-waitlist-title"
                  className="font-display text-lg tracking-tight"
                  style={{ fontWeight: 700 }}
                >
                  Google Calendar sync — coming soon
                </h3>
                <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
                  We&apos;re wiring up two-way sync with Google Calendar so
                  busy blocks on your personal calendar automatically close
                  bookable slots here — no manual blackouts.
                </p>
                <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
                  We&apos;ll email you as soon as it lands.
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => {
                  setModalOpen(false);
                }}
              >
                Close
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={notified}
                onClick={() => {
                  // TODO(gcal-oauth): wire this into the real waitlist
                  // signal source (same table used by the landing-page
                  // waitlist, or a separate "gcal-interest" bucket) so
                  // we can notify signed-in producers when it lands.
                  setNotified(true);
                  toast(
                    "We'll notify you when Google Calendar sync is ready.",
                    "success",
                  );
                }}
              >
                {notified ? "You're on the list" : "Notify me"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function GoogleIcon({ large = false }: { large?: boolean } = {}) {
  const size = large ? 28 : 20;
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className="flex-shrink-0"
    >
      <path
        d="M44.5 20H24v8.5h11.75C34.5 32.75 29.83 36 24 36c-6.63 0-12-5.37-12-12s5.37-12 12-12c2.95 0 5.63 1.08 7.7 2.85L37.9 9.2C34.3 6.07 29.4 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20c11.5 0 19.8-8.1 19.8-20 0-1.4-.15-2.7-.3-4z"
        fill="#4285F4"
      />
      <path
        d="M6.3 14.7l7 5.13C15.15 15.38 19.22 12 24 12c2.95 0 5.63 1.08 7.7 2.85L37.9 9.2C34.3 6.07 29.4 4 24 4 16.3 4 9.6 8.45 6.3 14.7z"
        fill="#EA4335"
      />
      <path
        d="M24 44c5.3 0 10.1-2 13.66-5.25l-6.3-5.2C29.4 35.4 26.86 36 24 36c-5.8 0-10.72-3.3-12.6-8.15l-7 5.4C7.72 39.5 15.3 44 24 44z"
        fill="#34A853"
      />
      <path
        d="M44.5 20H24v8.5h11.75c-.85 2.4-2.45 4.4-4.4 5.7l6.3 5.2C41.55 36.5 44 31 44 24c0-1.4-.15-2.7-.3-4z"
        fill="#FBBC05"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3 w-3"
    >
      <path d="M2.5 6L5 8.5L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
