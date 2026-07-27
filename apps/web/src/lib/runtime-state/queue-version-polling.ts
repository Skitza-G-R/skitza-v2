export type QueueVersionChecker = Readonly<{
  check: () => Promise<void>;
  setCurrentVersion: (version: string) => void;
  stop: () => void;
}>;

export const QUEUE_VERSION_REFRESH_RETRY_MS = 15_000;

export function createVisibleQueueVersionCheck(input: {
  check: () => Promise<void>;
  isVisible: () => boolean;
  onlyWhenVisible: boolean;
}): () => void {
  return () => {
    if (input.onlyWhenVisible && !input.isVisible()) return;
    void input.check();
  };
}

export function listenForQueueVersionActivity(input: {
  check: () => void;
  documentTarget: EventTarget;
  refreshOnFocus: boolean;
  refreshOnOnline: boolean;
  refreshOnPageShow: boolean;
  refreshOnVisibilityChange: boolean;
  windowTarget: EventTarget;
}): () => void {
  const subscriptions: Array<readonly [EventTarget, string]> = [];

  if (input.refreshOnVisibilityChange) {
    subscriptions.push([input.documentTarget, "visibilitychange"]);
  }
  if (input.refreshOnFocus) subscriptions.push([input.windowTarget, "focus"]);
  if (input.refreshOnPageShow) subscriptions.push([input.windowTarget, "pageshow"]);
  if (input.refreshOnOnline) subscriptions.push([input.windowTarget, "online"]);

  const listener: EventListener = () => {
    input.check();
  };
  for (const [target, type] of subscriptions) target.addEventListener(type, listener);

  return () => {
    for (const [target, type] of subscriptions) target.removeEventListener(type, listener);
  };
}

/**
 * Serializes queue checks and keeps a changed revision pending until a new
 * server render acknowledges it. A failed router refresh is retried after a
 * cooldown without letting focus/interval races refresh in parallel.
 */
export function createQueueVersionChecker(input: {
  initialVersion: string;
  loadVersion: () => Promise<string | null>;
  onVersionChanged: () => void;
  retryAfterMs?: number;
  now?: () => number;
}): QueueVersionChecker {
  const retryAfterMs = input.retryAfterMs ?? QUEUE_VERSION_REFRESH_RETRY_MS;
  const now = input.now ?? Date.now;
  let acknowledgedVersion = input.initialVersion;
  let pendingVersion: string | null = null;
  let lastNotificationAt = Number.NEGATIVE_INFINITY;
  let generation = 0;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const check = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;

    const checkGeneration = generation;
    const task = (async () => {
      try {
        const nextVersion = await input.loadVersion();
        if (checkGeneration !== generation || !nextVersion) return;
        if (nextVersion === acknowledgedVersion) {
          pendingVersion = null;
          return;
        }

        const checkedAt = now();
        if (pendingVersion === nextVersion && checkedAt - lastNotificationAt < retryAfterMs) {
          return;
        }
        pendingVersion = nextVersion;
        lastNotificationAt = checkedAt;
        input.onVersionChanged();
      } catch {
        // Polling is best-effort. The currently rendered server state remains
        // usable and the next interval/focus event will try again.
      }
    })();
    inFlight = task;
    void task.finally(() => {
      if (inFlight === task) inFlight = null;
    });
    return task;
  };

  return {
    check,
    setCurrentVersion(version) {
      generation += 1;
      acknowledgedVersion = version;
      pendingVersion = null;
    },
    stop() {
      stopped = true;
      generation += 1;
    },
  };
}
