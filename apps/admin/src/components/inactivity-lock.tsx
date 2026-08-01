"use client";

import { useEffect } from "react";

import {
  ADMIN_ACTIVITY_REFRESH_INTERVAL_MS,
  ADMIN_INACTIVITY_TIMEOUT_MS,
} from "~/lib/admin-session";
import {
  requestAdminActivity,
  requestAdminLock,
} from "~/lib/admin-api-requests";

const ACTIVITY_EVENTS = [
  "keydown",
  "pointerdown",
  "pointermove",
  "scroll",
  "touchstart",
] as const;

const SHARED_ACTIVITY_STORAGE_KEY = "skitza-admin:last-activity";

export function InactivityLock() {
  useEffect(() => {
    let lastActivityAt = Date.now();
    let lastRefreshAt = 0;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let locking = false;

    const lock = async () => {
      if (locking) return;
      locking = true;
      try {
        const result = await requestAdminLock();
        if (result.status === "access-login-required") {
          locking = false;
          window.location.assign(window.location.href);
          return;
        }
        if (result.status === "retry") {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            void lock();
          }, result.retryAfterMs);
          locking = false;
          return;
        }
      } catch {
        // Unexpected request-layer failures lock below without creating an
        // unhandled client rejection.
      } finally {
        if (locking) {
          window.location.replace("/unlock?reason=inactive");
        }
      }
    };

    const scheduleLock = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      const remaining =
        lastActivityAt + ADMIN_INACTIVITY_TIMEOUT_MS - Date.now();
      if (remaining <= 0) {
        void lock();
        return;
      }
      timeoutId = setTimeout(() => {
        void lock();
      }, remaining);
    };

    const refreshServerActivity = async () => {
      try {
        const result = await requestAdminActivity();
        if (result === "access-login-required") {
          window.location.assign(window.location.href);
          return;
        }
        if (result === "lock-required") await lock();
      } catch {
        await lock();
      }
    };

    const recordActivity = () => {
      const now = Date.now();
      lastActivityAt = now;
      try {
        window.localStorage.setItem(
          SHARED_ACTIVITY_STORAGE_KEY,
          String(now),
        );
      } catch {
        // The signed server cookie remains authoritative when storage is
        // disabled. The lock endpoint also refuses stale-tab lock attempts.
      }
      scheduleLock();

      if (now - lastRefreshAt >= ADMIN_ACTIVITY_REFRESH_INTERVAL_MS) {
        lastRefreshAt = now;
        void refreshServerActivity();
      }
    };

    const readSharedActivity = () => {
      try {
        const stored = Number(
          window.localStorage.getItem(SHARED_ACTIVITY_STORAGE_KEY),
        );
        if (Number.isFinite(stored) && stored > lastActivityAt) {
          lastActivityAt = stored;
        }
      } catch {
        // See recordActivity: client storage is only a cross-tab convenience.
      }
    };

    const checkVisibility = () => {
      if (document.visibilityState !== "visible") return;
      readSharedActivity();
      if (Date.now() - lastActivityAt >= ADMIN_INACTIVITY_TIMEOUT_MS) {
        void lock();
        return;
      }
      recordActivity();
    };

    const syncActivityFromAnotherTab = (event: StorageEvent) => {
      if (
        event.key !== SHARED_ACTIVITY_STORAGE_KEY ||
        event.newValue === null
      ) {
        return;
      }
      const sharedActivityAt = Number(event.newValue);
      if (
        Number.isFinite(sharedActivityAt) &&
        sharedActivityAt > lastActivityAt
      ) {
        lastActivityAt = sharedActivityAt;
        scheduleLock();
      }
    };

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", checkVisibility);
    window.addEventListener("focus", checkVisibility);
    window.addEventListener("storage", syncActivityFromAnotherTab);

    recordActivity();

    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, recordActivity);
      }
      document.removeEventListener("visibilitychange", checkVisibility);
      window.removeEventListener("focus", checkVisibility);
      window.removeEventListener("storage", syncActivityFromAnotherTab);
    };
  }, []);

  return null;
}
