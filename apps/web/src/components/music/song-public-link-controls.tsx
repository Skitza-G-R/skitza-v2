"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Copy, ExternalLink, Link2, RefreshCw, ShieldOff, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { useToast } from "~/components/ui/toast";

export type SongPublicSharingView = Readonly<{
  trackId: string;
  linkEnabled: boolean;
  portfolioPublished: boolean;
  remainingAudioCount: number;
  tokenVersion: number | null;
  publicUrl: string | null;
}>;

export type SongPublicSharingActionResult =
  | { ok: true; state: SongPublicSharingView }
  | { ok: false; error: string };

export type SongPublicSharingRefreshResult =
  | { ok: true; state: SongPublicSharingView | null }
  | { ok: false; error: string };

export type SongPublicSharingRefresh = (input: {
  trackId: string;
}) => Promise<SongPublicSharingRefreshResult>;

export type SongPublicLinkCopyResult =
  | { ok: true; state: SongPublicSharingView }
  | { ok: false; error: string; state?: SongPublicSharingView };

export type SongPublicSharingActions = Readonly<{
  publish: (input: { trackId: string; operationKey: string }) => Promise<SongPublicSharingActionResult>;
  reset: (input: { trackId: string; operationKey: string }) => Promise<SongPublicSharingActionResult>;
  disable: (input: { trackId: string; operationKey: string }) => Promise<SongPublicSharingActionResult>;
  setPortfolioPublic: (input: {
    trackId: string;
    operationKey: string;
    published: boolean;
  }) => Promise<SongPublicSharingActionResult>;
}>;

function publicStatus(state: SongPublicSharingView): "live" | "disabled" | "unpublished" {
  if (state.linkEnabled) return "live";
  return state.tokenVersion === null ? "unpublished" : "disabled";
}

/**
 * Artists re-check the authenticated server state at the moment of copying.
 * This prevents an already-open tab from copying a URL that the producer has
 * reset or disabled since the page rendered.
 */
export async function copyAuthoritativePublicSongLink(input: Readonly<{
  role: "producer" | "artist";
  state: SongPublicSharingView;
  refreshLiveState?: SongPublicSharingRefresh;
  writeText: (value: string) => Promise<void>;
}>): Promise<SongPublicLinkCopyResult> {
  let current = input.state;
  if (input.role === "artist") {
    if (!input.refreshLiveState) {
      return { ok: false, error: "Could not confirm that this public link is still live." };
    }
    let refreshed: SongPublicSharingRefreshResult;
    try {
      refreshed = await input.refreshLiveState({ trackId: input.state.trackId });
    } catch {
      return { ok: false, error: "Could not confirm that this public link is still live." };
    }
    if (!refreshed.ok) return refreshed;
    if (refreshed.state === null) {
      return {
        ok: false,
        error: "This public link is no longer live.",
        state: { ...input.state, linkEnabled: false, publicUrl: null },
      };
    }
    if (refreshed.state.trackId !== input.state.trackId) {
      return { ok: false, error: "Could not confirm that this public link is still live." };
    }
    current = refreshed.state;
  }

  if (!current.linkEnabled || current.publicUrl === null) {
    return { ok: false, error: "This public link is no longer live.", state: current };
  }

  try {
    await input.writeText(current.publicUrl);
    return { ok: true, state: current };
  } catch {
    return { ok: false, error: "Could not copy the link. Please try again." };
  }
}

export function SongPublicLinkControls({
  role,
  initialState,
  actions,
  refreshLiveState,
}: {
  role: "producer" | "artist";
  initialState: SongPublicSharingView;
  actions?: SongPublicSharingActions;
  refreshLiveState?: SongPublicSharingRefresh;
}) {
  const [state, setState] = useState(initialState);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<"reset" | "disable" | null>(null);
  const [copying, setCopying] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  if (role === "artist" && !state.linkEnabled) return null;

  const status = publicStatus(state);
  const canPublish = state.remainingAudioCount > 0;

  async function copyLink() {
    if (copying || !state.linkEnabled || !state.publicUrl) return;
    setCopying(true);
    const result = await copyAuthoritativePublicSongLink({
      role,
      state,
      ...(refreshLiveState ? { refreshLiveState } : {}),
      writeText: (value) => navigator.clipboard.writeText(value),
    });
    setCopying(false);
    if (result.state) setState(result.state);
    toast(result.ok ? "Public song link copied" : result.error, result.ok ? "success" : "error");
  }

  function run(
    action: (operationKey: string) => Promise<SongPublicSharingActionResult>,
    success: string,
  ) {
    startTransition(async () => {
      const result = await action(crypto.randomUUID());
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      setState(result.state);
      setConfirmation(null);
      toast(success, "success");
    });
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setConfirmation(null);
    }}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          data-test="song-public-link-control"
          className="sk-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-white/28 bg-white/[0.06] px-4 py-2 text-[12.5px] font-bold text-white transition-[background-color,transform] duration-200 hover:-translate-y-px hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transform-none motion-reduce:transition-none"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald-400 shadow-[0_0_10px_rgb(74_222_128/0.7)]" : "bg-white/35"}`}
          />
          {role === "artist" ? "Copy public link" : "Public link"}
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[91] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 text-[rgb(var(--fg-default))] shadow-[0_32px_90px_rgb(0_0_0/0.36)] focus:outline-none sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--brand-primary-dark))]">
                Guest listening
              </p>
              <DialogPrimitive.Title className="mt-2 font-display text-2xl font-bold tracking-[-0.025em]">
                Public song link
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
                Guests can listen to stored versions. Comments and downloads stay private.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close public link controls"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--fg-default)/0.06)] hover:text-[rgb(var(--fg-default))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] motion-reduce:transition-none"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="mt-6 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--fg-default)/0.025)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${status === "live" ? "bg-emerald-500" : "bg-[rgb(var(--fg-muted)/0.45)]"}`}
                  aria-hidden="true"
                />
                <span className="text-sm font-bold">
                  {status === "live" ? "Link live" : status === "disabled" ? "Link disabled" : "Not published"}
                </span>
              </div>
              {state.linkEnabled && state.publicUrl ? (
                <a
                  href={state.publicUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-3 text-xs font-bold text-[rgb(var(--brand-primary-dark))] hover:bg-[rgb(var(--brand-primary)/0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
                >
                  Preview <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            {state.linkEnabled && state.publicUrl ? (
              <p className="mt-3 break-all font-mono text-[11px] leading-relaxed text-[rgb(var(--fg-muted))]">
                {state.publicUrl}
              </p>
            ) : null}
          </div>

          {confirmation ? (
            <div role="alert" className="mt-5 rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-bold">
                {confirmation === "reset" ? "Replace this public URL?" : "Disable guest access?"}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
                {confirmation === "reset"
                  ? "The current page URL stops working immediately. A new URL will replace it."
                  : "The current page URL stops working immediately. Your separate portfolio setting is unchanged."}
              </p>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmation(null);
                  }}
                  disabled={pending}
                  className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-bold disabled:opacity-50"
                >
                  Keep current link
                </button>
                <button
                  type="button"
                  disabled={pending || !actions}
                  onClick={() => {
                    if (!actions) return;
                    run(
                      confirmation === "reset"
                        ? (operationKey) => actions.reset({ trackId: state.trackId, operationKey })
                        : (operationKey) => actions.disable({ trackId: state.trackId, operationKey }),
                      confirmation === "reset" ? "New public URL created" : "Public link disabled",
                    );
                  }}
                  className="min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-sm font-bold text-[rgb(var(--bg-base))] disabled:opacity-50"
                >
                  {pending ? "Working…" : confirmation === "reset" ? "Create new URL" : "Disable link"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {state.linkEnabled && state.publicUrl ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void copyLink()}
                    disabled={copying}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-primary))]"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" /> {copying ? "Checking…" : "Copy link"}
                  </button>
                  {role === "producer" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmation("reset");
                        }}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-bold"
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmation("disable");
                        }}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-red-500/25 px-4 text-sm font-bold text-red-700"
                      >
                        <ShieldOff className="h-4 w-4" aria-hidden="true" /> Disable
                      </button>
                    </>
                  ) : null}
                </div>
              ) : role === "producer" ? (
                <button
                  type="button"
                  disabled={pending || !actions || !canPublish}
                  onClick={() => {
                    if (!actions) return;
                    run(
                      (operationKey) => actions.publish({ trackId: state.trackId, operationKey }),
                      "Public song link is live",
                    );
                  }}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-bold text-[rgb(var(--fg-primary))] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {pending ? "Publishing…" : status === "disabled" ? "Publish a new URL" : "Publish public link"}
                </button>
              ) : null}

              {role === "producer" ? (
                <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold">Show in portfolio</p>
                    <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                      Always plays the newest stored audio. The public song link is independent.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={state.portfolioPublished}
                    aria-label="Show song in public portfolio"
                    disabled={pending || !actions || !canPublish}
                    onClick={() => {
                      if (!actions) return;
                      const published = !state.portfolioPublished;
                      run(
                        (operationKey) =>
                          actions.setPortfolioPublic({
                            trackId: state.trackId,
                            operationKey,
                            published,
                          }),
                        published ? "Song added to portfolio" : "Song removed from portfolio",
                      );
                    }}
                    className={`relative h-11 w-[68px] shrink-0 rounded-full border transition-colors disabled:opacity-50 motion-reduce:transition-none ${
                      state.portfolioPublished
                        ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))]"
                        : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--fg-default)/0.08)]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute top-1.5 h-8 w-8 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
                        state.portfolioPublished ? "translate-x-[30px]" : "translate-x-1.5"
                      }`}
                    />
                  </button>
                </div>
              ) : null}

              {!canPublish ? (
                <p role="status" className="text-sm text-[rgb(var(--fg-muted))]">
                  Upload stored audio before publishing this song.
                </p>
              ) : null}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
