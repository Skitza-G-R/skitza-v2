// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LYRICS_MAX_LENGTH as SERVER_LYRICS_MAX_LENGTH } from "~/server/domain/song-management/service";

import {
  LYRICS_MAX_LENGTH,
  LyricsDialog,
  lyricsLineCount,
  type LyricsDialogProps,
} from "../lyrics-dialog";

afterEach(cleanup);

const STAMP = "2026-09-04T10:00:00.000Z";

function renderDialog(overrides: Partial<LyricsDialogProps> = {}) {
  const onSave = vi.fn<LyricsDialogProps["onSave"]>(() =>
    Promise.resolve({
      ok: true as const,
      lyrics: "saved words",
      lyricsUpdatedAtIso: "2026-09-04T12:00:00.000Z",
      lyricsUpdatedBy: "producer" as const,
    }),
  );
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const props: LyricsDialogProps = {
    open: true,
    onOpenChange,
    songTitle: "כתבה במאקו",
    lyrics: "one\ntwo",
    updatedAtIso: STAMP,
    updatedBy: "producer",
    viewerRole: "producer",
    otherPartyName: "יובל לוי",
    onSave,
    onSaved,
    ...overrides,
  };
  render(<LyricsDialog {...props} />);
  return { onSave: props.onSave, onOpenChange: props.onOpenChange, onSaved: props.onSaved };
}

// This repo ships no jest-dom matchers and tags nodes with `data-test`, which
// Testing Library's getByTestId does not read. Plain DOM queries throughout.
function node(test: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-test="${test}"]`);
  if (!found) throw new Error(`No [data-test="${test}"] in the document`);
  return found;
}
const missing = (test: string) => document.querySelector(`[data-test="${test}"]`) === null;
const textarea = () => screen.getByRole<HTMLTextAreaElement>("textbox");
const saveButton = () => node("lyrics-save") as HTMLButtonElement;

describe("LyricsDialog", () => {
  it("keeps the client cap identical to the one the server enforces", () => {
    // Two constants for one rule: the dialog cannot import the server module
    // without dragging it into the browser bundle. If they drift, a producer
    // types past the limit and the save is refused with no warning.
    expect(LYRICS_MAX_LENGTH).toBe(SERVER_LYRICS_MAX_LENGTH);
  });

  it("lets a Hebrew sheet pick its own direction", () => {
    renderDialog();
    // Without dir="auto" Hebrew lyrics render left-aligned and read wrong
    // inside the English UI.
    expect(textarea().getAttribute("dir")).toBe("auto");
  });

  it("cannot be saved by somebody who only opened it to read", () => {
    renderDialog();
    expect(saveButton().disabled).toBe(true);
  });

  it("enables saving as soon as the words actually change", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(textarea(), " three");
    expect(saveButton().disabled).toBe(false);
  });

  it("sends null rather than blank when the sheet is emptied", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();
    await user.clear(textarea());
    await user.click(saveButton());
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ lyrics: null, expectedUpdatedAtIso: STAMP });
    });
  });

  it("sends back the stamp it loaded, which is the whole clash guard", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();
    await user.type(textarea(), "!");
    await user.click(saveButton());
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        lyrics: "one\ntwo!",
        expectedUpdatedAtIso: STAMP,
      });
    });
  });

  it("refuses to close on a stray click while there are unsaved changes", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.type(textarea(), " more");
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(missing("lyrics-discard-notice")).toBe(false);
    // An inline bar, never a second dialog — a nested dialog renders under
    // the overlay in this codebase and the writer would see nothing.
    expect(document.querySelectorAll('[data-test="lyrics-dialog"]')).toHaveLength(1);

    await user.click(node("lyrics-discard"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes straight away when nothing was changed", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(missing("lyrics-discard-notice")).toBe(true);
  });

  describe("when the other side saved first", () => {
    const staleResult = {
      ok: false as const,
      reason: "stale" as const,
      lyrics: "their words",
      lyricsUpdatedAtIso: "2026-09-04T11:00:00.000Z",
      lyricsUpdatedBy: "artist" as const,
    };

    it("names them, and never clears what was typed", async () => {
      const user = userEvent.setup();
      renderDialog({ onSave: vi.fn(() => Promise.resolve(staleResult)) });
      await user.clear(textarea());
      await user.type(textarea(), "my words");
      await user.click(saveButton());

      await waitFor(() => {
        expect(missing("lyrics-stale-notice")).toBe(false);
      });
      expect(node("lyrics-stale-notice").textContent).toContain("יובל לוי");
      expect(textarea().value).toBe("my words");
    });

    it("does not report a save that never landed", async () => {
      const user = userEvent.setup();
      const { onSaved, onOpenChange } = renderDialog({
        onSave: vi.fn(() => Promise.resolve(staleResult)),
      });
      await user.type(textarea(), "!");
      await user.click(saveButton());

      await waitFor(() => {
        expect(missing("lyrics-stale-notice")).toBe(false);
      });
      expect(onSaved).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("swaps in their version when asked, and drops the warning", async () => {
      const user = userEvent.setup();
      renderDialog({ onSave: vi.fn(() => Promise.resolve(staleResult)) });
      await user.type(textarea(), "!");
      await user.click(saveButton());
      await waitFor(() => {
        expect(missing("lyrics-stale-notice")).toBe(false);
      });

      await user.click(node("lyrics-take-theirs"));
      expect(textarea().value).toBe("their words");
      expect(missing("lyrics-stale-notice")).toBe(true);
      // Their sheet is now the baseline, so there is nothing left to save.
      expect(saveButton().disabled).toBe(true);
    });

    it("re-sends with their stamp on save-mine-anyway, so the retry can win", async () => {
      const user = userEvent.setup();
      const onSave = vi
        .fn<LyricsDialogProps["onSave"]>()
        .mockResolvedValueOnce(staleResult)
        .mockResolvedValueOnce({
          ok: true,
          lyrics: "one\ntwo!",
          lyricsUpdatedAtIso: "2026-09-04T12:00:00.000Z",
          lyricsUpdatedBy: "producer",
        });
      const { onSaved } = renderDialog({ onSave });

      await user.type(textarea(), "!");
      await user.click(saveButton());
      await waitFor(() => {
        expect(missing("lyrics-stale-notice")).toBe(false);
      });

      await user.click(node("lyrics-save-anyway"));
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(2);
      });
      // The first attempt carried the stamp this editor loaded; the override
      // carries the one the refusal handed back.
      expect(onSave.mock.calls[0]?.[0].expectedUpdatedAtIso).toBe(STAMP);
      expect(onSave.mock.calls[1]?.[0]).toEqual({
        lyrics: "one\ntwo!",
        expectedUpdatedAtIso: "2026-09-04T11:00:00.000Z",
      });
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it("says so plainly when the same person saved from somewhere else", async () => {
      const user = userEvent.setup();
      renderDialog({
        onSave: vi.fn(() => Promise.resolve({ ...staleResult, lyricsUpdatedBy: "producer" as const })),
      });
      await user.type(textarea(), "!");
      await user.click(saveButton());
      await waitFor(() => {
        expect(node("lyrics-stale-notice").textContent).toContain(
          "changed somewhere else",
        );
      });
    });
  });

  it("surfaces a real failure without losing the words", async () => {
    const user = userEvent.setup();
    renderDialog({
      onSave: vi.fn(() =>
        Promise.resolve({ ok: false as const, reason: "error" as const, error: "Song not found." }),
      ),
    });
    await user.type(textarea(), "!");
    await user.click(saveButton());
    await waitFor(() => {
      expect(screen.queryByText("Song not found.")).not.toBeNull();
    });
    expect(textarea().value).toBe("one\ntwo!");
  });

  describe("the updated-by line", () => {
    it("says 'you' when this side wrote it last", () => {
      renderDialog();
      expect(node("lyrics-updated-label").textContent).toContain("Updated by you");
    });

    it("names the other side when they wrote it last", () => {
      renderDialog({ updatedBy: "artist" });
      expect(node("lyrics-updated-label").textContent).toContain(
        "Updated by יובל לוי",
      );
    });

    it("invites a first draft when nobody has written yet", () => {
      renderDialog({ lyrics: null, updatedAtIso: null, updatedBy: null });
      expect(node("lyrics-updated-label").textContent).toBe("Not written yet");
    });
  });

  it("only warns about the length once it is nearly reached", async () => {
    const user = userEvent.setup();
    renderDialog({ lyrics: "x".repeat(LYRICS_MAX_LENGTH - 501) });
    expect(screen.queryByText(/\/8000$/)).toBeNull();
    await user.type(textarea(), "x");
    expect(screen.queryByText(`${String(LYRICS_MAX_LENGTH - 500)}/8000`)).not.toBeNull();
  });
});

describe("lyricsLineCount", () => {
  it("counts the lines a person would count, blank ones included", () => {
    expect(lyricsLineCount("one\n\ntwo")).toBe(3);
  });

  it("reads an empty or missing sheet as no lines", () => {
    expect(lyricsLineCount(null)).toBe(0);
    expect(lyricsLineCount("   \n  ")).toBe(0);
  });
});
