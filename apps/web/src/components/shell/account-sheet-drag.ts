export const ACCOUNT_SHEET_UPWARD_OVERSCAN_PX = 24;
const UPWARD_DRAG_RESISTANCE = 0.18;
const RELEASE_VELOCITY_DECAY_MS = 100;
const RELEASE_SAMPLE_MIN_INTERVAL_MS = 8;

/**
 * Keeps downward movement directly under the finger while giving upward
 * movement a short rubber-band response. The sheet can therefore reverse
 * direction during one continuous gesture without exposing empty space.
 */
export function accountSheetDragOffset(distancePx: number): number {
  if (distancePx >= 0) return distancePx;
  return Math.max(
    -ACCOUNT_SHEET_UPWARD_OVERSCAN_PX,
    distancePx * UPWARD_DRAG_RESISTANCE,
  );
}

export function shouldDismissAccountSheet({
  distancePx,
  velocityPxPerMs,
  sheetHeightPx,
}: {
  distancePx: number;
  velocityPxPerMs: number;
  sheetHeightPx: number;
}): boolean {
  if (distancePx <= 0) return false;

  const distanceThreshold = Math.min(160, Math.max(80, sheetHeightPx * 0.25));
  const isFastDownwardFlick = distancePx >= 24 && velocityPxPerMs >= 0.75;
  return distancePx >= distanceThreshold || isFastDownwardFlick;
}

/**
 * Pointer-up often arrives at the same coordinate as the final pointer-move.
 * Preserve a genuinely fresh flick in that case, but linearly decay it so a
 * paused finger settles by position. A real final movement always wins,
 * including an upward reversal delivered only by pointer-up.
 */
export function accountSheetReleaseVelocity({
  previousVelocityPxPerMs,
  lastY,
  lastTime,
  releaseY,
  releaseTime,
}: {
  previousVelocityPxPerMs: number;
  lastY: number;
  lastTime: number;
  releaseY: number;
  releaseTime: number;
}): number {
  const rawElapsed = releaseTime - lastTime;
  if (rawElapsed < 0) return 0;

  const elapsed = rawElapsed;
  const releaseDistance = releaseY - lastY;

  if (releaseDistance !== 0) {
    if (elapsed === 0) return 0;
    return releaseDistance / Math.max(RELEASE_SAMPLE_MIN_INTERVAL_MS, elapsed);
  }

  const freshness = Math.max(0, 1 - elapsed / RELEASE_VELOCITY_DECAY_MS);
  return previousVelocityPxPerMs * freshness;
}
