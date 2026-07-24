"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  createWaitingWorkerMarker,
  isProtectedNativeActionPath,
  NATIVE_REFRESH_EVENT,
  NATIVE_UPDATE_BLOCK_EVENT,
  parseWaitingWorkerMarker,
  shouldRequestSafeActivation,
  SW_MESSAGE,
  UPDATE_WAITING_STORAGE_KEY,
} from "~/lib/pwa/update-coordination";
import {
  captureNativeInstallPrompt,
  markNativeAppInstalled,
  type NativeInstallPromptEvent,
} from "~/lib/pwa/install-guidance";

const WORKER_VERSION_TIMEOUT_MS = 1200;
const ACTIVATION_RESPONSE_TIMEOUT_MS = 2500;
const REFRESH_THROTTLE_MS = 1000;

type NativeRefreshReason = "foreground" | "reconnect";

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A waiting worker will activate naturally after every tab closes.
  }
}

function storageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in hardened/private browsing modes.
  }
}

function hasDirtyForm(documentNode: Document): boolean {
  return Array.from(documentNode.forms).some((form) =>
    Array.from(form.elements).some((element) => {
      if (element instanceof HTMLInputElement) {
        if (element.type === "file") return (element.files?.length ?? 0) > 0;
        if (element.type === "checkbox" || element.type === "radio") {
          return element.checked !== element.defaultChecked;
        }
        return element.value !== element.defaultValue;
      }
      if (element instanceof HTMLTextAreaElement) {
        return element.value !== element.defaultValue;
      }
      if (element instanceof HTMLSelectElement) {
        return Array.from(element.options).some(
          (option) => option.selected !== option.defaultSelected,
        );
      }
      return false;
    }),
  );
}

function hasBlockingDomState(documentNode: Document): boolean {
  const playingMedia = Array.from(
    documentNode.querySelectorAll<HTMLMediaElement>("audio, video"),
  ).some((media) => !media.paused && !media.ended);

  return (
    documentNode.querySelector(
      '[data-native-update-block="true"], [data-native-update-block="active"], [aria-busy="true"]',
    ) !== null ||
    hasDirtyForm(documentNode) ||
    playingMedia
  );
}

function readWorkerVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, WORKER_VERSION_TIMEOUT_MS);

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      const data = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "type" in data &&
        "version" in data &&
        data.type === SW_MESSAGE.version &&
        typeof data.version === "string"
      ) {
        resolve(data.version);
        return;
      }
      resolve(null);
    };

    worker.postMessage({ type: SW_MESSAGE.getVersion }, [channel.port2]);
  });
}

function requestSafeActivation(
  worker: ServiceWorker,
  version: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, ACTIVATION_RESPONSE_TIMEOUT_MS);

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      const data = event.data;
      resolve(
        typeof data === "object" &&
          data !== null &&
          "type" in data &&
          "activated" in data &&
          data.type === SW_MESSAGE.activationResult &&
          data.activated === true,
      );
    };

    worker.postMessage(
      {
        type: SW_MESSAGE.activateOnSafeReopen,
        safeReopen: true,
        version,
      },
      [channel.port2],
    );
  });
}

export function blockNativeUpdateForCurrentPage(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NATIVE_UPDATE_BLOCK_EVENT));
}

/**
 * Root-level adapter for install/update/offline behavior. It renders no UI and
 * intentionally owns no application state, so the shared shell only needs one
 * mount while forms and protected actions remain independent.
 */
export function NativeAppRuntime() {
  const router = useRouter();

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      captureNativeInstallPrompt(event as NativeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      markNativeAppInstalled();
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    if (!("serviceWorker" in navigator)) {
      return () => {
        window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
        window.removeEventListener("appinstalled", onAppInstalled);
      };
    }

    const markerAtBoot = parseWaitingWorkerMarker(
      storageGet(UPDATE_WAITING_STORAGE_KEY),
    );
    const handledVersions = new Set<string>();
    let interactionObserved = false;
    let protectedActionActive = false;
    let activationRequested = false;
    let registration: ServiceWorkerRegistration | null = null;
    let disposed = false;
    let lastRefreshAt = 0;

    const documentIsSafe = () =>
      !isProtectedNativeActionPath(window.location.pathname) &&
      !interactionObserved &&
      !protectedActionActive &&
      !hasBlockingDomState(document);

    const onPotentialFormActivity = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("form, [data-native-update-block]") !== null
      ) {
        interactionObserved = true;
      }
    };

    const onProtectedAction = () => {
      protectedActionActive = true;
    };

    const onWorkerMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        !("type" in data) ||
        data.type !== SW_MESSAGE.clientSafetyQuery
      ) {
        return;
      }

      const reply = event.ports[0];
      reply?.postMessage({ safe: documentIsSafe() });
    };

    const handleWaitingWorker = async (worker: ServiceWorker) => {
      const version =
        (await readWorkerVersion(worker)) ?? `unknown:${worker.scriptURL}`;
      if (disposed || handledVersions.has(version)) return;
      handledVersions.add(version);

      const observedBeforeBoot = markerAtBoot?.version === version;
      if (!observedBeforeBoot) {
        storageSet(
          UPDATE_WAITING_STORAGE_KEY,
          createWaitingWorkerMarker(version),
        );
        return;
      }

      const shouldActivate = shouldRequestSafeActivation({
        waitingWorkerFound: true,
        waitingVersionWasObservedBeforeBoot: true,
        pathname: window.location.pathname,
        visibilityState: document.visibilityState,
        online: navigator.onLine,
        interactionObserved,
        protectedActionActive,
        blockingDomState: hasBlockingDomState(document),
      });
      if (!shouldActivate) return;

      activationRequested = true;
      const activated = await requestSafeActivation(worker, version);
      if (!activated) activationRequested = false;
    };

    const watchInstallingWorker = (worker: ServiceWorker) => {
      const onStateChange = () => {
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller !== null &&
          registration?.waiting
        ) {
          void handleWaitingWorker(registration.waiting);
        }
      };
      worker.addEventListener("statechange", onStateChange);
    };

    const onControllerChange = () => {
      if (!activationRequested) return;
      storageRemove(UPDATE_WAITING_STORAGE_KEY);
      window.location.reload();
    };

    const signalRefresh = (reason: NativeRefreshReason) => {
      const now = Date.now();
      if (now - lastRefreshAt < REFRESH_THROTTLE_MS) return;
      lastRefreshAt = now;

      window.dispatchEvent(
        new CustomEvent(NATIVE_REFRESH_EVENT, {
          detail: { reason, at: now },
        }),
      );
      router.refresh();
      void registration?.update().catch(() => {
        // Refresh remains useful even when the update check is unavailable.
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        signalRefresh("foreground");
      }
    };
    const onOnline = () => {
      signalRefresh("reconnect");
    };

    for (const eventName of [
      "beforeinput",
      "change",
      "drop",
      "input",
      "submit",
    ]) {
      document.addEventListener(eventName, onPotentialFormActivity, true);
    }
    window.addEventListener(NATIVE_UPDATE_BLOCK_EVENT, onProtectedAction);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    navigator.serviceWorker.addEventListener("message", onWorkerMessage);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (disposed) return;

        const waitingAtRegistration = registration.waiting;
        if (waitingAtRegistration) {
          await handleWaitingWorker(waitingAtRegistration);
        } else if (!registration.installing) {
          storageRemove(UPDATE_WAITING_STORAGE_KEY);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration?.installing;
          if (installing) watchInstallingWorker(installing);
        });
        if (registration.installing) {
          watchInstallingWorker(registration.installing);
        }
      } catch {
        // The web app keeps working when service workers are unavailable.
      }
    };
    const onWindowLoad = () => {
      void register();
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", onWindowLoad, { once: true });
    }

    return () => {
      disposed = true;
      window.removeEventListener("load", onWindowLoad);
      for (const eventName of [
        "beforeinput",
        "change",
        "drop",
        "input",
        "submit",
      ]) {
        document.removeEventListener(
          eventName,
          onPotentialFormActivity,
          true,
        );
      }
      window.removeEventListener(NATIVE_UPDATE_BLOCK_EVENT, onProtectedAction);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker.removeEventListener("message", onWorkerMessage);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [router]);

  return null;
}

/**
 * Compatibility export for the current root layout. The integration commit
 * should mount NativeAppRuntime directly and may then remove this alias.
 */
export function SwRegister() {
  return <NativeAppRuntime />;
}
