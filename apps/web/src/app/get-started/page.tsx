import "~/styles/get-started.css";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { StaticLogo } from "./_components/static-logo";

// Ad-traffic destination — the route group's layout already sets
// noindex+nofollow. We force-dynamic so the auth check runs per
// request (signed-in producers get redirected to /dashboard rather
// than seeing waitlist copy).
export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="get-started-root">
      <header className="px-6 py-6">
        <StaticLogo />
      </header>
      {/* Sections wired progressively — see plan tasks 13-17. The
          stable section ids are used by the test (page.test.tsx) and
          by the in-page anchors in CTA copy. */}
      <section id="hero" className="px-6 py-12">
        {/* Task 13 — hero copy + form */}
      </section>
      <section id="demo" className="px-6 py-16 sm:py-20">
        {/* Task 15 — demo video */}
      </section>
      <section id="cascade" className="px-6 py-16 sm:py-20">
        {/* Task 16 — pain cascade + stack-reveal */}
      </section>
      <section
        id="founder"
        className="bg-[rgb(var(--bg-elevated))] px-6 py-16 sm:py-20"
      >
        {/* Task 17 — founder note */}
      </section>
      <section id="cta" className="px-6 py-16 sm:py-24">
        {/* Task 17 — CTA repeat */}
      </section>
    </main>
  );
}
