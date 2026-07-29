"use client";

import { useEffect, useState } from "react";

import { requestAdminContext } from "~/lib/admin-api-requests";
import type { AdminEnvironmentId } from "~/server/environment";

type ApiState = "checking" | "failed" | "ready";

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
        const result = await requestAdminContext(environment, {
          signal: controller.signal,
        });
        if (result === "access-login-required") {
          window.location.assign(window.location.href);
          return;
        }
        if (controller.signal.aborted) return;
        setState(result === "ready" ? "ready" : "failed");
      } catch {
        if (controller.signal.aborted) return;
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
