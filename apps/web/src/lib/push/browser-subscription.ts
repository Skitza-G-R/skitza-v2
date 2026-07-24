export const PUSH_SUBSCRIPTION_CLEARED_EVENT = "skitza:push-subscription-cleared";

type ExitPushSubscription = Readonly<{
  endpoint: string;
  unsubscribe(): Promise<boolean>;
}>;

type BrowserPushAdapter = Readonly<{
  getSubscription(): Promise<ExitPushSubscription | null>;
  notifyCleared(): void;
}>;

export type OwnedPushRemoval = (endpoint: string) => Promise<unknown>;

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
 * the server can delete the exact owned row. An already-completed identity
 * switch omits it: local unsubscribe still invalidates the prior endpoint,
 * while fail-closed server ownership prevents the new account from claiming
 * the old row.
 */
export async function clearBrowserPushSubscription(
  removeOwned: OwnedPushRemoval | null,
  adapter: BrowserPushAdapter = browserAdapter(),
): Promise<void> {
  let subscription: ExitPushSubscription | null;
  try {
    subscription = await adapter.getSubscription();
  } catch {
    return;
  }
  if (!subscription) return;

  const work: Promise<unknown>[] = [
    Promise.resolve()
      .then(() => subscription.unsubscribe())
      .catch(() => false),
  ];
  if (removeOwned) {
    work.push(
      Promise.resolve()
        .then(() => removeOwned(subscription.endpoint))
        .catch(() => undefined),
    );
  }
  await Promise.all(work);
  adapter.notifyCleared();
}
