// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientInviteActionResult } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

import type { LinkPillState } from "../client-invitation-state";
import { InviteToAppModal } from "../invite-modal";

type SendInviteAction = (input: {
  id: string;
  via: "email" | "link";
  operationKey: string;
}) => Promise<ClientInviteActionResult>;

const mocks = vi.hoisted(() => ({
  copy: vi.fn<(text: string) => Promise<void>>(),
  open: vi.fn<typeof window.open>(),
  send: vi.fn<SendInviteAction>(),
  toast: vi.fn<(message: string, kind: "success" | "error" | "info") => void>(),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/clients-actions", () => ({
  sendClientInviteAction: mocks.send,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const client = {
  id: "00000000-0000-4000-8000-000000000255",
  name: "Maya Cohen",
  email: "maya@example.com",
  gradient: "linear-gradient(#111, #222)",
};

function renderModal(invitationState: LinkPillState = "none") {
  const onClose = vi.fn();
  const onSent = vi.fn();
  render(
    <InviteToAppModal
      open
      onClose={onClose}
      client={client}
      producerSlug="north-room"
      invitationState={invitationState}
      onSent={onSent}
    />,
  );
  return { onClose, onSent };
}

beforeEach(() => {
  mocks.copy.mockReset().mockResolvedValue(undefined);
  mocks.open.mockReset().mockReturnValue(null);
  mocks.send.mockReset();
  mocks.toast.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy },
  });
  vi.stubGlobal("open", mocks.open);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InviteToAppModal invitation evidence", () => {
  it("makes a later provider-accepted email an explicit resend without acting before click", async () => {
    mocks.send.mockResolvedValueOnce({
      ok: true,
      data: {
        via: "email",
        deliveryState: "provider_accepted",
        providerAcceptedAtIso: "2026-08-20T08:00:00.000Z",
      },
    });
    const user = userEvent.setup();
    const { onSent } = renderModal("pending");

    const resend = screen.getByRole("button", { name: "Resend invite email" });
    expect(screen.getByRole("button", { name: "Share on WhatsApp" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeTruthy();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();

    await user.click(resend);
    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledTimes(1);
    });
  });

  it("reuses one operation key after an ordinary failure", async () => {
    mocks.send
      .mockResolvedValueOnce({ ok: false, error: "Temporary provider problem." })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          via: "email",
          deliveryState: "provider_accepted",
          providerAcceptedAtIso: "2026-08-20T08:00:00.000Z",
        },
      });
    const user = userEvent.setup();
    const { onClose, onSent } = renderModal();
    const sendButton = screen.getByRole("button", { name: "Send invite email" });

    await user.click(sendButton);
    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledTimes(1);
    });
    const firstKey = mocks.send.mock.calls[0]?.[0].operationKey;
    expect(firstKey).toBeTruthy();
    expect(onSent).not.toHaveBeenCalled();

    await user.click(sendButton);
    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledTimes(2);
    });

    expect(mocks.send.mock.calls[1]?.[0].operationKey).toBe(firstKey);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps an in-flight send neutral and reuses its operation key", async () => {
    mocks.send
      .mockResolvedValueOnce({
        ok: true,
        data: { via: "email", deliveryState: "sending", providerAcceptedAtIso: null },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          via: "email",
          deliveryState: "provider_accepted",
          providerAcceptedAtIso: "2026-08-20T08:01:00.000Z",
        },
      });
    const user = userEvent.setup();
    const { onClose, onSent } = renderModal();

    await user.click(screen.getByRole("button", { name: "Send invite email" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Check send status" })).not.toBeNull();
    });
    const firstKey = mocks.send.mock.calls[0]?.[0].operationKey;
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText("The invitation is still sending. Check again in a moment."),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Check send status" }));
    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledTimes(2);
    });

    expect(mocks.send.mock.calls[1]?.[0].operationKey).toBe(firstKey);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("does not claim Invited without both provider acceptance signals", async () => {
    const malformedProviderResult = {
      ok: true,
      data: {
        via: "email",
        deliveryState: "provider_accepted",
        providerAcceptedAtIso: null,
      },
    } as unknown as ClientInviteActionResult;
    mocks.send.mockResolvedValueOnce(malformedProviderResult);
    const user = userEvent.setup();
    const { onClose, onSent } = renderModal();

    await user.click(screen.getByRole("button", { name: "Send invite email" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Check send status" })).not.toBeNull();
    });

    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("waits for a new deliberate click before rotating an expired operation", async () => {
    mocks.send
      .mockResolvedValueOnce({
        ok: false,
        error: "This send can’t be retried. Choose Try a new send.",
        code: "new_operation_required",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          via: "email",
          deliveryState: "provider_accepted",
          providerAcceptedAtIso: "2026-08-20T08:02:00.000Z",
        },
      });
    const user = userEvent.setup();
    const { onSent } = renderModal();

    await user.click(screen.getByRole("button", { name: "Send invite email" }));
    const retryButton = await screen.findByRole("button", { name: "Try a new send" });
    const firstKey = mocks.send.mock.calls[0]?.[0].operationKey;

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();

    await user.click(retryButton);
    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledTimes(2);
    });

    expect(mocks.send.mock.calls[1]?.[0].operationKey).not.toBe(firstKey);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("copies a link without creating Invited evidence", async () => {
    mocks.send.mockResolvedValueOnce({
      ok: true,
      data: { via: "link", deliveryState: null, providerAcceptedAtIso: null },
    });
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { onClose, onSent } = renderModal();

    await user.click(screen.getByRole("button", { name: "Copy invite link" }));
    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({ id: client.id, via: "link" });
    expect(mocks.send.mock.calls[0]?.[0].operationKey).toBeTruthy();
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens WhatsApp only after a deliberate click without creating invitation evidence", async () => {
    const user = userEvent.setup();
    const { onClose, onSent } = renderModal();

    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Share on WhatsApp" }));

    expect(mocks.open).toHaveBeenCalledTimes(1);
    const [shareUrl, target, features] = mocks.open.mock.calls[0] ?? [];
    expect(shareUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(String(shareUrl))).toContain(
      "https://skitza.app/sign-up/join/north-room/home",
    );
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
