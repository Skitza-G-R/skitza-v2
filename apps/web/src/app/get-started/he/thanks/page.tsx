import "~/styles/get-started.css";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { PostSignupConfetti } from "../../_components/post-signup-confetti";
import { StaticLogo } from "../../_components/static-logo";

export const dynamic = "force-dynamic";

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
    <div lang="he" dir="rtl" className="get-started-root">
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
        <span className="eyebrow">{"אתה ברשימה"}</span>
        <h1 className="h1" style={{ marginTop: 14, maxWidth: 760 }}>
          {name ? `אתה בפנים, ${name}.` : "אתה בפנים."}
        </h1>
        <p className="body-lg" style={{ maxWidth: 520, marginTop: 8 }}>
          הביטא נפתחת בקרוב. נשלח לך מייל ברגע שהמקום שלך מתפנה.
        </p>
      </div>
    </div>
  );
}
