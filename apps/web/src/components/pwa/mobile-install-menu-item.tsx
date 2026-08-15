"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  INSTALL_STATE_CHANGED_EVENT,
  isStandaloneDisplay,
  readInstallGuidanceState,
  requestInstallGuidance,
} from "~/lib/pwa/install-guidance";

export function MobileInstallMenuItem({ onBeforeOpen }: { onBeforeOpen: () => void }) {
  const [visible, setVisible] = useState(false);

  const evaluate = useCallback(() => {
    const state = readInstallGuidanceState();
    setVisible(!state.installed && !isStandaloneDisplay());
  }, []);

  useEffect(() => {
    evaluate();
    const displayMode = window.matchMedia("(display-mode: standalone)");
    displayMode.addEventListener("change", evaluate);
    window.addEventListener("appinstalled", evaluate);
    window.addEventListener(INSTALL_STATE_CHANGED_EVENT, evaluate);
    return () => {
      displayMode.removeEventListener("change", evaluate);
      window.removeEventListener("appinstalled", evaluate);
      window.removeEventListener(INSTALL_STATE_CHANGED_EVENT, evaluate);
    };
  }, [evaluate]);

  if (!visible) return null;

  return (
    <button
      type="button"
      data-testid="mobile-install-menu-item"
      onClick={() => {
        const returnFocusTo = document.querySelector<HTMLElement>(
          'button[aria-label="Open account menu"]',
        );
        onBeforeOpen();
        window.setTimeout(() => {
          requestInstallGuidance(returnFocusTo ?? undefined);
        }, 0);
      }}
      className="sk-press flex min-h-16 w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.26)] bg-[rgb(var(--brand-primary)/0.07)] px-4 py-3 text-left text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.16)] text-[rgb(var(--brand-primary-dark))]">
        <Download aria-hidden size={18} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">Install Skitza</span>
        <span className="mt-0.5 block text-xs font-normal text-[rgb(var(--fg-muted))]">
          Open full screen from your Home Screen
        </span>
      </span>
    </button>
  );
}
