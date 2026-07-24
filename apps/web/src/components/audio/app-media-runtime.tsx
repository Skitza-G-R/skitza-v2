"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useRef } from "react";

import {
  cancelManagedUpload,
  cancelManagedUploadsForAccount,
  hasActiveManagedUploads,
  managedUploadIsActive,
  releaseManagedUploadsForAccount,
  retryManagedUpload,
  setUploadRuntimeAccountId,
  useManagedUploads,
} from "~/lib/audio/upload-manager";
import {
  cancelPersistedUploadsForAccount,
  startMultipartCancellationRecovery,
} from "~/lib/audio/use-multipart-upload";
import { AppPlaybackRuntime, clearPlaybackForAccount } from "./playback-runtime";

type SignOutOptions = { redirectUrl?: string };

async function prepareAccountExit(accountId: string): Promise<boolean> {
  // The active in-memory callbacks hold the File and can abort an in-flight
  // PUT immediately. The journal pass then catches an identity whose owning
  // component disappeared or whose cancellation callback failed.
  let activeCancelled = false;
  let journalCancelled = false;
  try {
    activeCancelled = await cancelManagedUploadsForAccount(accountId);
  } catch {
    // Continue so the durable journal gets its own cancellation attempt.
  }
  try {
    journalCancelled = await cancelPersistedUploadsForAccount(accountId);
  } catch {
    // A failed identity remains in the account-scoped journal.
  }
  await clearPlaybackForAccount(accountId);
  releaseManagedUploadsForAccount(accountId);
  return activeCancelled && journalCancelled;
}

/**
 * Custom sign-out adapter for explicit app buttons. Cleanup is awaited while
 * Clerk still owns the authenticated session; a failed exact cancellation
 * remains in the account-scoped durable journal.
 */
export function useSafeSignOut(): (options?: SignOutOptions) => Promise<void> {
  const clerk = useClerk();
  const { user } = useUser();
  return useCallback(
    async (options?: SignOutOptions) => {
      try {
        if (user?.id) await prepareAccountExit(user.id);
      } finally {
        await clerk.signOut(options);
      }
    },
    [clerk, user?.id],
  );
}

function AppUploadRuntime({ accountId }: { accountId: string | null | undefined }) {
  const clerk = useClerk();
  const previousAccountRef = useRef<string | null>(null);
  const interceptingSignOutRef = useRef(false);

  useEffect(() => {
    if (accountId === undefined) return;
    const previous = previousAccountRef.current;

    // Change the visible snapshot synchronously. Records from another account
    // can never flash while its best-effort cleanup continues.
    setUploadRuntimeAccountId(accountId);
    previousAccountRef.current = accountId;

    if (previous && previous !== accountId) {
      void prepareAccountExit(previous);
    }
    if (!accountId) return;
    return startMultipartCancellationRecovery();
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasActiveManagedUploads(accountId)) return;
      event.preventDefault();
      // Legacy Safari still requires returnValue in addition to preventDefault.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const onClerkSignOut = (event: MouseEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !target.closest('[data-localization-key="userButtonPopoverActionSignOut"]') ||
        interceptingSignOutRef.current
      ) {
        return;
      }
      // Clerk's built-in UserButton otherwise destroys auth immediately. Stop
      // that click and run the same awaited custom flow first.
      event.preventDefault();
      event.stopImmediatePropagation();
      interceptingSignOutRef.current = true;
      void prepareAccountExit(accountId)
        .catch(() => {
          // Failed exact cancellation remains in the scoped journal.
        })
        .then(() => clerk.signOut())
        .finally(() => {
          interceptingSignOutRef.current = false;
        });
    };
    document.addEventListener("click", onClerkSignOut, true);
    return () => {
      document.removeEventListener("click", onClerkSignOut, true);
    };
  }, [accountId, clerk]);

  return <UploadActivityDock />;
}

function UploadActivityDock() {
  const uploads = useManagedUploads();
  if (uploads.length === 0) return null;
  const visible = uploads.slice(-3);

  return (
    <aside
      aria-label="Upload activity"
      className="fixed right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[55] grid w-[min(22rem,calc(100vw-1.5rem))] gap-2 lg:bottom-4"
    >
      {visible.map((upload) => {
        const active = managedUploadIsActive(upload);
        const progressLabel =
          upload.status === "preparing"
            ? "Preparing…"
            : upload.status === "completing"
              ? "Finishing…"
              : upload.status === "cancelling"
                ? "Stopping…"
                : upload.status === "done"
                  ? "Upload complete"
                  : upload.status === "error"
                    ? (upload.error ?? "Upload failed")
                    : `Uploading · ${String(upload.progress)}%`;
        return (
          <section
            key={upload.id}
            data-native-update-block={active ? "active" : undefined}
            aria-busy={active}
            className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 shadow-[var(--shadow-lg)]"
            aria-live="polite"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[rgb(var(--fg-default))]">
                  {upload.label}
                </p>
                <p className="truncate text-xs text-[rgb(var(--fg-muted))]">{upload.fileName}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-[rgb(var(--fg-muted))] tabular-nums">
                {upload.status === "uploading" ? `${String(upload.progress)}%` : null}
              </span>
            </div>

            {active ? (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={upload.progress}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--bg-sunken))]"
              >
                <div
                  className="h-full bg-[rgb(var(--brand-primary))] transition-[width] motion-reduce:transition-none"
                  style={{ width: `${String(upload.progress)}%` }}
                />
              </div>
            ) : null}

            <div className="mt-2 flex items-center justify-between gap-3">
              <p
                className={`text-xs ${
                  upload.status === "error"
                    ? "text-[rgb(var(--fg-danger))]"
                    : "text-[rgb(var(--fg-muted))]"
                }`}
              >
                {progressLabel}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                {upload.canRetry && upload.status === "error" ? (
                  <button
                    type="button"
                    className="rounded-[var(--radius-lg)] px-2.5 py-1.5 text-xs font-semibold text-[rgb(var(--fg-default))] ring-1 ring-[rgb(var(--border-strong))]"
                    onClick={() => {
                      void retryManagedUpload(upload.id);
                    }}
                  >
                    Retry
                  </button>
                ) : null}
                {upload.canCancel && active ? (
                  <button
                    type="button"
                    className="rounded-[var(--radius-lg)] px-2.5 py-1.5 text-xs font-semibold text-[rgb(var(--fg-danger))]"
                    onClick={() => {
                      void cancelManagedUpload(upload.id);
                    }}
                  >
                    Stop
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </aside>
  );
}

/**
 * Exact root adapter for SK-110. Mount once under ClerkProvider, alongside
 * NativeAppRuntime. It renders the single audio element and persistent upload
 * activity while route shells remain presentation-only.
 */
export function AppMediaRuntime() {
  const { isLoaded, user } = useUser();
  const accountId = isLoaded ? (user?.id ?? null) : undefined;
  return (
    <>
      <AppPlaybackRuntime accountId={accountId} />
      <AppUploadRuntime accountId={accountId} />
    </>
  );
}
