// SK-276 — the one-tap "Turn on notifications" flow shared by the settings
// card's master button and the smart-moment banners. Runs the exact
// subscribe-and-save path the per-topic toggle uses, but saves every category
// at once, with the same account-boundary guards and created-subscription
// rollback. The browser pieces are behind an adapter so the flow is testable.

import { savePushSubscriptionAction } from "~/app/push-actions";
import { PUSH_CATEGORIES, type PushCategory } from "~/lib/push/categories";
import {
  getPushAccountBoundaryGeneration,
  pushAccountBoundaryAllowsDelivery,
  resumeBrowserPushDelivery,
  runTrackedPushSubscriptionWrite,
} from "~/lib/push/browser-subscription";

export const PUSH_PERMISSION_MESSAGE = "Allow notifications in your browser to turn this on.";
export const PUSH_PAUSED_MESSAGE =
  "Push notifications are still paused on this browser. Reload and try again.";
export const PUSH_GENERIC_MESSAGE = "Push notifications could not be updated. Try again.";

export type BrowserPushSubscriptionLike = Readonly<{
  endpoint: string;
  expirationTime: number | null;
  toJSON(): { keys?: { p256dh?: string; auth?: string } };
  unsubscribe(): Promise<boolean>;
}>;

export type PushSubscriptionInput = Readonly<{
  endpoint: string;
  p256dh: string;
  auth: string;
  categories: PushCategory[];
  expirationTime: number | null;
}>;

export type EnableAllAdapter = Readonly<{
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  subscription(): Promise<BrowserPushSubscriptionLike | null>;
  subscribe(publicKey: string): Promise<BrowserPushSubscriptionLike>;
  save(
    input: PushSubscriptionInput,
  ): Promise<{ ok: true; categories: PushCategory[] } | { ok: false; error: string }>;
  resume(deliveryStillAllowed: () => boolean): Promise<boolean>;
  boundaryGeneration(): number;
  boundaryAllows(generation: number): boolean;
}>;

export type EnableAllResult =
  | { ok: true; categories: PushCategory[]; subscription: BrowserPushSubscriptionLike }
  | { ok: false; reason: "permission" | "boundary" | "error"; message: string };

export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const bytes = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const output = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let index = 0; index < bytes.length; index += 1) {
    output[index] = bytes.charCodeAt(index);
  }
  return output;
}

export function subscriptionInput(
  subscription: Pick<BrowserPushSubscriptionLike, "endpoint" | "expirationTime" | "toJSON">,
  categories: PushCategory[],
): PushSubscriptionInput {
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

function browserAdapter(): EnableAllAdapter {
  return {
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    async subscription() {
      const registration = await navigator.serviceWorker.ready;
      return registration.pushManager.getSubscription();
    },
    async subscribe(publicKey) {
      const registration = await navigator.serviceWorker.ready;
      return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
    },
    save: (input) =>
      runTrackedPushSubscriptionWrite(() => savePushSubscriptionAction({ ...input })),
    resume: (deliveryStillAllowed) => resumeBrowserPushDelivery(deliveryStillAllowed),
    boundaryGeneration: getPushAccountBoundaryGeneration,
    boundaryAllows: pushAccountBoundaryAllowsDelivery,
  };
}

export async function enableAllPushCategories(
  publicKey: string,
  adapter: EnableAllAdapter = browserAdapter(),
): Promise<EnableAllResult> {
  const generation = adapter.boundaryGeneration();
  const boundaryIsCurrent = () => adapter.boundaryAllows(generation);
  const boundary: EnableAllResult = {
    ok: false,
    reason: "boundary",
    message: PUSH_GENERIC_MESSAGE,
  };

  let subscription: BrowserPushSubscriptionLike | null = null;
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
    let permission = adapter.permission();
    if (permission === "default") {
      permission = await adapter.requestPermission();
    }
    if (!boundaryIsCurrent()) return boundary;
    if (permission !== "granted") {
      return { ok: false, reason: "permission", message: PUSH_PERMISSION_MESSAGE };
    }

    subscription = await adapter.subscription();
    if (!boundaryIsCurrent()) return boundary;
    if (!subscription) {
      subscription = await adapter.subscribe(publicKey);
      createdSubscription = true;
      if (!boundaryIsCurrent()) {
        await discardCreatedSubscription();
        return boundary;
      }
    }

    const result = await adapter.save(subscriptionInput(subscription, [...PUSH_CATEGORIES]));
    if (!boundaryIsCurrent()) {
      await discardCreatedSubscription();
      return boundary;
    }
    if (!result.ok) {
      await discardCreatedSubscription();
      return { ok: false, reason: "error", message: result.error };
    }

    const resumed = await adapter.resume(boundaryIsCurrent);
    if (!boundaryIsCurrent()) return boundary;
    if (!resumed) {
      return { ok: false, reason: "error", message: PUSH_PAUSED_MESSAGE };
    }

    return { ok: true, categories: [...result.categories], subscription };
  } catch {
    if (boundaryIsCurrent()) {
      await discardCreatedSubscription();
      return { ok: false, reason: "error", message: PUSH_GENERIC_MESSAGE };
    }
    await discardCreatedSubscription();
    return boundary;
  }
}
