import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { PostSignupConfetti } from "../../_components/post-signup-confetti";
import { StaticLogo } from "../../_components/static-logo";

export const dynamic = "force-dynamic";

// dir="rtl" lang="he" lives on the page-level <div>, NEVER on root
// <html> — see CLAUDE.md mistake log 2026-04-20 (next-themes + Clerk
// hydration breaks with `<html dir>` toggling).

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[^\p{L}\p{M}\p{N}\s\-']/gu, "")
    .trim()
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : null;
}

export default async function ThanksPageHe({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  const params = await searchParams;
  const name = sanitizeName(params.n);

  return (
    <div
      lang="he"
      dir="rtl"
      className="get-started-root get-started-root--he"
    >
      <main className="flex min-h-[100svh] flex-col bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
        <header className="px-6 py-6">
          <StaticLogo />
        </header>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <PostSignupConfetti />
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {name ? `אתה בפנים, ${name}.` : "אתה בפנים."}
          </h1>
          <p className="mt-6 max-w-md text-base text-[rgb(var(--fg-secondary))] sm:text-lg">
            הביטא נפתחת בקרוב. נשלח לך מייל ברגע שהמקום שלך מתפנה.
          </p>
        </div>
      </main>
    </div>
  );
}
