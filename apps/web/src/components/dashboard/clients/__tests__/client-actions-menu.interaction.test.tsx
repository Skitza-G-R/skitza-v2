// @vitest-environment jsdom

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientActionsMenu } from "../client-actions-menu";

function installMatchMedia(matches: boolean) {
  const matchMedia = vi.fn(
    (media: string) =>
      ({
        matches,
        media,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      }) as MediaQueryList,
  );
  vi.stubGlobal("matchMedia", matchMedia);
  return matchMedia;
}

function ClientActionsHarness({
  archived,
  onEdit,
  onArchive,
}: {
  archived: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [dialog, setDialog] = useState<"edit" | "archive" | "restore" | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <ClientActionsMenu
        name="Maya Cohen"
        archived={archived}
        onActionStart={(trigger) => {
          returnFocusRef.current = trigger;
        }}
        onEdit={() => {
          onEdit();
          setDialog("edit");
        }}
        onArchive={() => {
          onArchive();
          setDialog(archived ? "restore" : "archive");
        }}
      />

      <DialogPrimitive.Root
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay />
          <DialogPrimitive.Content
            onCloseAutoFocus={(event) => {
              if (!returnFocusRef.current) return;
              event.preventDefault();
              returnFocusRef.current.focus();
            }}
          >
            <DialogPrimitive.Title>
              {dialog === "edit"
                ? "Edit client dialog"
                : dialog === "restore"
                  ? "Restore client dialog"
                  : "Archive client dialog"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description>Client action confirmation.</DialogPrimitive.Description>
            <input aria-label="Client dialog focus target" autoFocus />
            <DialogPrimitive.Close asChild>
              <button type="button">Close client dialog</button>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return window.setTimeout(() => {
      callback(performance.now());
    }, 0);
  });
});

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  vi.unstubAllGlobals();
});

describe("ClientActionsMenu interactions", () => {
  it("opens the mobile Sheet, invokes Edit, and hands focus to the Edit dialog", async () => {
    const matchMedia = installMatchMedia(false);
    const onEdit = vi.fn();
    const user = userEvent.setup();

    render(<ClientActionsHarness archived={false} onEdit={onEdit} onArchive={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Actions for Maya Cohen" });
    await user.click(trigger);

    expect(matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(await screen.findByTestId("client-actions-sheet")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit details" }));

    expect(onEdit).toHaveBeenCalledOnce();
    expect(await screen.findByRole("dialog", { name: "Edit client dialog" })).not.toBeNull();
    const focusTarget = screen.getByRole("textbox", { name: "Client dialog focus target" });
    await waitFor(() => {
      expect(document.activeElement).toBe(focusTarget);
    });
    expect(screen.queryByTestId("client-actions-sheet")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Close client dialog" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it.each([
    {
      archived: false,
      actionLabel: "Archive client",
      dialogName: "Archive client dialog",
    },
    {
      archived: true,
      actionLabel: "Restore client",
      dialogName: "Restore client dialog",
    },
  ])(
    "opens the mobile Sheet and invokes $actionLabel",
    async ({ archived, actionLabel, dialogName }) => {
      installMatchMedia(false);
      const onArchive = vi.fn();
      const user = userEvent.setup();

      render(<ClientActionsHarness archived={archived} onEdit={vi.fn()} onArchive={onArchive} />);

      await user.click(screen.getByRole("button", { name: "Actions for Maya Cohen" }));
      await user.click(screen.getByRole("button", { name: actionLabel }));

      expect(onArchive).toHaveBeenCalledOnce();
      const dialog = await screen.findByRole("dialog", { name: dialogName });
      expect(screen.queryByTestId("client-actions-sheet")).toBeNull();

      await user.click(within(dialog).getByRole("button", { name: "Close client dialog" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: dialogName })).toBeNull();
      });
    },
  );

  it("dismisses the mobile Sheet with Escape and returns focus to the trigger", async () => {
    installMatchMedia(false);
    const user = userEvent.setup();

    render(<ClientActionsHarness archived={false} onEdit={vi.fn()} onArchive={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Actions for Maya Cohen" });
    await user.click(trigger);
    expect(await screen.findByTestId("client-actions-sheet")).not.toBeNull();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByTestId("client-actions-sheet")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("keeps desktop actions native, closes on Escape, and restores trigger focus", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();

    render(<ClientActionsHarness archived={false} onEdit={vi.fn()} onArchive={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Actions for Maya Cohen" });
    await user.click(trigger);

    expect(await screen.findByTestId("client-actions-popover")).not.toBeNull();
    expect(screen.queryByTestId("client-actions-sheet")).toBeNull();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("client-actions-popover")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("closes the desktop disclosure when focus moves outside", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();

    render(
      <>
        <ClientActionsHarness archived={false} onEdit={vi.fn()} onArchive={vi.fn()} />
        <button type="button">Outside control</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Actions for Maya Cohen" }));
    expect(await screen.findByTestId("client-actions-popover")).not.toBeNull();

    const outside = screen.getByRole("button", { name: "Outside control" });
    act(() => {
      outside.focus();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("client-actions-popover")).toBeNull();
    });
    expect(document.activeElement).toBe(outside);
  });
});
