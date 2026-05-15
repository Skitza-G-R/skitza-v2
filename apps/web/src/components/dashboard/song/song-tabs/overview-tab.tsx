"use client";

import Link from "next/link";
import { ChevronRight, MessageCircle, User } from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";
import { LinkPill, type LinkPillState } from "~/components/dashboard/clients/link-pill";
import {
  VersionRow,
  type VersionRowVersionData,
} from "~/components/dashboard/song/version-row";
import { WorkflowStepper } from "~/components/dashboard/song/workflow-stepper";

// OverviewTab — first tab in the Song Space (DESIGN.md §4.4):
//
//   Top:    full-width card with the horizontal WorkflowStepper
//   Bottom: 2-column grid —
//             Left: Latest versions (top 3 VersionRows + "See all →"
//                   button that jumps to the Versions tab)
//             Right (album mode only): Client snippet (avatar + name
//                   + LinkPill + "View client" + "Message")
//
// Single mode hides the Client snippet because the client identity
// already sits in the SongSpaceHero meta line.

interface OverviewTabSong {
  workflowStage: WorkflowStage;
  title: string;
}

interface OverviewTabProject {
  name: string;
}

interface OverviewTabClient {
  id: string;
  name: string;
  email: string | null;
  linkState: LinkPillState;
}

interface OverviewTabProps {
  song: OverviewTabSong;
  project: OverviewTabProject;
  /** All versions for this song — the panel slices top 3. */
  latestVersions: VersionRowVersionData[];
  client: OverviewTabClient;
  mode: "album" | "single";
  onShowAllVersions: () => void;
}

export function OverviewTab({
  song,
  project,
  latestVersions,
  client,
  mode,
  onShowAllVersions,
}: OverviewTabProps) {
  const topThree = latestVersions.slice(0, 3);
  const clientAvatarBg = producerGradient(client.name);
  const clientInitials = producerInitials(client.name);

  return (
    <section
      role="tabpanel"
      id="panel-overview"
      aria-labelledby="tab-overview"
      className="space-y-6"
    >
      {/* Workflow card — full-width */}
      <div
        className="rounded-[var(--radius-lg)] border p-5"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <h3
          className="font-syne text-[16px] font-bold"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          Workflow
        </h3>
        <div className="mt-4">
          <WorkflowStepper current={song.workflowStage} />
        </div>
      </div>

      {/* 2-column grid — Latest versions + Client snippet */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Left — Latest versions */}
        <div
          className="rounded-[var(--radius-lg)] border p-5"
          style={{
            background: "rgb(var(--bg-elevated))",
            borderColor: "rgb(var(--border-subtle))",
          }}
        >
          <div className="flex items-center justify-between">
            <h3
              className="font-syne text-[16px] font-bold"
              style={{ color: "rgb(var(--fg-default))" }}
            >
              Latest versions
            </h3>
            <button
              type="button"
              onClick={onShowAllVersions}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors hover:bg-[rgb(var(--bg-background))]"
              style={{ color: "rgb(var(--brand-primary))" }}
            >
              See all
              <ChevronRight size={12} />
            </button>
          </div>

          {topThree.length === 0 ? (
            <p
              className="mt-4 rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-[13px]"
              style={{
                borderColor: "rgb(var(--border-subtle))",
                color: "rgb(var(--fg-muted))",
              }}
            >
              No versions yet — upload the first one to get started.
            </p>
          ) : (
            <div className="mt-4 space-y-1.5">
              {topThree.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  songTitle={song.title}
                  projectName={project.name}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right — Client snippet (album mode only) */}
        {mode !== "single" ? (
          <div
            className="rounded-[var(--radius-lg)] border p-5"
            style={{
              background: "rgb(var(--bg-elevated))",
              borderColor: "rgb(var(--border-subtle))",
            }}
          >
            <h3
              className="font-syne text-[16px] font-bold"
              style={{ color: "rgb(var(--fg-default))" }}
            >
              Client
            </h3>
            <div className="mt-4 flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
                style={{ background: clientAvatarBg }}
              >
                {clientInitials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p
                    className="truncate text-[14px] font-semibold"
                    style={{ color: "rgb(var(--fg-default))" }}
                  >
                    {client.name}
                  </p>
                  <LinkPill state={client.linkState} />
                </div>
                {client.email ? (
                  <p
                    className="mt-0.5 truncate text-[12px]"
                    style={{ color: "rgb(var(--fg-muted))" }}
                  >
                    {client.email}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {/* When the project has no matching clientContacts row, the
                  page-level loader falls back to client.id === "". A link
                  to `/clients/` (no id) routes to a 404 — worse than just
                  omitting the action. Guard with the empty-string check
                  and target the canonical Client Space route from the
                  Phase 1 redesign. */}
              {client.id ? (
                <Link
                  href={`/dashboard/clients-projects/clients/${client.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-[rgb(var(--bg-background))]"
                  style={{
                    background: "transparent",
                    borderColor: "rgb(var(--border-subtle))",
                    color: "rgb(var(--fg-default))",
                  }}
                >
                  <User size={12} />
                  View client
                </Link>
              ) : null}
              <button
                type="button"
                disabled
                title="Coming soon"
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: "transparent",
                  borderColor: "rgb(var(--border-subtle))",
                  color: "rgb(var(--fg-default))",
                }}
              >
                <MessageCircle size={12} />
                Message
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
