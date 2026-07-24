export const PUSH_SUBSCRIPTION_CLEARED_EVENT = "skitza:push-subscription-cleared";
export const PUSH_ACCOUNT_BOUNDARY_EVENT = "skitza:push-account-boundary";
export const PUSH_DELIVERY_CONTROL_CACHE = "skitza-push-control-v1";
export const PUSH_DELIVERY_SUPPRESSED_URL = "/pwa/push-delivery-suppressed";

const PUSH_SUPPRESSION_CAPABILITY_QUERY = "SKITZA_PUSH_SUPPRESSION_CAPABILITY";
const PUSH_SUPPRESSION_CAPABILITY_RESULT = "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT";
const PUSH_SUPPRESSION_CAPABILITY_TIMEOUT_MS = 750;

type ExitPushSubscription = Readonly<{
  endpoint: string;
  unsubscribe(): Promise<boolean>;
}>;

type BrowserPushAdapter = Readonly<{
  getSubscription(): Promise<ExitPushSubscription | null>;
  suppressDelivery(): Promise<boolean>;
  notifyBoundary(): void;
  notifyCleared(): void;
}>;

type OwnedPushRemovalResult =
  | Readonly<{ ok: true; removed: boolean }>
  | Readonly<{ ok: false; error: string }>;

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

let pushAccountBoundaryGeneration = 0;
let activePushAccountBoundary: number | null = null;
let pushControlWork: Promise<void> = Promise.resolve();
const inFlightPushSubscriptionWrites = new Set<Promise<unknown>>();

function beginPushAccountBoundary(): number {
  pushAccountBoundaryGeneration += 1;
  activePushAccountBoundary = pushAccountBoundaryGeneration;
  return pushAccountBoundaryGeneration;
}

function completePushAccountBoundary(generation: number): void {
  if (activePushAccountBoundary === generation) {
    activePushAccountBoundary = null;
  }
}

export function getPushAccountBoundaryGeneration(): number {
  return pushAccountBoundaryGeneration;
}

export function pushAccountBoundaryAllowsDelivery(generation: number): boolean {
  return generation === pushAccountBoundaryGeneration && activePushAccountBoundary === null;
}

export function runTrackedPushSubscriptionWrite<T>(write: () => Promise<T>): Promise<T> {
  const operation = write();
  const tracked = operation.finally(() => {
    inFlightPushSubscriptionWrites.delete(tracked);
  });
  inFlightPushSubscriptionWrites.add(tracked);
  return tracked;
}

async function waitForInFlightPushSubscriptionWrites(): Promise<void> {
  while (inFlightPushSubscriptionWrites.size > 0) {
    await Promise.allSettled([...inFlightPushSubscriptionWrites]);
  }
}

function runPushControlWork<T>(work: () => Promise<T>): Promise<T> {
  const result = pushControlWork.then(work, work);
  pushControlWork = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function activeWorkerSupportsPushSuppression(
  worker: Pick<ServiceWorker, "postMessage">,
  timeoutMs: number,
): Promise<boolean> {
  if (typeof MessageChannel === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (supported: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      channel.port1.close();
      resolve(supported);
    };
    const timeout = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data =
        typeof event.data === "object" && event.data !== null
          ? (event.data as Record<string, unknown>)
          : null;
      finish(data?.type === PUSH_SUPPRESSION_CAPABILITY_RESULT && data.supported === true);
    };
    channel.port1.onmessageerror = () => {
      finish(false);
    };
    channel.port1.start();

    try {
      worker.postMessage({ type: PUSH_SUPPRESSION_CAPABILITY_QUERY }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

export function suppressBrowserPushDelivery(
  capabilityTimeoutMs = PUSH_SUPPRESSION_CAPABILITY_TIMEOUT_MS,
): Promise<boolean> {
  return runPushControlWork(async () => {
    if (
      typeof caches === "undefined" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      typeof navigator.serviceWorker.getRegistration !== "function"
    ) {
      return false;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (
        !registration?.active ||
        !(await activeWorkerSupportsPushSuppression(registration.active, capabilityTimeoutMs))
      ) {
        return false;
      }
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
  });
}

export function resumeBrowserPushDelivery(
  deliveryStillAllowed: () => boolean = () => true,
): Promise<boolean> {
  return runPushControlWork(async () => {
    if (!deliveryStillAllowed()) return false;
    if (typeof caches === "undefined") return true;
    try {
      const cache = await caches.open(PUSH_DELIVERY_CONTROL_CACHE);
      if (!deliveryStillAllowed()) return false;
      await cache.delete(PUSH_DELIVERY_SUPPRESSED_URL);
      if (!deliveryStillAllowed()) return false;
      return (await cache.match(PUSH_DELIVERY_SUPPRESSED_URL)) === undefined;
    } catch {
      return false;
    }
  });
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
    notifyBoundary() {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(PUSH_ACCOUNT_BOUNDARY_EVENT));
      }
    },
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
  const boundaryGeneration = beginPushAccountBoundary();
  adapter.notifyBoundary();
  const confirm = (result: PushBoundaryConfirmation): PushBoundaryConfirmation => {
    completePushAccountBoundary(boundaryGeneration);
    adapter.notifyCleared();
    return result;
  };

  if (removeOwned) {
    // A subscribe action that started before this synchronous boundary marker
    // may still commit. Drain it first so the authenticated delete is the last
    // server write for this endpoint.
    await waitForInFlightPushSubscriptionWrites();
  }

  let subscription: ExitPushSubscription | null;
  try {
    subscription = await adapter.getSubscription();
  } catch {
    if (removeOwned === null && (await adapter.suppressDelivery().catch(() => false))) {
      return confirm("delivery-suppressed");
    }
    throw new PushAccountBoundaryError();
  }
  if (!subscription) {
    return confirm("no-subscription");
  }

  const browserUnsubscribe = Promise.resolve()
    .then(() => subscription.unsubscribe())
    .then((unsubscribed) => unsubscribed)
    .catch(() => false);
  const serverRemoval = removeOwned
    ? Promise.resolve()
        .then(() => removeOwned(subscription.endpoint))
        .then((result) => result.ok && result.removed)
        .catch(() => false)
    : Promise.resolve(false);
  const [browserUnsubscribed, serverRemoved] = await Promise.all([
    browserUnsubscribe,
    serverRemoval,
  ]);

  if (browserUnsubscribed || serverRemoved) {
    return confirm(browserUnsubscribed ? "browser-unsubscribed" : "server-removed");
  }

  if (removeOwned === null && (await adapter.suppressDelivery().catch(() => false))) {
    return confirm("delivery-suppressed");
  }

  throw new PushAccountBoundaryError();
}
