import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/navigation's useRouter() panics outside an App Router context.
// We don't need real navigation here — the dynamic redirect is part
// of behaviour, exercised in Task 20's browser smoke. Stub useRouter
// to a no-op for the static render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

import { WaitlistForm } from "../waitlist-form";

// WaitlistForm is a "use client" component with state + transition.
// Behaviour (call action, handle result, redirect) is exercised at
// runtime + verified in Task 20's browser smoke test. These unit
// tests pin the structural contract that the design depends on:
//   - email input present, required, autocomplete=email
//   - honeypot field exists with display:none + aria-hidden
//   - submit button labeled per locale
//   - localized helper microcopy

describe("WaitlistForm — English", () => {
  const html = renderToStaticMarkup(
    <WaitlistForm locale="en" thanksHref="/get-started/thanks" />,
  );

  it("renders an email input that is required + autocomplete=email", () => {
    expect(html).toMatch(/type="email"/);
    expect(html).toMatch(/required/);
    expect(html).toMatch(/autoComplete|autocomplete="email"/i);
  });

  it("renders a submit button with English label", () => {
    expect(html).toMatch(/type="submit"/);
    expect(html).toMatch(/Get early access/);
  });

  it("includes a honeypot field with display:none and aria-hidden", () => {
    expect(html).toMatch(/name="company"/);
    // Style serialization: React renders {display: "none"} → style="display:none"
    expect(html).toMatch(/style="display:none"/);
    expect(html).toMatch(/aria-hidden="true"/);
  });
});

describe("WaitlistForm — Hebrew", () => {
  const html = renderToStaticMarkup(
    <WaitlistForm locale="he" thanksHref="/get-started/he/thanks" />,
  );

  it("renders the submit button with Hebrew label", () => {
    // "Get early access" → "גישה מוקדמת"
    expect(html).toMatch(/גישה מוקדמת/);
  });
});
