export function songPublicationSecret(): string {
  const secret = process.env.SONG_PUBLIC_LINK_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Missing or weak SONG_PUBLIC_LINK_SECRET");
  }
  return secret;
}
