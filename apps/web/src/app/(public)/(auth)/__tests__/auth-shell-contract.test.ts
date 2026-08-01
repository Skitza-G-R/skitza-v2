import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authLayoutSource = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");
const signInSource = readFileSync(
  new URL("../sign-in/[[...sign-in]]/page.tsx", import.meta.url),
  "utf8",
);
const signUpSource = readFileSync(
  new URL("../sign-up/[[...sign-up]]/page.tsx", import.meta.url),
  "utf8",
);
const rootLayoutSource = readFileSync(new URL("../../../layout.tsx", import.meta.url), "utf8");
const globalsSource = readFileSync(new URL("../../../globals.css", import.meta.url), "utf8");

describe("SK-152 auth presentation contract", () => {
  it("marks sign-in as a focused, role-neutral app entrance", () => {
    expect(signInSource).toContain('data-auth-page="sign-in"');
    expect(signInSource).toContain("Sign in to continue to Skitza.");
    expect(signInSource).not.toMatch(/your hall/i);
    expect(signInSource).toContain("postSignInResolverHref(requestedHref)");
    expect(signInSource).toContain("signUpSwitchHref(requestedHref)");
    expect(signInSource).toContain("joinSignUpMetadataFromTarget(requestedHref)");
    expect(signInSource).toContain(
      "{...(joinMetadata ? { unsafeMetadata: joinMetadata } : {})}",
    );
    expect(signInSource).toContain("signUpUrl={signUpHref}");
    expect(signInSource).toContain("fallbackRedirectUrl={resolverHref}");
    expect(signInSource).toContain("forceRedirectUrl={resolverHref}");
    expect(globalsSource).toContain(
      '.sk-auth-main:has([data-auth-page="sign-in"]) .sk-auth-form .cl-footer,',
    );
    expect(globalsSource).toContain(
      '.sk-auth-main:has([data-auth-page="sign-in"]) .sk-auth-form .cl-footerPagesRoot',
    );
  });

  it("marks producer sign-up for the intentional desktop marketing layout", () => {
    expect(signUpSource).toContain('data-auth-page="sign-up"');
    expect(signUpSource).toContain("shouldRedirectReturningDeviceToSignIn");
    expect(signUpSource).toContain("signInSwitchHref(requestedHref)");
    expect(signUpSource).toContain("signInUrl={signInHref}");
    expect(globalsSource).toContain('.sk-auth-main:has([data-auth-page="sign-up"])');
    expect(globalsSource).toContain("grid-template-columns: minmax(0, 1.05fr) minmax(27rem, 1fr)");
  });

  it("uses honest product workflow proof instead of unsupported vanity copy", () => {
    expect(authLayoutSource).toContain("Session booked");
    expect(authLayoutSource).toContain("New mix uploaded");
    expect(authLayoutSource).toContain("Payment cleared");
    expect(authLayoutSource).toContain("Built for independent producers");
    expect(authLayoutSource).not.toMatch(/2,400|Tel-Aviv|Berlin|Lagos|Atlanta|Seoul/);
  });

  it("follows saved/system theme and gives standalone mode app affordances", () => {
    expect(globalsSource).toContain('html[data-theme="chrome-dark"] .sk-auth-shell');
    expect(globalsSource).toContain("@media (display-mode: standalone)");
    expect(globalsSource).toContain(".sk-auth-browser-only");
    expect(globalsSource).toContain(".sk-auth-standalone-only");
    expect(globalsSource).toContain('[data-auth-page="role-choice"]');
  });

  it("lets Clerk resolve the same semantic colors as the auth shell", () => {
    expect(rootLayoutSource).toContain('colorBackground: "rgb(var(--bg-elevated))"');
    expect(rootLayoutSource).toContain('colorText: "rgb(var(--fg-default))"');
    expect(rootLayoutSource).toContain('colorPrimary: "rgb(var(--brand-primary))"');
    expect(globalsSource).toContain(
      ".sk-auth-form .cl-formButtonPrimary {\n  color: rgb(var(--fg-on-brand)) !important;",
    );
    expect(rootLayoutSource).not.toContain('colorBackground: "#FFFFFF"');
  });
});
