import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  NativeAction,
  NativeIconAction,
  NativeInput,
  NativeTextarea,
  resolveNativeKeyboardProps,
} from "../native-actions";
import { NativeActionStatus } from "../native-action-status";

describe("native action and input primitives", () => {
  it("keeps text actions comfortable and resilient to larger text", () => {
    const html = renderToStaticMarkup(<NativeAction>Save changes</NativeAction>);

    expect(html).toContain("min-h-11");
    expect(html).toContain("h-auto");
    expect(html).toContain("whitespace-normal");
    expect(html).toContain("rounded-[var(--radius-lg)]");
  });

  it("requires and renders an accessible label for icon-only actions", () => {
    const html = renderToStaticMarkup(
      <NativeIconAction aria-label="Close">
        <span aria-hidden>×</span>
      </NativeIconAction>,
    );

    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("min-w-11");
    expect(html).toContain("rounded-full");
  });

  it("selects the expected mobile keyboard without number-input spinners", () => {
    expect(resolveNativeKeyboardProps("email")).toMatchObject({
      type: "email",
      inputMode: "email",
      autoCapitalize: "none",
      autoCorrect: "off",
    });
    expect(resolveNativeKeyboardProps("decimal")).toMatchObject({
      type: "text",
      inputMode: "decimal",
    });

    const html = renderToStaticMarkup(<NativeInput keyboard="telephone" aria-label="Phone" />);
    expect(html).toContain('type="tel"');
    expect(html).toContain('inputMode="tel"');
    expect(html).toContain("sk-native-field");
    expect(html).toContain('data-native-input="telephone"');
  });

  it("lets textarea and input heights grow with zoomed text", () => {
    const html = renderToStaticMarkup(
      <>
        <NativeInput aria-label="Name" />
        <NativeTextarea aria-label="Notes" />
      </>,
    );

    expect(html).toContain("sk-native-field h-auto");
    expect(html).toContain("min-h-24");
  });
});

describe("NativeActionStatus", () => {
  it("announces errors assertively beside the failed action", () => {
    const html = renderToStaticMarkup(
      <NativeActionStatus state="error" message="Could not save" />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('data-native-status="error"');
    expect(html).toContain("Could not save");
  });

  it("exposes determinate progress semantics", () => {
    const html = renderToStaticMarkup(
      <NativeActionStatus state="progress" message="Uploading" progress={42} />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain("width:42%");
  });

  it("does not add an empty live region while idle", () => {
    expect(renderToStaticMarkup(<NativeActionStatus state="idle" />)).toBe("");
  });
});
