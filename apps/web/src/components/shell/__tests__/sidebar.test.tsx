import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "../sidebar";

describe("Sidebar NAV_ITEMS", () => {
  it("contains exactly 6 top-level items", () => {
    expect(NAV_ITEMS).toHaveLength(6);
  });

  it("has the 6 canonical labels in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Today",
      "Clients & Projects",
      "Music",
      "Calendar",
      "Profile",
      "Setup",
    ]);
  });

  it("maps each item to its route", () => {
    expect(NAV_ITEMS.find((i) => i.id === "today")?.href).toBe("/dashboard");
    expect(NAV_ITEMS.find((i) => i.id === "clients-projects")?.href).toBe("/dashboard/clients-projects");
    expect(NAV_ITEMS.find((i) => i.id === "music")?.href).toBe("/dashboard/music");
    expect(NAV_ITEMS.find((i) => i.id === "calendar")?.href).toBe("/dashboard/calendar");
    expect(NAV_ITEMS.find((i) => i.id === "profile")?.href).toBe("/dashboard/profile");
    expect(NAV_ITEMS.find((i) => i.id === "setup")?.href).toBe("/dashboard/settings");
  });

  it("assigns a G-leader shortcut to each item matching the global map", () => {
    expect(NAV_ITEMS.find((i) => i.id === "today")?.shortcut).toBe("G T");
    expect(NAV_ITEMS.find((i) => i.id === "clients-projects")?.shortcut).toBe("G P");
    expect(NAV_ITEMS.find((i) => i.id === "music")?.shortcut).toBe("G M");
    expect(NAV_ITEMS.find((i) => i.id === "calendar")?.shortcut).toBe("G C");
    expect(NAV_ITEMS.find((i) => i.id === "profile")?.shortcut).toBe("G F");
    expect(NAV_ITEMS.find((i) => i.id === "setup")?.shortcut).toBe("G S");
  });
});
