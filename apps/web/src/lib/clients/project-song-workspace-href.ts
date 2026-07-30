interface ProjectSongWorkspaceHrefOptions {
  upload?: boolean;
}

export function projectSongWorkspaceHref(
  projectId: string,
  songId: string,
  options: ProjectSongWorkspaceHrefOptions = {},
): string {
  const searchParams = new URLSearchParams({ song: songId });
  if (options.upload) searchParams.set("upload", "1");

  return `/dashboard/clients-projects/${encodeURIComponent(projectId)}?${searchParams.toString()}`;
}
