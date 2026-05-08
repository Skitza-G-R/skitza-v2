import { WaitlistForm } from "./waitlist-form";

// CTA-repeat — last section before page end. Same WaitlistForm as
// the hero, same redirect target. Visitors who skip the hero form
// and scroll all the way down get a second clear ask.

export function CtaSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  const thanksHref = isHe ? "/get-started/he/thanks" : "/get-started/thanks";

  return (
    <div className="mx-auto max-w-2xl rounded-[var(--radius-lg)] bg-[rgb(var(--bg-elevated))] p-8 text-center shadow-[0_8px_32px_rgb(0_0_0/0.06)] sm:p-10">
      <h2 className="text-2xl font-semibold sm:text-3xl">
        {isHe ? "הצטרף לרשימת ההמתנה." : "Get on the waitlist."}
      </h2>
      <div className="mt-6">
        <WaitlistForm locale={locale} thanksHref={thanksHref} />
      </div>
      <p className="mt-4 text-sm text-[rgb(var(--fg-muted))]">
        {isHe
          ? "הביטא נפתחת בקרוב. המקומות מוגבלים."
          : "Beta opens soon. Spots are limited."}
      </p>
    </div>
  );
}
