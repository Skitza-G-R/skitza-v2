import type { FocalItem } from "~/components/artist/home/focal-card";

// Round 4 — context-aware hero subline for /artist.
//
// The subline sits directly under the giant first-name in the hero
// ("lior."). It used to be a static one-liner keyed off `focal.kind`
// ("Your new mix is ready.", "All quiet."). Now it carries producer
// attribution + concrete data so the artist gets a useful snapshot
// of their studio life in a single sentence, before they even scan
// the focal card itself.
//
// The function is intentionally a pure string-builder — easy to test
// in node (no DOM, no React) and easy to evolve as new copy needs
// emerge. The `FocalItem` shape is the same discriminated union the
// focal card renders, so the subline and the focal card never
// disagree about which producer / amount / time they're describing.

export function buildSubline(input: {
  focal: FocalItem;
  studioCount: number;
}): string {
  const { focal, studioCount } = input;

  switch (focal.kind) {
    case "mix":
      return `Your new mix from ${focal.mix.producerName} is ready.`;
    case "payment":
      return `${focal.payment.amountFormatted} due to ${focal.payment.producerName}.`;
    case "session":
      return `Session with ${focal.session.producerName} this week.`;
    case "quiet": {
      if (studioCount === 0) {
        return "All quiet · no studios connected yet.";
      }
      const noun = studioCount === 1 ? "studio" : "studios";
      return `All quiet · ${String(studioCount)} ${noun} on tap.`;
    }
  }
}
