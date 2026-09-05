// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MOCK_PRODUCER, MOCK_PRODUCT } from "../pay-data";
import { buildAgreementTerms } from "../purchase-data";
import { ReviewAgreeScreen } from "../review-agree-screen";

// SK-298: the onboarding simulation shows this screen in its accepted state,
// so a storyboard frame reads "she accepted" instead of an empty checkbox.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

function renderGallery(defaultAccepted?: boolean) {
  render(
    <ReviewAgreeScreen
      product={MOCK_PRODUCT}
      producer={MOCK_PRODUCER}
      terms={buildAgreementTerms(MOCK_PRODUCER.name, MOCK_PRODUCT.includes)}
      previewSentHref="#simulation"
      {...(defaultAccepted === undefined ? {} : { defaultAccepted })}
    />,
  );
  return screen.getByRole("button", { name: /Accept exact agreement/ });
}

afterEach(() => {
  cleanup();
});

describe("ReviewAgreeScreen defaultAccepted (SK-298)", () => {
  it("starts unaccepted with the call to action disabled", () => {
    const cta = renderGallery();
    expect(cta.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Accept the exact agreement to continue")).toBeTruthy();
  });

  it("starts accepted with the call to action enabled", () => {
    const cta = renderGallery(true);
    expect(cta.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("Creates the purchase with these frozen terms")).toBeTruthy();
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  });
});
