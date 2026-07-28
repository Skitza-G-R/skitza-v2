"use client";

import { useEffect, useState } from "react";

import type { AdminEnvironmentId } from "~/server/environment";

type ApiState = "checking" | "failed" | "ready";

function isMatchingContext(
  value: unknown,
  environment: AdminEnvironmentId,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const context = (value as { environment?: unknown }).environment;
  if (typeof context !== "object" || context === null) return false;
  return (context as { id?: unknown }).id === environment;
}

export function AdminContextStatus({
  environment,
}: {
  environment: AdminEnvironmentId;
}) {
  const [state, setState] = useState<ApiState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function checkContext() {
      try {
        const response = await fetch(
          `/api/admin/context?environment=${environment}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          setState("failed");
          return;
        }

        const payload: unknown = await response.json();
        setState(
          isMatchingContext(payload, environment) ? "ready" : "failed",
        );
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          Reflect.get(error, "name") === "AbortError"
        ) {
          return;
        }
        setState("failed");
      }
    }

    void checkContext();
    return () => {
      controller.abort();
    };
  }, [environment]);

  return (
    <div className="api-status" data-state={state} aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      {state === "checking"
        ? "Verifying protected API…"
        : state === "ready"
          ? "Protected API verified"
          : "Protected API unavailable"}
    </div>
  );
}
