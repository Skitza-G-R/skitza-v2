export function publicSongAudioPath(versionId: string, pageToken: string): string {
  return `/api/audio/public/song/${encodeURIComponent(versionId)}?token=${encodeURIComponent(pageToken)}`;
}

export function publicSongDownloadPath(versionId: string, pageToken: string): string {
  return `${publicSongAudioPath(versionId, pageToken)}&download=1`;
}

export function publicPortfolioSongAudioPath(versionId: string, capability: string): string {
  return `/api/audio/public/song/${encodeURIComponent(versionId)}?cap=${encodeURIComponent(capability)}`;
}
