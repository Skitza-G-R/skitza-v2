export type PreferenceSaveResult =
  | { ok: true }
  | { ok: false; error: string };

export type PreferenceSaveLock = { current: boolean };

type OptimisticPreferenceSaveOptions = {
  lock: PreferenceSaveLock;
  save: () => Promise<PreferenceSaveResult>;
  rollback: () => void;
  onError: (message: string) => void;
  setPending: (pending: boolean) => void;
  errorLabel: string;
};

export async function runOptimisticPreferenceSave({
  lock,
  save,
  rollback,
  onError,
  setPending,
  errorLabel,
}: OptimisticPreferenceSaveOptions): Promise<"saved" | "failed" | "ignored"> {
  if (lock.current) return "ignored";

  lock.current = true;
  setPending(true);
  try {
    let result: PreferenceSaveResult;
    try {
      result = await save();
    } catch {
      rollback();
      onError(`${errorLabel} wasn’t saved. Try again.`);
      return "failed";
    }

    if (!result.ok) {
      rollback();
      onError(`${errorLabel} wasn’t saved. ${result.error}`);
      return "failed";
    }

    return "saved";
  } finally {
    lock.current = false;
    setPending(false);
  }
}
