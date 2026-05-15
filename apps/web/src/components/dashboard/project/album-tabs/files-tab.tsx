import { FilesSubTab } from "~/components/dashboard/project/sub-tabs/files-sub-tab";

// FilesTab — thin pass-through for the album page's Files tab. The
// existing FilesSubTab already renders the right empty-state for v1
// (contracts auto-sync + drive links coming post-launch); this wrapper
// gives the new IA a stable module path so the file router can be
// swapped in later without touching album-space.tsx.

interface FilesTabProps {
  projectId: string;
}

export function FilesTab({ projectId }: FilesTabProps) {
  return <FilesSubTab projectId={projectId} />;
}
