export function formatSessionIdentityTitle(input: {
  projectName: string;
  artistName: string;
  producerName: string;
}): string {
  const projectName = input.projectName.trim() || "Session";
  const artistName = input.artistName.trim() || "Artist";
  const producerName = input.producerName.trim() || "Skitza producer";
  return `${projectName} · ${artistName} & ${producerName}`;
}
