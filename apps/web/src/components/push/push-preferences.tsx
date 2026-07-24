"use client";

import { BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  getPushStatusAction,
  savePushSubscriptionAction,
  unsubscribePushAction,
} from "~/app/push-actions";
import { PUSH_CATEGORIES, PUSH_CATEGORY_COPY, type PushCategory } from "~/lib/push/categories";
import { PUSH_SUBSCRIPTION_CLEARED_EVENT } from "~/lib/push/browser-subscription";

type BrowserState = Readonly<{
  configured: boolean;
  publicKey: string | null;
  subscription: PushSubscription | null;
}>;

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const bytes = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const output = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let index = 0; index < bytes.length; index += 1) {
    output[index] = bytes.charCodeAt(index);
  }
  return output;
}

function subscriptionInput(subscription: PushSubscription, categories: PushCategory[]) {
  const serialized = subscription.toJSON();
  const p256dh = serialized.keys?.p256dh;
  const auth = serialized.keys?.auth;
  if (!p256dh || !auth) throw new Error("Subscription keys unavailable");
  return {
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    categories,
    expirationTime: subscription.expirationTime,
  };
}

export function PushPreferences() {
  const [browser, setBrowser] = useState<BrowserState>({
    configured: false,
    publicKey: null,
    subscription: null,
  });
  const [categories, setCategories] = useState<PushCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PushCategory | null>(null);
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
          setError("Push notifications are not supported in this browser.");
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
    const onSubscriptionCleared = () => {
      loadVersion += 1;
      setBrowser((current) => ({ ...current, subscription: null }));
      setCategories([]);
      setError(null);
      setLoading(true);
      void load();
    };
    window.addEventListener(PUSH_SUBSCRIPTION_CLEARED_EVENT, onSubscriptionCleared);
    void load();
    return () => {
      cancelled = true;
      window.removeEventListener(PUSH_SUBSCRIPTION_CLEARED_EVENT, onSubscriptionCleared);
    };
  }, []);

  const toggle = useCallback(
    async (category: PushCategory) => {
      if (pending || !browser.configured || !browser.publicKey) return;
      setPending(category);
      setError(null);
      const enabling = !categories.includes(category);
      let subscription = browser.subscription;

      try {
        if (enabling) {
          let permission = Notification.permission;
          if (permission === "default") {
            // The browser prompt is reached only from this deliberate click
            // on a real notification category—never during mount/first launch.
            permission = await Notification.requestPermission();
          }
          if (permission !== "granted") {
            setError("Allow notifications in your browser to turn this on.");
            return;
          }
          if (!subscription) {
            const registration = await navigator.serviceWorker.ready;
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: applicationServerKey(browser.publicKey),
            });
          }
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
          if (!result.ok) {
            setError(result.error);
            return;
          }
          await subscription.unsubscribe();
          setBrowser((current) => ({ ...current, subscription: null }));
          setCategories([]);
          return;
        }

        const result = await savePushSubscriptionAction(subscriptionInput(subscription, next));
        if (!result.ok) {
          setError(result.error);
          if (!browser.subscription && enabling) {
            await subscription.unsubscribe();
          }
          return;
        }
        setBrowser((current) => ({ ...current, subscription }));
        setCategories(result.categories);
      } catch {
        setError("Push notifications could not be updated. Try again.");
      } finally {
        setPending(null);
      }
    },
    [browser, categories, pending],
  );

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
            Choose real updates for this browser. Everything starts off.
          </p>
        </div>
      </div>

      <div className="divide-y divide-[rgb(var(--border-subtle))]">
        {PUSH_CATEGORIES.map((category) => {
          const copy = PUSH_CATEGORY_COPY[category];
          const enabled = categories.includes(category);
          return (
            <div key={category} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                  {copy.label}
                </p>
                <p className="text-[11px] leading-4 text-[rgb(var(--fg-muted))]">
                  {copy.description}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${copy.label} push notifications`}
                disabled={loading || pending !== null || !browser.configured}
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
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
                      enabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </span>
              </button>
            </div>
          );
        })}
      </div>

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
