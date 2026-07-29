export const PUSH_SUBSCRIPTION_CLEARED_EVENT = "skitza:push-subscription-cleared";
export const PUSH_ACCOUNT_BOUNDARY_EVENT = "skitza:push-account-boundary";
export const PUSH_DELIVERY_CONTROL_CACHE = "skitza-push-control-v1";
export const PUSH_DELIVERY_SUPPRESSED_URL = "/pwa/push-delivery-suppressed";
export const PUSH_DELIVERY_BOUNDARY_NONCE_HEADER =
  "x-skitza-push-boundary-nonce";
export const SKITZA_NOTIFICATION_TAG_PREFIX = "skitza-";

const ACCOUNT_EXIT_ACTIVATION = "SKITZA_ACTIVATE_FOR_ACCOUNT_EXIT";
const ACCOUNT_EXIT_ACTIVATION_RESULT =
  "SKITZA_ACCOUNT_EXIT_ACTIVATION_RESULT";
const PUSH_SUPPRESSION_CAPABILITY_QUERY = "SKITZA_PUSH_SUPPRESSION_CAPABILITY";
const PUSH_SUPPRESSION_CAPABILITY_RESULT = "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT";
const PUSH_SUPPRESSION_FLUSH = "SKITZA_PUSH_SUPPRESSION_FLUSH";
const PUSH_SUPPRESSION_FLUSH_RESULT = "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT";
const PUSH_SUPPRESSION_CAPABILITY_TIMEOUT_MS = 750;
const PUSH_ACCOUNT_EXIT_HANDOFF_TIMEOUT_MS = 10_000;

type WorkerSuppressionCapability = Readonly<{
  mode: "none" | "marker" | "flush";
  version: string | null;
}>;

type ExitPushSubscription = Readonly<{
  endpoint: string;
  unsubscribe(): Promise<boolean>;
}>;

const PUSH_NOT_AVAILABLE = Symbol("push-not-available");
type PushSubscriptionLookup =
  | ExitPushSubscription
  | null
  | typeof PUSH_NOT_AVAILABLE;

type BrowserPushAdapter = Readonly<{
  getSubscription(): Promise<PushSubscriptionLookup>;
  suppressDelivery(): Promise<boolean>;
  closeDisplayedNotifications(): Promise<boolean>;
  notifyBoundary(): void;
  notifyCleared(): void;
}>;

type OwnedPushRemovalResult =
  | Readonly<{ ok: true; removed: boolean }>
  | Readonly<{ ok: false; error: string }>;

export type OwnedPushRemoval = (endpoint: string) => Promise<OwnedPushRemovalResult>;
export type PushBoundaryConfirmation = "no-subscription" | "browser-unsubscribed";

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

export async function confirmBrowserPushUnsubscribe(
  subscription: Readonly<{ unsubscribe(): Promise<boolean> }>,
): Promise<boolean> {
  try {
    const unsubscribed = await subscription.unsubscribe();
    return unsubscribed;
  } catch {
    return false;
  }
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

function createPushBoundaryNonce(): string | null {
  if (typeof globalThis.crypto === "undefined") return null;

  try {
    if (typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return null;
  }
}

async function markerMatchesNonce(
  cache: Cache,
  nonce: string,
): Promise<boolean> {
  const marker = await cache.match(PUSH_DELIVERY_SUPPRESSED_URL);
  return marker?.headers.get(PUSH_DELIVERY_BOUNDARY_NONCE_HEADER) === nonce;
}

function queryWorker(
  worker: Pick<ServiceWorker, "postMessage">,
  message: Readonly<Record<string, unknown>>,
  timeoutMs: number,
): Promise<Readonly<Record<string, unknown>> | null> {
  if (typeof MessageChannel === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (data: Readonly<Record<string, unknown>> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      channel.port1.close();
      resolve(data);
    };
    const timeout = setTimeout(() => {
      finish(null);
    }, timeoutMs);

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data =
        typeof event.data === "object" && event.data !== null
          ? (event.data as Record<string, unknown>)
          : null;
      finish(data);
    };
    channel.port1.onmessageerror = () => {
      finish(null);
    };
    channel.port1.start();

    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function readWorkerPushSuppressionCapability(
  worker: Pick<ServiceWorker, "postMessage">,
  timeoutMs: number,
): Promise<WorkerSuppressionCapability> {
  const data = await queryWorker(
    worker,
    { type: PUSH_SUPPRESSION_CAPABILITY_QUERY },
    timeoutMs,
  );
  if (
    data?.type !== PUSH_SUPPRESSION_CAPABILITY_RESULT ||
    data.supported !== true
  ) {
    return { mode: "none", version: null };
  }
  return {
    mode: data.flushSupported === true ? "flush" : "marker",
    version: typeof data.version === "string" ? data.version : null,
  };
}

async function flushActiveWorkerPushNotifications(
  worker: Pick<ServiceWorker, "postMessage">,
  timeoutMs: number,
  expectedVersion: string,
  nonce: string,
): Promise<boolean> {
  const data = await queryWorker(
    worker,
    {
      type: PUSH_SUPPRESSION_FLUSH,
      version: expectedVersion,
      nonce,
    },
    timeoutMs,
  );
  return (
    data?.type === PUSH_SUPPRESSION_FLUSH_RESULT &&
    data.flushed === true &&
    data.version === expectedVersion &&
    data.nonce === nonce
  );
}

async function requestAccountExitActivation(
  worker: Pick<ServiceWorker, "postMessage">,
  version: string,
  nonce: string,
  timeoutMs: number,
): Promise<boolean> {
  const data = await queryWorker(
    worker,
    {
      type: ACCOUNT_EXIT_ACTIVATION,
      accountExitStarted: true,
      version,
      nonce,
    },
    timeoutMs,
  );
  return (
    data?.type === ACCOUNT_EXIT_ACTIVATION_RESULT &&
    data.activated === true &&
    data.version === version &&
    data.nonce === nonce
  );
}

function waitForWorkerHandoff(
  registration: ServiceWorkerRegistration,
  previousActive: ServiceWorker,
  nextActive: ServiceWorker,
  timeoutMs: number,
): Promise<boolean> {
  const serviceWorkers = navigator.serviceWorker;
  const handoffCompleted = () =>
    previousActive.state === "redundant" &&
    nextActive.state === "activated" &&
    registration.active === nextActive;

  if (handoffCompleted()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      previousActive.removeEventListener("statechange", check);
      nextActive.removeEventListener("statechange", check);
      serviceWorkers.removeEventListener("controllerchange", check);
      resolve(completed);
    };
    const check = () => {
      if (handoffCompleted()) {
        finish(true);
        return;
      }
      if (nextActive.state === "redundant") finish(false);
    };
    const timeout = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    previousActive.addEventListener("statechange", check);
    nextActive.addEventListener("statechange", check);
    serviceWorkers.addEventListener("controllerchange", check);
    check();
  });
}

export function suppressBrowserPushDelivery(
  capabilityTimeoutMs = PUSH_SUPPRESSION_CAPABILITY_TIMEOUT_MS,
  handoffTimeoutMs = PUSH_ACCOUNT_EXIT_HANDOFF_TIMEOUT_MS,
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
      const active = registration?.active;
      if (!registration || !active) return false;

      const activeCapability = await readWorkerPushSuppressionCapability(
        active,
        capabilityTimeoutMs,
      );

      const waiting = registration.waiting;
      const waitingCapability =
        activeCapability.mode !== "flush" && waiting
          ? await readWorkerPushSuppressionCapability(
              waiting,
              capabilityTimeoutMs,
            )
          : null;
      if (
        activeCapability.mode !== "flush" &&
        (!waiting ||
          waitingCapability?.mode !== "flush" ||
          waitingCapability.version === null)
      ) {
        return false;
      }
      if (
        registration.active !== active ||
        (activeCapability.mode !== "flush" &&
          registration.waiting !== waiting)
      ) {
        return false;
      }

      const nonce = createPushBoundaryNonce();
      if (nonce === null) return false;

      const cache = await caches.open(PUSH_DELIVERY_CONTROL_CACHE);
      await cache.put(
        PUSH_DELIVERY_SUPPRESSED_URL,
        new Response(null, {
          status: 204,
          headers: {
            "cache-control": "no-store",
            [PUSH_DELIVERY_BOUNDARY_NONCE_HEADER]: nonce,
          },
        }),
      );
      if (!(await markerMatchesNonce(cache, nonce))) return false;

      if (activeCapability.mode === "flush") {
        if (
          activeCapability.version === null ||
          active.state !== "activated" ||
          registration.active !== active
        ) {
          return false;
        }
        const flushed = await flushActiveWorkerPushNotifications(
          active,
          capabilityTimeoutMs,
          activeCapability.version,
          nonce,
        );
        return flushed && (await markerMatchesNonce(cache, nonce));
      }

      if (
        !waiting ||
        waitingCapability?.mode !== "flush" ||
        waitingCapability.version === null
      ) {
        return false;
      }
      const activationAccepted = await requestAccountExitActivation(
        waiting,
        waitingCapability.version,
        nonce,
        handoffTimeoutMs,
      );
      if (!activationAccepted) return false;

      const handedOff = await waitForWorkerHandoff(
        registration,
        active,
        waiting,
        handoffTimeoutMs,
      );
      if (!handedOff) return false;

      const currentRegistration =
        await navigator.serviceWorker.getRegistration();
      if (
        currentRegistration?.active !== waiting ||
        waiting.state !== "activated" ||
        active.state !== "redundant"
      ) {
        return false;
      }
      const activatedCapability =
        await readWorkerPushSuppressionCapability(
          waiting,
          capabilityTimeoutMs,
        );
      if (
        activatedCapability.mode !== "flush" ||
        activatedCapability.version !== waitingCapability.version
      ) {
        return false;
      }

      const flushed = await flushActiveWorkerPushNotifications(
        waiting,
        capabilityTimeoutMs,
        waitingCapability.version,
        nonce,
      );
      return flushed && (await markerMatchesNonce(cache, nonce));
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

export async function closeDisplayedSkitzaNotifications(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof navigator.serviceWorker.getRegistration !== "function"
  ) {
    return true;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return true;
    if (typeof registration.getNotifications !== "function") return false;

    const displayed = await registration.getNotifications();
    for (const notification of displayed) {
      if (notification.tag.startsWith(SKITZA_NOTIFICATION_TAG_PREFIX)) {
        notification.close();
      }
    }

    const remaining = await registration.getNotifications();
    return !remaining.some((notification) =>
      notification.tag.startsWith(SKITZA_NOTIFICATION_TAG_PREFIX),
    );
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
        return PUSH_NOT_AVAILABLE;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !("pushManager" in registration)) {
        return PUSH_NOT_AVAILABLE;
      }
      return registration.pushManager.getSubscription();
    },
    suppressDelivery: suppressBrowserPushDelivery,
    closeDisplayedNotifications: closeDisplayedSkitzaNotifications,
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
 * the server can delete the exact owned row as cleanup. Only confirmed browser
 * invalidation can advance an existing subscription boundary: another tab can
 * recreate a deleted row or clear a shared service-worker suppression marker.
 * An absent browser subscription is already safe. Every other path fails
 * closed so explicit sign-out is blocked and account-switch handling can hide
 * private state and sign the new account out.
 */
export async function clearBrowserPushSubscription(
  removeOwned: OwnedPushRemoval | null,
  adapter: BrowserPushAdapter = browserAdapter(),
): Promise<PushBoundaryConfirmation> {
  const boundaryGeneration = beginPushAccountBoundary();
  adapter.notifyBoundary();
  const complete = (
    result: PushBoundaryConfirmation,
  ): PushBoundaryConfirmation => {
    completePushAccountBoundary(boundaryGeneration);
    adapter.notifyCleared();
    return result;
  };
  const confirm = async (
    result: PushBoundaryConfirmation,
  ): Promise<PushBoundaryConfirmation> => {
    const deliverySuppressed = await adapter.suppressDelivery().catch(() => false);
    if (!deliverySuppressed) throw new PushAccountBoundaryError();
    const notificationsCleared = await adapter.closeDisplayedNotifications().catch(() => false);
    if (!notificationsCleared) throw new PushAccountBoundaryError();
    return complete(result);
  };

  if (removeOwned) {
    // A subscribe action that started before this synchronous boundary marker
    // may still commit in this tab. Drain it first so authenticated cleanup
    // follows this tab's pending write; another tab can still write later.
    await waitForInFlightPushSubscriptionWrites();
  }

  let subscription: PushSubscriptionLookup;
  try {
    subscription = await adapter.getSubscription();
  } catch {
    if (removeOwned === null) await adapter.suppressDelivery().catch(() => false);
    throw new PushAccountBoundaryError();
  }
  if (subscription === PUSH_NOT_AVAILABLE) {
    // Regular iPhone Safari and other non-push contexts cannot own or display
    // a subscription for this service-worker registration. There is no push
    // delivery to fence, so requiring notification-only APIs would make
    // ordinary account sign-out impossible.
    return complete("no-subscription");
  }
  if (!subscription) {
    return confirm("no-subscription");
  }

  const browserUnsubscribe = confirmBrowserPushUnsubscribe(subscription);
  const serverCleanup = removeOwned
    ? Promise.resolve()
        .then(() => removeOwned(subscription.endpoint))
        .then(() => undefined)
        .catch(() => undefined)
    : Promise.resolve();
  const [browserUnsubscribed] = await Promise.all([
    browserUnsubscribe,
    serverCleanup,
  ]);

  if (browserUnsubscribed) {
    return confirm("browser-unsubscribed");
  }

  if (removeOwned === null) await adapter.suppressDelivery().catch(() => false);

  throw new PushAccountBoundaryError();
}
