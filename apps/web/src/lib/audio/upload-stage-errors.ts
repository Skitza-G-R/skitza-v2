export type UploadFailureStage =
  | "initiation"
  | "presign"
  | "transfer"
  | "completion"
  | "cancellation";

const STAGE_HEADING: Record<UploadFailureStage, string> = {
  initiation: "Upload setup failed.",
  presign: "Upload link preparation failed.",
  transfer: "Audio transfer failed.",
  completion: "Upload completion failed.",
  cancellation: "Upload cancellation failed.",
};

const STAGE_FALLBACK: Record<UploadFailureStage, string> = {
  initiation: "Upload setup failed. Please try again.",
  presign: "Upload link preparation failed. Please try again.",
  transfer: "Audio transfer failed. Check your connection and try again.",
  completion: "Upload completion failed. Please try again.",
  cancellation: "Upload cancellation failed. Skitza kept the recovery record; please try again.",
};

export function uploadStageFailure(stage: UploadFailureStage, safeDetail?: string): string {
  const detail = safeDetail?.trim();
  if (!detail) return STAGE_FALLBACK[stage];
  if (detail.startsWith(STAGE_HEADING[stage])) return detail;
  return `${STAGE_HEADING[stage]} ${detail}`;
}

export function uploadTransferFailure(
  input: {
    partNumber?: number;
    status?: number;
  } = {},
): string {
  const part = input.partNumber === undefined ? "" : ` on part ${String(input.partNumber)}`;
  if (input.status !== undefined) {
    return `Audio transfer failed${part} (HTTP ${String(input.status)}). Please try again.`;
  }
  if (part) return `Audio transfer failed${part}. Check your connection and try again.`;
  return uploadStageFailure("transfer");
}
