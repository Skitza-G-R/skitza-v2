export const NEW_SONG_DESTINATION = "__new__";

type LibraryUploadDestinationProject = Readonly<{
  canCreateNewSong: boolean;
  tracks: readonly Readonly<{ id: string }>[];
}>;

export function defaultLibraryUploadDestination(
  project: LibraryUploadDestinationProject | undefined,
): string {
  if (!project) return "";
  if (project.canCreateNewSong) return NEW_SONG_DESTINATION;
  return project.tracks[0]?.id ?? "";
}

export function shouldShowLibraryUploadDestination(
  project: LibraryUploadDestinationProject | undefined,
): boolean {
  if (!project) return false;
  return project.tracks.length + (project.canCreateNewSong ? 1 : 0) > 1;
}
