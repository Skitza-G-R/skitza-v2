import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decodeDescription, encodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";

// SK-49 — the producer wizard encodes revisions/contract terms into
// products.description after a "---" marker. Artist-facing reads must
// return only the human tagline, never the encoded block (it leaked
// onto the store cards).

const here = dirname(fileURLToPath(import.meta.url));
const artistSrc = readFileSync(join(here, "..", "artist.ts"), "utf8");

describe("artist.store description decoding (SK-49)", () => {
  it("both store reads return the decoded tagline, not the raw column", () => {
    const matches = artistSrc.match(
      /description: decodeDescription\((?:r|row)\.description\)\.tagline \|\| null/g,
    );
    expect(matches).toHaveLength(2);
    expect(artistSrc).toMatch(
      /from "~\/app\/\(producer\)\/dashboard\/store\/description-encoding"/,
    );
  });

  it("decode strips the encoded suffix the wizard writes", () => {
    const encoded = encodeDescription({
      tagline: "Full production from scratch.",
      revisions: 0,
      unlimitedRevisions: true,
      contractText: "Late cancellations forfeit the deposit.",
    });
    expect(encoded).toContain("---");
    expect(decodeDescription(encoded).tagline).toBe("Full production from scratch.");
  });
});
