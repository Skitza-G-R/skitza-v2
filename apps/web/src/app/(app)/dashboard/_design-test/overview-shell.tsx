"use client";

// Overview shell — composes DesignShell + OverviewTab. Unchanged
// behavior from the previous round; the shared chrome moved into
// DesignShell so the same Sidebar + dt-root scope can wrap any tab.

import { DesignShell } from "./design-shell";
import { OverviewTab, type OverviewData } from "./overview-tab";
import type { Producer } from "./shell";

type OverviewShellProps = {
  producer: Producer;
  data: OverviewData;
};

export function OverviewShell({ producer, data }: OverviewShellProps) {
  return (
    <DesignShell producer={producer}>
      <OverviewTab data={data} />
    </DesignShell>
  );
}
