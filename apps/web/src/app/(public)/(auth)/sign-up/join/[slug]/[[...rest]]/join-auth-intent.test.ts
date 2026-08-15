import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  joinSignInHref,
  joinSignUpMetadataFromTarget,
  normalizeSameOriginPostSignInTarget,
} from "~/server/auth/post-sign-in";
import { signUpSwitchHref } from "~/server/auth/returning-device";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const signInSource = readFileSync(
  new URL("../../../../sign-in/[[...sign-in]]/page.tsx", import.meta.url),
  "utf8",
);

describe("join-aware Clerk authentication", () => {
  it("preserves the producer slug and booking action when switching to sign-in", () => {
    expect(source).toContain("joinSignInHref(slug, action, offerId)");
    expect(source).toContain("signInUrl={signInHref}");
    expect(source).not.toContain('signInUrl="/sign-in"');
  });

  it("forces every Clerk verification and OAuth completion back to the join continuation", () => {
    expect(source).toContain("joinContinuationHref(slug, action, offerId)");
    expect(source).not.toContain('action === "home" ? "store" : action');
    expect(source).toContain("forceRedirectUrl={postSignUpContinuationHref}");
  });

  it("keeps explicit Book, Home, and Unlock distinct from the legacy Home continuation", () => {
    expect(source).toContain('rest?.[0] === "book"');
    expect(source).toContain('rest?.[0] === "unlock"');
    expect(source).toContain('rest?.[0] === "home"');
    expect(source).toContain('explicitAction === "book"');
    expect(source).toContain('? "/book"');
    expect(source).toContain('explicitAction === "unlock"');
    expect(source).toContain('? "/unlock"');
    expect(source).toContain('explicitAction === "home"');
    expect(source).toContain('? "/home"');
    expect(source).toContain('rest?.[0] === "offer"');
    expect(source).toContain('`/offer/${offerId}`');
  });

  it("preserves the Artist slug through Sign up → Sign in → Sign up", () => {
    const signInHref = new URL(
      joinSignInHref("northline-studio"),
      "https://skitza.invalid",
    );
    const continuation = signInHref.searchParams.get("redirect_url");

    expect(continuation).toBe(
      "/join/northline-studio/continue?action=book",
    );
    expect(signUpSwitchHref(continuation)).toBe(
      "/sign-up/join/northline-studio/book?intent=signup",
    );
    expect(source).toContain(
      'unsafeMetadata={{ signupOrigin: "join", producerSlug: slug }}',
    );
  });

  it("keeps Artist metadata when Join signup transfers through SignIn to OAuth provisioning", () => {
    const signInHref = new URL(
      joinSignInHref("northline-studio"),
      "https://skitza.invalid",
    );
    const continuation = signInHref.searchParams.get("redirect_url");

    expect(joinSignUpMetadataFromTarget(continuation)).toEqual({
      signupOrigin: "join",
      producerSlug: "northline-studio",
    });
    expect(signInSource).toContain(
      "joinSignUpMetadataFromTarget(requestedHref)",
    );
    expect(signInSource).toContain(
      "{...(joinMetadata ? { unsafeMetadata: joinMetadata } : {})}",
    );
    expect(signInSource).toContain(
      "signUpForceRedirectUrl={signUpResolverHref}",
    );
    expect(signInSource).toContain(
      "signUpFallbackRedirectUrl={signUpResolverHref}",
    );
  });

  it("keeps the slug after Clerk makes the SignUp to SignIn redirect absolute", () => {
    const absoluteClerkTarget =
      "https://preview.skitza.test/join/northline-studio/continue?action=book";
    const normalized = normalizeSameOriginPostSignInTarget(
      absoluteClerkTarget,
      "https://preview.skitza.test",
    );

    expect(signUpSwitchHref(normalized)).toBe(
      "/sign-up/join/northline-studio/book?intent=signup",
    );
    expect(joinSignUpMetadataFromTarget(normalized)).toEqual({
      signupOrigin: "join",
      producerSlug: "northline-studio",
    });
  });
});
