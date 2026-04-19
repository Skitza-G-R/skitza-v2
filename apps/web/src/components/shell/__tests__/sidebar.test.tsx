import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "../sidebar";

describe("Sidebar NAV_ITEMS", () => {
  it("contains exactly 4 top-level items", () => {
    expect(NAV_ITEMS).toHaveLength(4);
  });

  it("has the 4 canonical labels in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Today", "Music", "Projects", "Setup"]);
  });

  it("maps each item to its route", () => {
    expect(NAV_ITEMS.find((i) => i.id === "today")?.href).toBe("/dashboard");
    expect(NAV_ITEMS.find((i) => i.id === "music")?.href).toBe("/dashboard/music");
    expect(NAV_ITEMS.find((i) => i.id === "projects")?.href).toBe("/dashboard/projects");
    expect(NAV_ITEMS.find((i) => i.id === "setup")?.href).toBe("/dashboard/settings");
  });
});
