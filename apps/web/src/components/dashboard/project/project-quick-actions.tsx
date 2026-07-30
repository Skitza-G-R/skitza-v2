import { Plus } from "lucide-react";

interface ProjectQuickActionsProps {
  projectName: string;
  canAddSong: boolean;
  blockedReason: string;
  onAddSong: () => void;
}

export function ProjectQuickActions({
  projectName,
  canAddSong,
  blockedReason,
  onAddSong,
}: ProjectQuickActionsProps) {
  return (
    <button
      type="button"
      aria-label={`Add song to ${projectName}`}
      onClick={onAddSong}
      disabled={!canAddSong}
      title={canAddSong ? "Add song" : blockedReason}
      className="sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-background))] shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Plus size={19} strokeWidth={2.4} aria-hidden />
    </button>
  );
}
