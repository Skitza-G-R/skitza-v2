export const PROJECT_WORKFLOW_STAGE_OPTIONS = [
  { value: "brief", label: "Brief" },
  { value: "production", label: "Production" },
  { value: "mixing", label: "Mixing" },
  { value: "mastering", label: "Mastering" },
  { value: "done", label: "Done" },
] as const;

export type ProjectWorkflowStage = (typeof PROJECT_WORKFLOW_STAGE_OPTIONS)[number]["value"];

export type ProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

/**
 * The stable project snapshot required by every project action surface.
 * Client identity is display-only: project lifecycle actions never accept a
 * client id, so an edit cannot transfer work between artists.
 */
export interface ProjectActionProject {
  id: string;
  title: string;
  clientName: string;
  lifecycleStatus: ProjectLifecycleStatus;
  workflowStage: ProjectWorkflowStage;
  deadlineAtIso: string | null;
  canDeleteEmptyDraft: boolean;
}

export interface ProjectActionCallbacks {
  /** Fired after an edit or lifecycle transition succeeds. */
  onChanged?: ((projectId: string) => void) | undefined;
  /** Fired after permanent deletion succeeds. */
  onDeleted?: ((projectId: string) => void) | undefined;
}
