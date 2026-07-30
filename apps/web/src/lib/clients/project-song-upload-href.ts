export function projectSongUploadHref(projectId: string, songId: string): string {
  const searchParams = new URLSearchParams({
    song: songId,
    upload: "1",
  });

  return `/dashboard/clients-projects/${encodeURIComponent(projectId)}?${searchParams.toString()}`;
}
