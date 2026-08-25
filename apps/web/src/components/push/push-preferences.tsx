"use client";

import { BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  getPushStatusAction,
  savePushSubscriptionAction,
  unsubscribePushAction,
} from "~/app/push-actions";
import {
  PUSH_CATEGORIES,
  pushCategoryCopyForRole,
  type PushCategory,
  type PushCopyRole,
} from "~/lib/push/categories";
import {
  applicationServerKey,
  enableAllPushCategories,
  subscriptionInput,
} from "~/lib/push/enable";
import {
  isAppleMobileDevice,
  isStandaloneDisplay,
  requestInstallGuidance,
} from "~/lib/pwa/install-guidance";
import {
  confirmBrowserPushUnsubscribe,
  getPushAccountBoundaryGeneration,
  PUSH_ACCOUNT_BOUNDARY_EVENT,
  PUSH_SUBSCRIPTION_CLEARED_EVENT,
  pushAccountBoundaryAllowsDelivery,
  resumeBrowserPushDelivery,
  runTrackedPushSubscriptionWrite,
} from "~/lib/push/browser-subscription";

type BrowserState = Readonly<{
  configured: boolean;
  publicKey: string | null;
  subscription: PushSubscription | null;
}>;

export function PushPreferences({ role = "producer" }: { role?: PushCopyRole } = {}) {
  const copyMap = pushCategoryCopyForRole(role);
  const [browser, setBrowser] = useState<BrowserState>({
    configured: false,
    publicKey: null,
    subscription: null,
  });
  const [categories, setCategories] = useState<PushCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PushCategory | null>(null);
  const [masterPending, setMasterPending] = useState(false);
  const [installRequired, setInstallRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadVersion = 0;
    async function load() {
      const version = ++loadVersion;
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) {
          setLoading(false);
          // iPhone Safari has no web push outside the installed app — guide
          // people to the Home Screen instead of showing a dead end.
          const platformValue: unknown = Reflect.get(navigator, "platform");
          if (
            isAppleMobileDevice({
              userAgent: navigator.userAgent,
              platform: typeof platformValue === "string" ? platformValue : "",
              maxTouchPoints: navigator.maxTouchPoints,
            }) &&
            !isStandaloneDisplay()
          ) {
            setInstallRequired(true);
          } else {
            setError("Push notifications are not supported in this browser.");
          }
        }
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        const status = await getPushStatusAction(subscription?.endpoint ?? null);
        if (cancelled || version !== loadVersion) return;
        if (!status.ok) {
          setError(status.error);
          return;
        }
        setBrowser({
          configured: status.configured,
          publicKey: status.publicKey,
          subscription,
        });
        setCategories(status.categories);
        if (!status.configured) {
          setError("Push notifications are not available yet.");
        }
      } catch {
        if (!cancelled) {
          setError("Push notification settings could not be loaded.");
        }
      } finally {
        if (!cancelled && version === loadVersion) setLoading(false);
      }
    }
    const onAccountBoundary = () => {
      loadVersion += 1;
      setPending(null);
    };
    const onSubscriptionCleared = () => {
      loadVersion += 1;
      setBrowser((current) => ({ ...current, subscription: null }));
      setCategories([]);
      setError(null);
      setLoading(true);
      void load();
    };
    window.addEventListener(PUSH_ACCOUNT_BOUNDARY_EVENT, onAccountBoundary);
    window.addEventListener(PUSH_SUBSCRIPTION_CLEARED_EVENT, onSubscriptionCleared);
    void load();
    return () => {
      cancelled = true;
      window.removeEventListener(PUSH_ACCOUNT_BOUNDARY_EVENT, onAccountBoundary);
      window.removeEventListener(PUSH_SUBSCRIPTION_CLEARED_EVENT, onSubscriptionCleared);
    };
  }, []);

  const toggle = useCallback(
    async (category: PushCategory) => {
      const boundaryGeneration = getPushAccountBoundaryGeneration();
      const boundaryIsCurrent = () => pushAccountBoundaryAllowsDelivery(boundaryGeneration);
      if (pending || !browser.configured || !browser.publicKey || !boundaryIsCurrent()) {
        return;
      }
      setPending(category);
      setError(null);
      const enabling = !categories.includes(category);
      let subscription = browser.subscription;
      let createdSubscription = false;
      const discardCreatedSubscription = async () => {
        if (!createdSubscription || !subscription) return;
        try {
          await subscription.unsubscribe();
        } catch {
          // The account boundary owns any remaining fail-closed cleanup.
        }
      };

      try {
        if (enabling) {
          let permission = Notification.permission;
          if (permission === "default") {
            // The browser prompt is reached only from this deliberate click
            // on a real notification category—never during mount/first launch.
            permission = await Notification.requestPermission();
          }
          if (!boundaryIsCurrent()) return;
          if (permission !== "granted") {
            setError("Allow notifications in your browser to turn this on.");
            return;
          }
          if (!subscription) {
            const registration = await navigator.serviceWorker.ready;
            if (!boundaryIsCurrent()) return;
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: applicationServerKey(browser.publicKey),
            });
            createdSubscription = true;
            if (!boundaryIsCurrent()) {
              await discardCreatedSubscription();
              return;
            }
          }
        }

        if (!boundaryIsCurrent()) {
          await discardCreatedSubscription();
          return;
        }
        if (!subscription) {
          setCategories([]);
          return;
        }

        const next = enabling
          ? [...categories, category]
          : categories.filter((value) => value !== category);
        if (next.length === 0) {
          const result = await unsubscribePushAction(subscription.endpoint);
          if (!boundaryIsCurrent()) return;
          if (!result.ok) {
            setError(result.error);
            return;
          }
          const browserUnsubscribed = await confirmBrowserPushUnsubscribe(subscription);
          if (!boundaryIsCurrent()) return;
          if (!browserUnsubscribed) {
            setError("Push notifications could not be updated. Try again.");
            return;
          }
          setBrowser((current) => ({ ...current, subscription: null }));
          setCategories([]);
          return;
        }

        const input = subscriptionInput(subscription, next);
        const result = await runTrackedPushSubscriptionWrite(() =>
          savePushSubscriptionAction(input),
        );
        if (!boundaryIsCurrent()) {
          await discardCreatedSubscription();
          return;
        }
        if (!result.ok) {
          setError(result.error);
          await discardCreatedSubscription();
          return;
        }
        const resumed = await resumeBrowserPushDelivery(boundaryIsCurrent);
        if (!boundaryIsCurrent()) return;
        if (!resumed) {
          setError("Push notifications are still paused on this browser. Reload and try again.");
          return;
        }
        setBrowser((current) => ({ ...current, subscription }));
        setCategories(result.categories);
      } catch {
        if (!boundaryIsCurrent()) {
          await discardCreatedSubscription();
          return;
        }
        setError("Push notifications could not be updated. Try again.");
      } finally {
        if (boundaryIsCurrent()) setPending(null);
      }
    },
    [browser, categories, pending],
  );

  // SK-276 — one tap turns on every category via the shared flow; the
  // per-topic switches below stay available for fine-tuning.
  const enableAll = useCallback(async () => {
    if (masterPending || pending !== null || !browser.configured || !browser.publicKey) {
      return;
    }
    setMasterPending(true);
    setError(null);
    try {
      const result = await enableAllPushCategories(browser.publicKey);
      if (result.ok) {
        setBrowser((current) => ({
          ...current,
          subscription: result.subscription as PushSubscription,
        }));
        setCategories(result.categories);
      } else if (result.reason !== "boundary") {
        setError(result.message);
      }
    } finally {
      setMasterPending(false);
    }
  }, [browser, masterPending, pending]);

  return (
    <section
      aria-labelledby="push-preferences-heading"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
    >
      <div className="flex gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-4">
        <BellRing
          className="mt-0.5 shrink-0 text-[rgb(var(--brand-primary))]"
          size={20}
          aria-hidden
        />
        <div>
          <h2
            id="push-preferences-heading"
            className="text-sm font-bold text-[rgb(var(--fg-default))]"
          >
            Device notifications
          </h2>
          <p className="mt-1 text-xs leading-5 text-[rgb(var(--fg-secondary))]">
            {role === "artist"
              ? "Real updates from your studio, on this device. Everything starts off."
              : "Choose real updates for this browser. Everything starts off."}
          </p>
        </div>
      </div>

      {installRequired ? (
        <div className="px-4 py-4">
          <p className="text-xs leading-5 text-[rgb(var(--fg-secondary))]">
            On iPhone, notifications need the installed app. Add Skitza to your Home Screen
            first, then turn updates on here.
          </p>
          <button
            type="button"
            onClick={() => {
              requestInstallGuidance();
            }}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 text-[12px] font-bold text-[rgb(var(--fg-default))] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
          >
            Show me how
          </button>
        </div>
      ) : null}

      {!installRequired && !loading && browser.configured && categories.length === 0 ? (
        <div className="border-b border-[rgb(var(--border-subtle))] px-4 py-4">
          <button
            type="button"
            disabled={
              masterPending ||
              pending !== null ||
              !pushAccountBoundaryAllowsDelivery(getPushAccountBoundaryGeneration())
            }
            onClick={() => {
              void enableAll();
            }}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[12px] font-bold text-[rgb(var(--bg-elevated))] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {masterPending ? "Turning on…" : "Turn on notifications"}
          </button>
          <p className="mt-2 text-[11px] leading-4 text-[rgb(var(--fg-muted))]">
            One tap turns on every update below. Fine-tune anytime.
          </p>
        </div>
      ) : null}

      {installRequired ? null : (
      <div className="divide-y divide-[rgb(var(--border-subtle))]">
        {PUSH_CATEGORIES.map((category) => {
          const copy = copyMap[category];
          const enabled = categories.includes(category);
          return (
            <div key={category} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${copy.label} push notifications`}
                disabled={
                  loading ||
                  pending !== null ||
                  !browser.configured ||
                  !pushAccountBoundaryAllowsDelivery(getPushAccountBoundaryGeneration())
                }
                onClick={() => {
                  void toggle(category);
                }}
                className="relative inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-[var(--radius-lg)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span
                  aria-hidden
                  className={`relative h-6 w-10 rounded-full transition-colors motion-reduce:transition-none ${
                    enabled ? "bg-[rgb(var(--brand-primary))]" : "bg-[rgb(var(--border-strong))]"
                  }`}
                >
                  <span
                    className={`absolute top-1 left-0 h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
                      enabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                  {copy.label}
                </p>
                <p className="text-[11px] leading-4 text-[rgb(var(--fg-muted))]">
                  {copy.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {error ? (
        <p
          role="status"
          className="border-t border-[rgb(var(--border-subtle))] px-4 py-3 text-xs text-[rgb(var(--status-danger))]"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
