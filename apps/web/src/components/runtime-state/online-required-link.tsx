"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";

function subscribeToOnlineStatus(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function readOnlineStatus(): boolean {
  return navigator.onLine;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeToOnlineStatus, readOnlineStatus, () => true);
}

export function OnlineRequiredLink({
  href,
  className,
  children,
  offlineMessage = "Reconnect to continue.",
}: {
  href: string;
  className?: string;
  children: ReactNode;
  offlineMessage?: string;
}) {
  const online = useOnlineStatus();
  const [showBlockedMessage, setShowBlockedMessage] = useState(false);

  return (
    <>
      <Link
        href={href}
        className={className}
        aria-disabled={!online}
        onClick={(event) => {
          if (online) return;
          event.preventDefault();
          setShowBlockedMessage(true);
        }}
      >
        {children}
      </Link>
      {showBlockedMessage && !online ? (
        <span
          role="alert"
          className="mt-2 block text-[12px] font-medium text-[rgb(var(--fg-danger-text))]"
        >
          {offlineMessage}
        </span>
      ) : null}
    </>
  );
}
