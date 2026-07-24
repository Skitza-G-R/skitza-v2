"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function getServerOnlineSnapshot(): boolean {
  return true;
}

export function usePublicOnline(): boolean {
  return useSyncExternalStore(subscribe, getOnlineSnapshot, getServerOnlineSnapshot);
}

export function PublicConnectivityNotice({ locale = "en" }: { locale?: "en" | "he" }) {
  const online = usePublicOnline();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-public-connectivity
      className="relative z-[60] flex min-h-11 items-center justify-center border-b border-[rgb(var(--brand-primary)/0.28)] bg-[rgb(var(--brand-primary)/0.14)] px-4 py-2 text-center text-sm font-semibold text-[rgb(var(--fg-primary))]"
      style={{
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
        paddingTop: "max(0.5rem, env(safe-area-inset-top))",
      }}
    >
      {locale === "he"
        ? "אין חיבור לאינטרנט. האזנה, התחברות ופעולות חיות דורשות חיבור."
        : "You’re offline. Listening, sign-in, and live actions need internet."}
    </div>
  );
}
