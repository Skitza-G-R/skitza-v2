import { describe, expect, it } from "vitest";

import {
  decodeDescription,
  encodeDescription,
} from "../description-encoding";

describe("decodeDescription", () => {
  it("returns empty fields for null input", () => {
    expect(decodeDescription(null)).toEqual({
      tagline: "",
      revisions: 0,
      unlimitedRevisions: false,
      contractText: "",
    });
  });

  it("returns empty fields for empty string", () => {
    expect(decodeDescription("")).toEqual({
      tagline: "",
      revisions: 0,
      unlimitedRevisions: false,
      contractText: "",
    });
  });

  it("returns just the tagline when no meta block is present", () => {
    expect(decodeDescription("Just a tagline")).toEqual({
      tagline: "Just a tagline",
      revisions: 0,
      unlimitedRevisions: false,
      contractText: "",
    });
  });

  it("decodes a tagline + revisions only (no contract text)", () => {
    const encoded = "My tagline\n---\nrevisions: 3\ncontract_text: ";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "My tagline",
      revisions: 3,
      unlimitedRevisions: false,
      contractText: "",
    });
  });

  it("decodes a tagline + revisions + single-line contract text", () => {
    const encoded =
      "Mix package\n---\nrevisions: 2\ncontract_text: 50% deposit, balance on delivery.";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "Mix package",
      revisions: 2,
      unlimitedRevisions: false,
      contractText: "50% deposit, balance on delivery.",
    });
  });

  it("decodes a tagline + multi-line contract text", () => {
    const encoded =
      "Full production\n---\nrevisions: 5\ncontract_text: Line one of terms.\nLine two of terms.\nLine three with semicolons; and: colons.";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "Full production",
      revisions: 5,
      unlimitedRevisions: false,
      contractText:
        "Line one of terms.\nLine two of terms.\nLine three with semicolons; and: colons.",
    });
  });

  it("decodes a multi-line tagline (newline-separated lead) correctly", () => {
    const encoded =
      "Line A\nLine B\n---\nrevisions: 1\ncontract_text: terms here";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "Line A\nLine B",
      revisions: 1,
      unlimitedRevisions: false,
      contractText: "terms here",
    });
  });

  it("decodes 'revisions: unlimited' into the flag", () => {
    const encoded = "foo\n---\nrevisions: unlimited\ncontract_text: ";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "foo",
      revisions: 0,
      unlimitedRevisions: true,
      contractText: "",
    });
  });

  it("decodes 'revisions: unlimited' alongside contract text", () => {
    const encoded =
      "Mix\n---\nrevisions: unlimited\ncontract_text: 50% deposit.";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "Mix",
      revisions: 0,
      unlimitedRevisions: true,
      contractText: "50% deposit.",
    });
  });
});

describe("encodeDescription", () => {
  it("returns just the tagline when revisions=0, no unlimited, and contractText empty", () => {
    expect(
      encodeDescription({
        tagline: "Plain tagline",
        revisions: 0,
        unlimitedRevisions: false,
        contractText: "",
      }),
    ).toBe("Plain tagline");
  });

  it("treats whitespace-only contractText as no meta", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 0,
        unlimitedRevisions: false,
        contractText: "   \n  ",
      }),
    ).toBe("Tagline");
  });

  it("emits a meta block when revisions > 0", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 4,
        unlimitedRevisions: false,
        contractText: "",
      }),
    ).toBe("Tagline\n---\nrevisions: 4\ncontract_text: ");
  });

  it("emits 'revisions: unlimited' when the flag is set", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 0,
        unlimitedRevisions: true,
        contractText: "",
      }),
    ).toBe("Tagline\n---\nrevisions: unlimited\ncontract_text: ");
  });

  it("emits a meta block when contractText is set", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 0,
        unlimitedRevisions: false,
        contractText: "Some terms.",
      }),
    ).toBe("Tagline\n---\nrevisions: 0\ncontract_text: Some terms.");
  });

  it("handles a multi-line contract text", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 2,
        unlimitedRevisions: false,
        contractText: "Line 1\nLine 2",
      }),
    ).toBe("Tagline\n---\nrevisions: 2\ncontract_text: Line 1\nLine 2");
  });
});

describe("round-trip lossless", () => {
  it("preserves all fields for a fully-populated input", () => {
    const fields = {
      tagline: "A short tagline.",
      revisions: 3,
      unlimitedRevisions: false,
      contractText: "Full payment due 7 days before session.",
    };
    expect(decodeDescription(encodeDescription(fields))).toEqual(fields);
  });

  it("preserves multi-line contract text and tagline", () => {
    const fields = {
      tagline: "Tagline line 1\nTagline line 2",
      revisions: 2,
      unlimitedRevisions: false,
      contractText: "Terms line 1\nTerms line 2\nTerms line 3",
    };
    expect(decodeDescription(encodeDescription(fields))).toEqual(fields);
  });

  it("preserves a bare tagline (no meta block)", () => {
    const fields = {
      tagline: "Just a tagline",
      revisions: 0,
      unlimitedRevisions: false,
      contractText: "",
    };
    expect(decodeDescription(encodeDescription(fields))).toEqual(fields);
  });

  it("preserves the unlimitedRevisions flag", () => {
    const fields = {
      tagline: "Mix",
      revisions: 0,
      unlimitedRevisions: true,
      contractText: "",
    };
    expect(decodeDescription(encodeDescription(fields))).toEqual(fields);
  });

  it("preserves unlimitedRevisions alongside contract text", () => {
    const fields = {
      tagline: "Mix",
      revisions: 0,
      unlimitedRevisions: true,
      contractText: "50% deposit, balance on delivery.",
    };
    expect(decodeDescription(encodeDescription(fields))).toEqual(fields);
  });
});
