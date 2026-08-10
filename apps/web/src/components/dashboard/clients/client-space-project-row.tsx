"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";

import { ProjectActionsMenu } from "~/components/dashboard/projects/project-actions-menu";
import type { ProjectActionProject } from "~/components/dashboard/projects/project-action-controls";
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

      <div className="absolute top-3 right-3 z-20">
        <ProjectActionsMenu
          project={project}
          label={`Project actions for ${project.title}`}
          lifecycleSuccessFocusRef={lifecycleSuccessFocusRef}
          onChanged={onChanged}
        />
      </div>
    </li>
  );
}
