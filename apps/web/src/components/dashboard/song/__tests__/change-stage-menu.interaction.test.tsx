// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeStageMenu } from "../change-stage-menu";

const mocks = vi.hoisted(() => ({
  online: true,
  refresh: vi.fn(),
  setTrackStageAction: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/upload-actions", () => ({
  setTrackStageAction: mocks.setTrackStageAction,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => mocks.online,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function installMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
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
    ),
  );
}

beforeEach(() => {
  mocks.online = true;
  mocks.refresh.mockReset();
  mocks.setTrackStageAction.mockReset();
  mocks.setTrackStageAction.mockResolvedValue({ ok: true });
  mocks.toast.mockReset();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return window.setTimeout(() => {
      callback(performance.now());
    }, 0);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChangeStageMenu interactions", () => {
  it("opens the mobile Sheet and invokes the selected workflow-stage action", async () => {
    installMatchMedia(false);
    const user = userEvent.setup();
    let finishAction: ((result: { ok: true }) => void) | undefined;
    mocks.setTrackStageAction.mockImplementation(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          finishAction = resolve;
        }),
    );

    render(
      <>
        <ChangeStageMenu trackId="track-1" current="mixing" />
        <button type="button">Outside control</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Mixing" });
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Change workflow stage" })).not.toBeNull();

    const options = screen.getByRole("group", { name: "Workflow stage options" });
    await user.click(within(options).getByRole("button", { name: "Production" }));

    await waitFor(() => {
      expect(mocks.setTrackStageAction).toHaveBeenCalledWith({
        trackId: "track-1",
        workflowStage: "production",
      });
    });
    expect(screen.queryByRole("dialog", { name: "Change workflow stage" })).toBeNull();
    await waitFor(() => {
      expect(trigger.getAttribute("aria-disabled")).toBe("true");
      expect(document.activeElement).toBe(trigger);
    });

    const outside = screen.getByRole("button", { name: "Outside control" });
    act(() => {
      outside.focus();
    });

    await act(async () => {
      finishAction?.({ ok: true });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(trigger.getAttribute("aria-disabled")).toBe("false");
      expect(document.activeElement).toBe(outside);
    });
  });

  it.each([
    ["mobile", false],
    ["desktop", true],
  ])(
    "closes a %s same-stage selection without a mutation and returns focus",
    async (_viewport, matches) => {
      installMatchMedia(matches);
      const user = userEvent.setup();

      render(<ChangeStageMenu trackId="track-1" current="mixing" />);

      const trigger = screen.getByRole("button", { name: "Mixing" });
      await user.click(trigger);
      const options = await screen.findByRole("group", { name: "Workflow stage options" });
      await user.click(within(options).getByRole("button", { name: "Mixing" }));

      expect(mocks.setTrackStageAction).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: "Change workflow stage" })).toBeNull();
      expect(screen.queryByRole("group", { name: "Workflow stage options" })).toBeNull();
      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
    },
  );

  it("uses native desktop controls and restores the trigger on Escape", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();

    render(<ChangeStageMenu trackId="track-1" current="mixing" />);

    const trigger = screen.getByRole("button", { name: "Mixing" });
    await user.click(trigger);

    expect(await screen.findByRole("group", { name: "Workflow stage options" })).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "Change workflow stage" })).toBeNull();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Brief & intake" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: "Workflow stage options" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the desktop disclosure when Tab moves outside without stealing focus", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();

    render(
      <>
        <ChangeStageMenu trackId="track-1" current="mixing" />
        <button type="button">Outside control</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Mixing" }));
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();

    const outside = screen.getByRole("button", { name: "Outside control" });
    expect(document.activeElement).toBe(outside);
    expect(screen.queryByRole("group", { name: "Workflow stage options" })).toBeNull();
  });
});
