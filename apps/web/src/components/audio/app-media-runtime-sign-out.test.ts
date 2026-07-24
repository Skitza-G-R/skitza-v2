import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  useClerk: vi.fn(),
  useUser: vi.fn(),
}));
vi.mock("~/app/push-actions", () => ({
  unsubscribePushAction: vi.fn(),
}));
vi.mock("~/lib/audio/use-multipart-upload", () => ({
  cancelPersistedUploadsForAccount: vi.fn(),
  startMultipartCancellationRecovery: vi.fn(),
}));
vi.mock("~/components/ui/toast", () => ({
  useToast: vi.fn(),
}));

import { isClerkUserButtonSignOutTarget } from "./app-media-runtime";

const LEGACY_SIGN_OUT_SELECTOR =
  '[data-localization-key="userButtonPopoverActionSignOut"]';

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
