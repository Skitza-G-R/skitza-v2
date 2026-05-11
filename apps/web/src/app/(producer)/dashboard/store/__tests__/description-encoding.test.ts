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
      contractText: "",
    });
  });

  it("returns empty fields for empty string", () => {
    expect(decodeDescription("")).toEqual({
      tagline: "",
      revisions: 0,
      contractText: "",
    });
  });

  it("returns just the tagline when no meta block is present", () => {
    expect(decodeDescription("Just a tagline")).toEqual({
      tagline: "Just a tagline",
      revisions: 0,
      contractText: "",
    });
  });

  it("decodes a tagline + revisions only (no contract text)", () => {
    const encoded = "My tagline\n---\nrevisions: 3\ncontract_text: ";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "My tagline",
      revisions: 3,
      contractText: "",
    });
  });

  it("decodes a tagline + revisions + single-line contract text", () => {
    const encoded =
      "Mix package\n---\nrevisions: 2\ncontract_text: 50% deposit, balance on delivery.";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "Mix package",
      revisions: 2,
      contractText: "50% deposit, balance on delivery.",
    });
  });

  it("decodes a tagline + multi-line contract text", () => {
    const encoded =
      "Full production\n---\nrevisions: 5\ncontract_text: Line one of terms.\nLine two of terms.\nLine three with semicolons; and: colons.";
    expect(decodeDescription(encoded)).toEqual({
      tagline: "Full production",
      revisions: 5,
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
      contractText: "terms here",
    });
  });
});

describe("encodeDescription", () => {
  it("returns just the tagline when revisions=0 and contractText empty", () => {
    expect(
      encodeDescription({
        tagline: "Plain tagline",
        revisions: 0,
        contractText: "",
      }),
    ).toBe("Plain tagline");
  });

  it("treats whitespace-only contractText as no meta", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 0,
        contractText: "   \n  ",
      }),
    ).toBe("Tagline");
  });

  it("emits a meta block when revisions > 0", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 4,
        contractText: "",
      }),
    ).toBe("Tagline\n---\nrevisions: 4\ncontract_text: ");
  });

  it("emits a meta block when contractText is set", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 0,
        contractText: "Some terms.",
      }),
    ).toBe("Tagline\n---\nrevisions: 0\ncontract_text: Some terms.");
  });

  it("handles a multi-line contract text", () => {
    expect(
      encodeDescription({
        tagline: "Tagline",
        revisions: 2,
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
      contractText: "Full payment due 7 days before session.",
    };
    expect(decodeDescription(encodeDescription(fields))).toEqual(fields);
  });

  it("preserves multi-line contract text and tagline", () => {
    const fields = {
      tagline: "Tagline line 1\nTagline line 2",
      revisions: 2,
      contractText: "Terms line 1\nTerms line 2\nTerms line 3",
    };
    expect(decodeDescription(encodeDescription(fields))).toEqual(fields);
  });

  it("preserves a bare tagline (no meta block)", () => {
    const fields = {
      tagline: "Just a tagline",
      revisions: 0,
      contractText: "",
    };
    expect(decodeDescription(encodeDescription(fields))).toEqual(fields);
  });
});
