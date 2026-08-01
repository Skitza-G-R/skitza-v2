"use client";

import { useEffect } from "react";

import {
  getBrowserRuntimeStorage,
  readRuntimeLaunchTarget,
} from "~/lib/runtime-state/runtime-state";

export function ResumeLastRole({ userId }: { userId: string }) {
  useEffect(() => {
    const storage = getBrowserRuntimeStorage();
    const target = storage ? readRuntimeLaunchTarget(storage, userId) : null;
    const destination = target
      ? `/launch/resolve?${new URLSearchParams({ next: target.href }).toString()}`
      : "/choose-role";
    window.location.replace(destination);
  }, [userId]);

  return (
    <div className="space-y-3 text-center" role="status" aria-live="polite">
      <p className="font-display text-2xl font-extrabold tracking-tight text-[rgb(var(--fg-primary))]">
        Opening Skitza…
      </p>
      <p className="text-sm text-[rgb(var(--fg-secondary))]">
        Restoring your last workspace.
      </p>
    </div>
  );
}
