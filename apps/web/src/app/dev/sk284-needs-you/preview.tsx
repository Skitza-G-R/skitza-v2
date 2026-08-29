"use client";

import { OverviewScreen } from "~/components/dashboard/overview/overview-screen";
import { RuntimeStateProvider } from "~/components/runtime-state/runtime-state-provider";

// Fixed instants so every render of this gallery is identical.
const NOW = new Date("2026-08-29T09:00:00.000Z");
const COMMENT_AT = new Date("2026-08-28T08:30:00.000Z");
const STALE_SINCE = new Date("2026-07-20T10:00:00.000Z");

const PROJECT_B = "00000000-0000-4000-8000-0000000003a2";
const COMMENT_ID = "00000000-0000-4000-8000-0000000003b1";

export function Sk284Preview() {
  return (
    // OverviewScreen reads runtime state, which the producer layout normally
    // supplies. The gallery renders outside that layout, so it provides it
    // here. Toasts are NOT provided: the root layout already mounts exactly one
    // Toaster, and components/ui/__tests__/toast.test.tsx enforces that.
    <RuntimeStateProvider
      identity={{ userId: "dev-preview", role: "producer", contextId: "dev-preview" }}
    >
      <main className="min-h-screen bg-[rgb(var(--bg-app))]">
        <OverviewScreen
          displayName="Gili Asraf"
          slug="gili-asraf-3d"
          timezone="Asia/Jerusalem"
          // Matches a real default studio: StudioPulse only renders money
          // when commercialAvailable AND both amounts AND a currency are all
          // set, so most producers see just "Active projects".
          pulseStats={{
            commercialAvailable: false,
            thisMonthCents: null,
            outstandingCents: null,
            currency: null,
            activeProjects: 4,
          }}
          // A row WITHOUT an ✕ — money is never hideable. Sits first on purpose
          // so the contrast against the dismissible rows below is obvious.
          paymentProofs={[
            {
              proofId: "00000000-0000-4000-8000-0000000003c1",
              artistName: "Noa Kirel",
              productNameSnapshot: "Mix & Master",
            },
          ]}
          paymentBalances={[]}
          purchaseRequests={[]}
          pendingApprovals={[]}
          todaySession={null}
          urgentProjects={[
            {
              id: PROJECT_B,
              title: "כמה זה מפחיד",
              clientName: "יובל לוי",
              gradient: "linear-gradient(135deg, #b98a3a, #6d4d1f)",
              stage: "in_production",
              urgency: "stuck",
              lastActivityAt: STALE_SINCE,
            },
          ]}
          recentUploads={[]}
          unresolvedItems={[
            {
              id: `comment:${COMMENT_ID}`,
              commentId: COMMENT_ID,
              kind: "comment",
              title: "Lior",
              subtitle: "Can we push the bridge vocal a little louder?",
              occurredAt: COMMENT_AT,
              href: "/dashboard/music/00000000-0000-4000-8000-0000000003f1",
              unread: true,
            },
          ]}
          dismissals={[]}
          showSetupNudge={false}
          // Show every row rather than the top three, so all three states are
          // visible in one screenshot.
          showAllNeedsYou
          now={NOW}
        />
      </main>
    </RuntimeStateProvider>
  );
}
