import { describe, expect, it } from "vitest";

import { parseBankTransferDetails, serializeBankTransferDetails } from "../bank-transfer";

describe("onboarding bank-transfer serialization", () => {
  it("serializes non-empty fields in a stable, readable order", () => {
    expect(
      serializeBankTransferDetails({
        accountOwner: "  Gili Asraf ",
        bank: " Hapoalim ",
        branch: " 613 ",
        accountNumber: " 12-345678 ",
      }),
    ).toBe(
      [
        "Account owner: Gili Asraf",
        "Bank: Hapoalim",
        "Branch: 613",
        "Account number: 12-345678",
      ].join("\n"),
    );
  });

  it("allows every bank field to be empty", () => {
    expect(
      serializeBankTransferDetails({
        accountOwner: "",
        bank: " ",
        branch: "",
        accountNumber: "",
      }),
    ).toBe("");
  });

  it("hydrates the structured fields from the serialized value", () => {
    const raw = [
      "Account owner: Gili Asraf",
      "Bank: Hapoalim",
      "Branch: 613",
      "Account number: 12-345678",
    ].join("\n");

    expect(parseBankTransferDetails(raw)).toEqual({
      fields: {
        accountOwner: "Gili Asraf",
        bank: "Hapoalim",
        branch: "613",
        accountNumber: "12-345678",
      },
      preservedText: null,
    });
  });

  it("marks unknown legacy text for preservation", () => {
    expect(parseBankTransferDetails("Hapoalim 613 / 12-345678")).toEqual({
      fields: {
        accountOwner: "",
        bank: "",
        branch: "",
        accountNumber: "",
      },
      preservedText: "Hapoalim 613 / 12-345678",
    });
  });
});
