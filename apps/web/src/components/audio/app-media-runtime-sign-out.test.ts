import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelManagedUploadsForAccount: vi.fn(),
  cancelPersistedUploadsForAccount: vi.fn(),
  clerkSignOut: vi.fn(),
  clearAccountPrivateRuntimeState: vi.fn(),
  clearBrowserPushSubscription: vi.fn(),
  clearPlaybackForAccount: vi.fn(),
  releaseManagedUploadsForAccount: vi.fn(),
  startMultipartCancellationRecovery: vi.fn(),
  toast: vi.fn(),
  unsubscribePushAction: vi.fn(),
  useClerk: vi.fn(),
  useToast: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
  };
});
vi.mock("@clerk/nextjs", () => ({
  useClerk: mocks.useClerk,
  useUser: mocks.useUser,
}));
vi.mock("~/app/push-actions", () => ({
  unsubscribePushAction: mocks.unsubscribePushAction,
}));
vi.mock("~/lib/audio/upload-manager", () => ({
  cancelManagedUpload: vi.fn(),
  cancelManagedUploadsForAccount: mocks.cancelManagedUploadsForAccount,
  hasActiveManagedUploads: vi.fn(() => false),
  managedUploadIsActive: vi.fn(() => false),
  releaseManagedUploadsForAccount: mocks.releaseManagedUploadsForAccount,
  retryManagedUpload: vi.fn(),
  setUploadRuntimeAccountId: vi.fn(),
  useManagedUploads: vi.fn(() => []),
}));
vi.mock("~/lib/audio/use-multipart-upload", () => ({
  cancelPersistedUploadsForAccount: mocks.cancelPersistedUploadsForAccount,
  startMultipartCancellationRecovery: mocks.startMultipartCancellationRecovery,
}));
vi.mock("~/lib/push/browser-subscription", () => ({
  clearBrowserPushSubscription: mocks.clearBrowserPushSubscription,
}));
vi.mock("~/lib/runtime-state/account-exit", () => ({
  clearAccountPrivateRuntimeState: mocks.clearAccountPrivateRuntimeState,
}));
vi.mock("~/components/ui/toast", () => ({
  useToast: mocks.useToast,
}));
vi.mock("./playback-runtime", () => ({
  AppPlaybackRuntime: vi.fn(() => null),
  clearPlaybackForAccount: mocks.clearPlaybackForAccount,
  usePlaybackSnapshot: vi.fn(() => ({ track: null })),
}));

import { isClerkUserButtonSignOutTarget, useSafeSignOut } from "./app-media-runtime";

const LEGACY_SIGN_OUT_SELECTOR =
  '[data-localization-key="userButtonPopoverActionSignOut"]';
const SIGN_OUT_BOUNDARY_MESSAGE =
  "Couldn’t safely sign out because browser notifications are still active. Try again.";

class TestDomElement extends EventTarget {
  private readonly children: TestDomElement[] = [];
  private parentElement: TestDomElement | null = null;

  constructor(
    private readonly tagName: string,
    private readonly options: {
      classes?: string[];
      attributes?: Record<string, string>;
      text?: string;
    } = {},
  ) {
    super();
  }

  append(child: TestDomElement): TestDomElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  get textContent(): string {
    return `${this.options.text ?? ""}${this.children
      .map((child) => child.textContent)
      .join("")}`;
  }

  closest(selector: string): TestDomElement | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  private matches(selector: string): boolean {
    if (selector === "button") return this.tagName === "button";
    if (selector === ".cl-userButtonPopoverCard") {
      return this.options.classes?.includes("cl-userButtonPopoverCard") ?? false;
    }
    if (selector === ".cl-userButtonPopoverActionButton__signOut") {
      return (
        this.options.classes?.includes("cl-userButtonPopoverActionButton__signOut") ??
        false
      );
    }
    if (selector === LEGACY_SIGN_OUT_SELECTOR) {
      return (
        this.options.attributes?.["data-localization-key"] ===
        "userButtonPopoverActionSignOut"
      );
    }
    return false;
  }
}

describe("safe explicit sign-out", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.useClerk.mockReturnValue({ signOut: mocks.clerkSignOut });
    mocks.useUser.mockReturnValue({ isLoaded: false, user: undefined });
    mocks.useToast.mockReturnValue({ toast: mocks.toast });
    mocks.clearBrowserPushSubscription.mockResolvedValue("no-subscription");
    mocks.cancelManagedUploadsForAccount.mockResolvedValue(true);
    mocks.cancelPersistedUploadsForAccount.mockResolvedValue(true);
    mocks.clearPlaybackForAccount.mockResolvedValue(undefined);
  });

  it("rejects without cleanup or Clerk sign-out when the account ID is unavailable", async () => {
    const signOut = useSafeSignOut();

    await expect(signOut()).rejects.toThrow(SIGN_OUT_BOUNDARY_MESSAGE);

    expect(mocks.toast).toHaveBeenCalledWith(SIGN_OUT_BOUNDARY_MESSAGE, "error", {
      durationMs: 8000,
    });
    expect(mocks.clearBrowserPushSubscription).not.toHaveBeenCalled();
    expect(mocks.clearAccountPrivateRuntimeState).not.toHaveBeenCalled();
    expect(mocks.cancelManagedUploadsForAccount).not.toHaveBeenCalled();
    expect(mocks.clerkSignOut).not.toHaveBeenCalled();
  });

  it("awaits every account-exit stage before Clerk sign-out", async () => {
    const timeline: string[] = [];
    mocks.useUser.mockReturnValue({
      isLoaded: true,
      user: { id: "user_safe_sign_out" },
    });
    mocks.clearBrowserPushSubscription.mockImplementation(() => {
      timeline.push("push");
      return Promise.resolve("no-subscription");
    });
    mocks.clearAccountPrivateRuntimeState.mockImplementation(() => {
      timeline.push("private-state");
    });
    mocks.cancelManagedUploadsForAccount.mockImplementation(() => {
      timeline.push("managed-uploads");
      return Promise.resolve(true);
    });
    mocks.cancelPersistedUploadsForAccount.mockImplementation(() => {
      timeline.push("persisted-uploads");
      return Promise.resolve(true);
    });
    mocks.clearPlaybackForAccount.mockImplementation(() => {
      timeline.push("playback");
      return Promise.resolve();
    });
    mocks.releaseManagedUploadsForAccount.mockImplementation(() => {
      timeline.push("release");
    });
    mocks.clerkSignOut.mockImplementation(() => {
      timeline.push("clerk");
      return Promise.resolve();
    });
    const signOut = useSafeSignOut();

    await signOut({ redirectUrl: "/" });

    expect(timeline).toEqual([
      "push",
      "private-state",
      "managed-uploads",
      "persisted-uploads",
      "playback",
      "release",
      "clerk",
    ]);
  });
});

describe("Clerk UserButton sign-out DOM target", () => {
  beforeAll(() => {
    vi.stubGlobal("Element", TestDomElement);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes the live plain button only inside the Clerk UserButton popover", () => {
    const popover = new TestDomElement("div", {
      classes: ["cl-userButtonPopoverCard"],
    });
    const signOutButton = popover.append(new TestDomElement("button"));
    const signOutLabel = signOutButton.append(
      new TestDomElement("span", { text: "Sign out" }),
    );

    const unrelatedButton = new TestDomElement("button");
    const unrelatedLabel = unrelatedButton.append(
      new TestDomElement("span", { text: "Sign out" }),
    );

    expect(isClerkUserButtonSignOutTarget(signOutLabel)).toBe(true);
    expect(isClerkUserButtonSignOutTarget(unrelatedLabel)).toBe(false);
  });

  it("continues to recognize Clerk's legacy localization marker", () => {
    const legacyButton = new TestDomElement("button", {
      attributes: {
        "data-localization-key": "userButtonPopoverActionSignOut",
      },
    });
    const nestedIcon = legacyButton.append(new TestDomElement("svg"));

    expect(isClerkUserButtonSignOutTarget(nestedIcon)).toBe(true);
  });

  it("recognizes Clerk's sign-out action class", () => {
    const signOutButton = new TestDomElement("button", {
      classes: ["cl-userButtonPopoverActionButton__signOut"],
    });
    const nestedIcon = signOutButton.append(new TestDomElement("svg"));

    expect(isClerkUserButtonSignOutTarget(nestedIcon)).toBe(true);
  });
});
