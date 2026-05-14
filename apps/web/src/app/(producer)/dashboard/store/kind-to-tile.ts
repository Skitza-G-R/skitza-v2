// kind-to-tile.ts
//
// Maps the free-text `products.kind` column to one of the four design
// tiles. Existing values fan out per the storefront design brief
// (docs/plans/active/2026-05-10-storefront-redesign-design.md §4).
// Anything unrecognised falls back to "consult" so the visual stays
// coherent for legacy or custom kinds. Re-tune here if a 5th tile is
// added later.

export type TileType = "mix" | "master" | "production" | "consult";

const KIND_TO_TILE: Record<string, TileType> = {
  mix: "mix",
  mixing: "mix",
  master: "master",
  mastering: "master",
  production: "production",
  producing: "production",
  album: "production",
  consult: "consult",
  session: "consult",
  other: "consult",
  custom: "consult",
  hourly: "consult",
  beat_lease: "consult",
};

export function kindToTile(kind: string): TileType {
  return KIND_TO_TILE[kind.toLowerCase()] ?? "consult";
}
