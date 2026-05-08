import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { PostSignupConfetti } from "../_components/post-signup-confetti";
import { StaticLogo } from "../_components/static-logo";

export const dynamic = "force-dynamic";

// Sanitize the optional ?n=<firstName> query param. Strips anything
// that isn't a Unicode letter, mark, number, space, hyphen, or
// apostrophe — covers names in EN/HE/AR/CJK without letting in
// HTML/script characters. Capped at 60 chars to match the procedure
// input rule.
function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[^\p{L}\p{M}\p{N}\s\-']/gu, "")
    .trim()
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : null;
}

export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth();
  // Already a producer? Skip the post-signup splash and go to their
  // dashboard. Avoids "Skitza is launching!" copy for someone who
  // already uses Skitza.
  if (userId) redirect("/dashboard");

  const params = await searchParams;
  const name = sanitizeName(params.n);

  return (
    <main className="get-started-root flex min-h-[100svh] flex-col bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <header className="px-6 py-6">
        <StaticLogo />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <PostSignupConfetti />
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          {name ? `You're in, ${name}.` : "You're in."}
        </h1>
        <p className="mt-6 max-w-md text-base text-[rgb(var(--fg-secondary))] sm:text-lg">
          Beta opens soon. We&apos;ll email you when your spot opens.
        </p>
      </div>
    </main>
  );
}
