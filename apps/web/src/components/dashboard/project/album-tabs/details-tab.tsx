"use client";

import { stageLabel, type WorkflowStage } from "~/lib/clients/workflow-stage";
import {
  ProjectActionControls,
  type ProjectActionProject,
} from "~/components/dashboard/projects/project-action-controls";

interface ProjectDetails {
  name: string;
  clientName: string;
  workflowStage: WorkflowStage;
  deadline: string;
}

interface DetailsTabProps {
  project: ProjectDetails;
  actionProject: ProjectActionProject;
  onDeleted: () => void;
}

function lifecycleLabel(status: ProjectActionProject["lifecycleStatus"]): string {
  if (status === "waiting_for_payment") return "Waiting for payment";
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  if (status === "canceled") return "Canceled";
  return "Active";
}

export function DetailsTab({ project, actionProject, onDeleted }: DetailsTabProps) {
  const rows = [
    { label: "Project name", value: project.name },
    { label: "Client", value: project.clientName },
    { label: "Status", value: lifecycleLabel(actionProject.lifecycleStatus) },
    { label: "Current stage", value: stageLabel(project.workflowStage) },
    { label: "Deadline", value: project.deadline },
  ];

  return (
    <section role="tabpanel" id="panel-details" aria-labelledby="tab-details" className="space-y-5">
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
        <div>
          <h2 className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
            Project details
          </h2>
          <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
            Details stay read-only until you choose Edit.
          </p>
        </div>

        <dl className="mt-4 divide-y divide-[rgb(var(--border-subtle))]">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-baseline sm:gap-4"
            >
              <dt className="text-[11px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                {row.label}
              </dt>
              <dd className="min-w-0 text-[13.5px] font-semibold break-words text-[rgb(var(--fg-default))]">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
        <h2 className="font-display text-[16px] font-extrabold tracking-[-0.015em] text-[rgb(var(--fg-default))]">
          Project actions
        </h2>
        <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
          Edit the stage or deadline, complete the project, or manage its lifecycle.
        </p>
        <ProjectActionControls project={actionProject} className="mt-4" onDeleted={onDeleted} />
      </div>
    </section>
  );
}
