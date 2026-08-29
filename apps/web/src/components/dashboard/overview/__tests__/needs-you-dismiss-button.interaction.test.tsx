// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SK-284 — the source-contract test next door proves the right words are in the
// file. This one actually renders the button and clicks it, which is the only
// way to know the optimistic hide, the failure rollback, and Undo really work.

type AttentionResult = { ok: true } | { ok: false; error: string };
type AttentionAction = (input: { kind: string; subjectId: string }) => Promise<AttentionResult>;

const dismissAttentionRow = vi.fn<AttentionAction>();
const restoreAttentionRow = vi.fn<AttentionAction>();
const toast = vi.fn();
let online = true;

vi.mock("~/app/(producer)/dashboard/attention-actions", () => ({
  dismissAttentionRow,
  restoreAttentionRow,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => online,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast }),
}));

const { NeedsYouDismissButton } = await import("../needs-you-dismiss-button");

const DISMISS = { kind: "follow_up" as const, subjectId: "p-1" };

function setup() {
  const onDismissed = vi.fn();
  const onRestored = vi.fn();
  render(
    <NeedsYouDismissButton
      dismiss={DISMISS}
      title="2 finished sessions"
      meta="Lital · Album"
      onDismissed={onDismissed}
      onRestored={onRestored}
    />,
  );
  return { onDismissed, onRestored };
}

beforeEach(() => {
  online = true;
  dismissAttentionRow.mockReset();
  restoreAttentionRow.mockReset();
  toast.mockReset();
});

afterEach(cleanup);

describe("NeedsYouDismissButton (rendered)", () => {
  it("labels itself with the row it hides", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Hide 2 finished sessions — Lital · Album" }),
    ).toBeTruthy();
  });

  it("hides the row immediately and saves the dismissal", async () => {
    dismissAttentionRow.mockResolvedValue({ ok: true });
    const { onDismissed } = setup();

    await userEvent.click(screen.getByRole("button"));

    expect(onDismissed).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(dismissAttentionRow).toHaveBeenCalledWith(DISMISS);
    });
  });

  it("puts the row back and says why when the save fails", async () => {
    dismissAttentionRow.mockResolvedValue({ ok: false, error: "Couldn't hide that row." });
    const { onDismissed, onRestored } = setup();

    await userEvent.click(screen.getByRole("button"));

    expect(onDismissed).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      // The row must never stay hidden on a write that did not land.
      expect(onRestored).toHaveBeenCalledTimes(1);
    });
    expect(toast).toHaveBeenCalledWith("Couldn't hide that row.", "error");
  });

  it("offers Undo, and Undo deletes the dismissal", async () => {
    dismissAttentionRow.mockResolvedValue({ ok: true });
    restoreAttentionRow.mockResolvedValue({ ok: true });
    const { onRestored } = setup();

    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(toast).toHaveBeenCalled();
    });

    const [message, variant, options] = toast.mock.calls[0] as [
      string,
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Hidden until something changes");
    expect(variant).toBe("success");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();

    expect(onRestored).toHaveBeenCalled();
    await waitFor(() => {
      expect(restoreAttentionRow).toHaveBeenCalledWith(DISMISS);
    });
  });

  it("refuses while offline and never writes", async () => {
    online = false;
    const { onDismissed } = setup();

    await userEvent.click(screen.getByRole("button"));

    expect(dismissAttentionRow).not.toHaveBeenCalled();
    expect(onDismissed).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("You're offline. Reconnect to hide this.", "error");
  });
});
