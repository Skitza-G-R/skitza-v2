import "~/styles/get-started.css";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { PostSignupConfetti } from "../_components/post-signup-confetti";
import { StaticLogo } from "../_components/static-logo";

export const dynamic = "force-dynamic";

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
  if (userId) redirect("/dashboard");

  const params = await searchParams;
  const name = sanitizeName(params.n);

  return (
    <main className="get-started-root">
      <header className="gs-header">
        <div className="container">
          <StaticLogo />
        </div>
      </header>
      <div
        className="container"
        style={{
          minHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "80px 24px",
        }}
      >
        <PostSignupConfetti />
        <span className="eyebrow">{"You're on the list"}</span>
        <h1
          className="h1"
          style={{ marginTop: 14, maxWidth: 760 }}
        >
          {name ? (
            <>
              {`You're in, ${name}`}
              <span className="accent-dot">.</span>
            </>
          ) : (
            <>
              {"You're in"}
              <span className="accent-dot">.</span>
            </>
          )}
        </h1>
        <p className="body-lg" style={{ maxWidth: 520, marginTop: 8 }}>
          Beta opens soon. We&apos;ll email you the moment your spot opens
          — usually a few weeks, not months.
        </p>
        {/* In-funnel back button — /get-started is allowed by the
            isolation rule (§3.5). Gives the visitor somewhere to go
            after the success message instead of a dead-end page. */}
        <a
          href="/get-started"
          className="btn-primary"
          style={{ marginTop: 32, textDecoration: "none" }}
        >
          ← Back to Skitza
        </a>
      </div>
    </main>
  );
}
