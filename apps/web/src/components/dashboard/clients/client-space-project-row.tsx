"use client";

import { ChevronRight, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";

import {
  ProjectActionControls,
  type ProjectActionProject,
} from "~/components/dashboard/projects/project-action-controls";
import { Badge, type BadgeProps } from "~/components/ui/badge";

export interface ClientSpaceProjectData extends ProjectActionProject {
  statusLabel: string;
  statusTone: NonNullable<BadgeProps["variant"]>;
  nextAction: string;
}

export function isArchivedClientSpaceProject(
  project: Pick<ClientSpaceProjectData, "lifecycleStatus">,
): boolean {
  return project.lifecycleStatus === "completed" || project.lifecycleStatus === "canceled";
}

export function ClientSpaceProjectRow({
  project,
  lifecycleSuccessFocusRef,
  onChanged,
}: {
  project: ClientSpaceProjectData;
  lifecycleSuccessFocusRef?: RefObject<HTMLElement | null> | undefined;
  onChanged?: ((projectId: string) => void) | undefined;
}) {
  return (
    <li className="relative min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]">
      <Link
        href={`/dashboard/clients-projects/${encodeURIComponent(project.id)}`}
        aria-label={`Open project ${project.title}`}
        className="group flex min-h-[76px] min-w-0 items-center gap-3 rounded-[var(--radius-lg)] px-4 py-3 pr-14 transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
              {project.title}
            </span>
            <Badge variant={project.statusTone} dot>
              {project.statusLabel}
            </Badge>
          </span>
          <span className="mt-1 block truncate text-[12px] text-[rgb(var(--fg-muted))]">
            {project.nextAction}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="shrink-0 text-[rgb(var(--fg-muted))] transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          size={16}
        />
      </Link>

      <details
        data-tab-swipe-ignore
        className="group/actions absolute top-3 right-3 z-20"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <summary
          aria-label={`Project actions for ${project.title}`}
          className="sk-press inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none [&::-webkit-details-marker]:hidden"
        >
          <MoreHorizontal size={17} strokeWidth={2.2} aria-hidden />
        </summary>
        <div className="absolute top-[calc(100%+6px)] right-0 w-[min(280px,calc(100vw-3rem))] rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-2 shadow-[var(--shadow-lg)]">
          <ProjectActionControls
            project={project}
            className="flex-col items-stretch"
            lifecycleSuccessFocusRef={lifecycleSuccessFocusRef}
            onChanged={onChanged}
          />
        </div>
      </details>
    </li>
  );
}
