export const PUSH_SUBSCRIPTION_CLEARED_EVENT = "skitza:push-subscription-cleared";
export const PUSH_DELIVERY_CONTROL_CACHE = "skitza-push-control-v1";
export const PUSH_DELIVERY_SUPPRESSED_URL = "/pwa/push-delivery-suppressed";

type ExitPushSubscription = Readonly<{
  endpoint: string;
  unsubscribe(): Promise<boolean>;
}>;

type BrowserPushAdapter = Readonly<{
  getSubscription(): Promise<ExitPushSubscription | null>;
  suppressDelivery(): Promise<boolean>;
  notifyCleared(): void;
}>;

type OwnedPushRemovalResult = Readonly<{ ok: boolean }>;

export type OwnedPushRemoval = (endpoint: string) => Promise<OwnedPushRemovalResult>;
export type PushBoundaryConfirmation =
  | "no-subscription"
  | "browser-unsubscribed"
  | "server-removed"
  | "delivery-suppressed";

export class PushAccountBoundaryError extends Error {
  constructor() {
    super("Browser notification ownership could not be safely separated.");
    this.name = "PushAccountBoundaryError";
  }
}

async function suppressBrowserPushDelivery(): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(PUSH_DELIVERY_CONTROL_CACHE);
    await cache.put(
      PUSH_DELIVERY_SUPPRESSED_URL,
      new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      }),
    );
    return Boolean(await cache.match(PUSH_DELIVERY_SUPPRESSED_URL));
  } catch {
    return false;
  }
}

export async function resumeBrowserPushDelivery(): Promise<boolean> {
  if (typeof caches === "undefined") return true;
  try {
    const cache = await caches.open(PUSH_DELIVERY_CONTROL_CACHE);
    await cache.delete(PUSH_DELIVERY_SUPPRESSED_URL);
    return (await cache.match(PUSH_DELIVERY_SUPPRESSED_URL)) === undefined;
  } catch {
    return false;
  }
}

function browserAdapter(): BrowserPushAdapter {
  return {
    async getSubscription() {
      if (
        typeof navigator === "undefined" ||
        !("serviceWorker" in navigator) ||
        typeof navigator.serviceWorker.getRegistration !== "function"
      ) {
        return null;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !("pushManager" in registration)) return null;
      return registration.pushManager.getSubscription();
    },
    suppressDelivery: suppressBrowserPushDelivery,
    notifyCleared() {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(PUSH_SUBSCRIPTION_CLEARED_EVENT));
      }
    },
  };
}

/**
 * Removes this origin's browser subscription during an account boundary.
 *
 * Explicit sign-out passes `removeOwned` while Clerk auth is still live, so
 * the server can delete the exact owned row. It advances only after server
 * deletion or browser invalidation is confirmed. An already-completed
 * identity switch omits server deletion: local unsubscribe must succeed, or
 * a durable service-worker suppression marker must be confirmed before the
 * new account can use app-level push/upload state. Fail-closed server
 * ownership still prevents the new account from claiming the old endpoint.
 */
export async function clearBrowserPushSubscription(
  removeOwned: OwnedPushRemoval | null,
  adapter: BrowserPushAdapter = browserAdapter(),
): Promise<PushBoundaryConfirmation> {
  let subscription: ExitPushSubscription | null;
  try {
    subscription = await adapter.getSubscription();
  } catch {
    if (removeOwned === null && (await adapter.suppressDelivery().catch(() => false))) {
      adapter.notifyCleared();
      return "delivery-suppressed";
    }
    throw new PushAccountBoundaryError();
  }
  if (!subscription) {
    adapter.notifyCleared();
    return "no-subscription";
  }

  const browserUnsubscribe = Promise.resolve()
    .then(() => subscription.unsubscribe())
    .then((unsubscribed) => unsubscribed)
    .catch(() => false);
  const serverRemoval = removeOwned
    ? Promise.resolve()
        .then(() => removeOwned(subscription.endpoint))
        .then((result) => result.ok)
        .catch(() => false)
    : Promise.resolve(false);
  const [browserUnsubscribed, serverRemoved] = await Promise.all([
    browserUnsubscribe,
    serverRemoval,
  ]);

  if (browserUnsubscribed || serverRemoved) {
    adapter.notifyCleared();
    return browserUnsubscribed ? "browser-unsubscribed" : "server-removed";
  }

  if (removeOwned === null && (await adapter.suppressDelivery().catch(() => false))) {
    adapter.notifyCleared();
    return "delivery-suppressed";
  }

  throw new PushAccountBoundaryError();
}
