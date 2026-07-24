import { describe, expect, it, vi } from "vitest";

import { shareNative } from "./share";

describe("shareNative", () => {
  it("prefers the system share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const clipboard = { writeText: vi.fn() };

    await expect(
      shareNative({ title: "Mix", url: "https://example.com/mix" }, { share, clipboard }),
    ).resolves.toEqual({ status: "shared", method: "native" });
    expect(share).toHaveBeenCalledWith({
      title: "Mix",
      url: "https://example.com/mix",
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("does not copy after the user cancels the system sheet", async () => {
    const cancelled = Object.assign(new Error("cancelled"), {
      name: "AbortError",
    });
    const clipboard = { writeText: vi.fn() };

    await expect(
      shareNative(
        { url: "https://example.com/mix" },
        { share: vi.fn().mockRejectedValue(cancelled), clipboard },
      ),
    ).resolves.toEqual({ status: "cancelled", method: "native" });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies the URL when native sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      shareNative({ text: "Listen", url: "https://example.com/mix" }, { clipboard: { writeText } }),
    ).resolves.toEqual({ status: "copied", method: "clipboard" });
    expect(writeText).toHaveBeenCalledWith("https://example.com/mix");
  });

  it("checks file support before calling native share", async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const file = {} as File;

    await expect(
      shareNative(
        {
          files: [file],
          fallbackText: "https://example.com/download",
        },
        {
          share,
          canShare: vi.fn().mockReturnValue(false),
          clipboard: { writeText },
        },
      ),
    ).resolves.toEqual({ status: "copied", method: "clipboard" });
    expect(share).not.toHaveBeenCalled();
  });

  it("fails closed when neither share nor clipboard is available", async () => {
    await expect(shareNative({ url: "https://example.com/mix" }, {})).resolves.toEqual({
      status: "unavailable",
      method: "none",
    });
  });
});
