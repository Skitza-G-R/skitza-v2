import { describe, expect, it } from "vitest";

import { normalizedBetaEmail, parseBetaListInput, parsedBetaWave } from "./model";

describe("parseBetaListInput", () => {
  it("parses comma, tab, and semicolon lines with optional name and wave", () => {
    const result = parseBetaListInput(
      [
        "noa@example.com, Noa Levi, 2",
        "dan@example.com\tDan\t3",
        "maya@example.com;Maya",
        "solo@example.com",
      ].join("\n"),
    );

    expect(result.rows).toEqual([
      { email: "noa@example.com", name: "Noa Levi", wave: 2 },
      { email: "dan@example.com", name: "Dan", wave: 3 },
      { email: "maya@example.com", name: "Maya", wave: 1 },
      { email: "solo@example.com", name: null, wave: 1 },
    ]);
    expect(result.invalidLines).toEqual([]);
    expect(result.duplicates).toBe(0);
  });

  it("skips a header line and lowercases emails", () => {
    const result = parseBetaListInput("Email,Name,Wave\nNOA@Example.COM,Noa,1");

    expect(result.rows).toEqual([{ email: "noa@example.com", name: "Noa", wave: 1 }]);
    expect(result.invalidLines).toEqual([]);
  });

  it("rejects bad emails and bad waves but keeps parsing the rest", () => {
    const result = parseBetaListInput(
      "not-an-email\nnoa@example.com,Noa,zero\ndan@example.com",
    );

    expect(result.rows).toEqual([{ email: "dan@example.com", name: null, wave: 1 }]);
    expect(result.invalidLines).toEqual(["not-an-email", "noa@example.com,Noa,zero"]);
  });

  it("collapses duplicate emails keeping the first occurrence", () => {
    const result = parseBetaListInput("noa@example.com,Noa,1\nnoa@example.com,Other,2");

    expect(result.rows).toEqual([{ email: "noa@example.com", name: "Noa", wave: 1 }]);
    expect(result.duplicates).toBe(1);
  });
});

describe("normalizedBetaEmail", () => {
  it("normalizes case and whitespace, rejects junk", () => {
    expect(normalizedBetaEmail("  Noa@Example.COM ")).toBe("noa@example.com");
    expect(normalizedBetaEmail("nope")).toBeNull();
    expect(normalizedBetaEmail("")).toBeNull();
  });
});

describe("parsedBetaWave", () => {
  it("accepts integers 1-99 only", () => {
    expect(parsedBetaWave(3)).toBe(3);
    expect(parsedBetaWave(1)).toBe(1);
    expect(parsedBetaWave(0)).toBeNull();
    expect(parsedBetaWave(1.5)).toBeNull();
    expect(parsedBetaWave("2")).toBeNull();
    expect(parsedBetaWave(100)).toBeNull();
    expect(parsedBetaWave(undefined)).toBeNull();
  });
});
