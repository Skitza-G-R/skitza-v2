"use client";

import type { ReactNode } from "react";

import {
  RuntimeStatePreviewProvider,
  RuntimeStateProvider,
  type RuntimeIdentity,
} from "~/components/runtime-state/runtime-state-provider";

const PREVIEW_IDENTITY: RuntimeIdentity = {
  userId: "onboarding-preview-user",
  role: "producer",
  contextId: "onboarding-preview-producer",
};

export function OnboardingRuntimeBoundary({
  identity,
  preview = false,
  children,
}: {
  identity?: RuntimeIdentity;
  preview?: boolean;
  children: ReactNode;
}) {
  if (preview) {
    return (
      <RuntimeStatePreviewProvider identity={PREVIEW_IDENTITY}>
        {children}
      </RuntimeStatePreviewProvider>
    );
  }
  if (!identity) return children;
  return <RuntimeStateProvider identity={identity}>{children}</RuntimeStateProvider>;
}
