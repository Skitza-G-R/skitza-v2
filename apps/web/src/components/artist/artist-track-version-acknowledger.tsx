"use client";

import { useEffect } from "react";

import { acknowledgeArtistTrackVersionAction } from "./artist-notification-actions";

export function ArtistTrackVersionAcknowledger({ trackVersionId }: { trackVersionId: string }) {
  useEffect(() => {
    void acknowledgeArtistTrackVersionAction({ trackVersionId });
  }, [trackVersionId]);

  return null;
}
