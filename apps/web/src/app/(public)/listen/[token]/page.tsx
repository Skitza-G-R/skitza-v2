import type { Metadata } from "next";
import { createDb } from "@skitza/db";
import { notFound } from "next/navigation";

import { PublicSongPlayer } from "~/components/public-song/public-song-player";
import { resolveBrandStyle } from "~/lib/branding/theme-resolver";
import { songPublicationSecret } from "~/server/domain/song-publication/config";
import {
  readPublicSong,
  SongPublicReadError,
} from "~/server/domain/song-publication/public-read";
import { SongPublicTokenError } from "~/server/domain/song-publication/tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Listen on Skitza",
  description: "A private-by-URL listening page shared from Skitza.",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default async function PublicSongPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");

  let data;
  try {
    data = await readPublicSong(createDb(databaseUrl), {
      secret: songPublicationSecret(),
      token,
    });
  } catch (error) {
    if (error instanceof SongPublicReadError || error instanceof SongPublicTokenError) {
      notFound();
    }
    throw error;
  }

  return (
    <div
      style={resolveBrandStyle({
        ...(data.producer.primaryColor ? { primary: data.producer.primaryColor } : {}),
        ...(data.producer.accentColor ? { accent: data.producer.accentColor } : {}),
      })}
    >
      <PublicSongPlayer
        songTitle={data.song.title}
        artist={data.song.artist}
        producerName={data.producer.displayName}
        producerLogoUrl={data.producer.logoUrl}
        versions={data.versions.map((version) => ({
          id: version.id,
          label: version.label,
          audioUrl: version.audioUrl,
          durationMs: version.durationMs,
          uploadedAtIso: version.uploadedAt.toISOString(),
          peaks: version.peaks,
        }))}
      />
    </div>
  );
}
