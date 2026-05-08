import { WaitlistForm } from "./waitlist-form";

// Hero section copy — design doc §4.1.
// Headline ↔ "You're a producer. Not an assistant."
// Sub-head ↔ replaces-the-stack pitch
// CTA ↔ shared WaitlistForm with locale-aware redirect target.
//
// The split-screen animation slot lives below the form and is
// populated in Task 14. Until then the section reads cleanly as a
// hero with copy + form (acceptable interim state — no half-built UI).

export function HeroSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  const thanksHref = isHe ? "/get-started/he/thanks" : "/get-started/thanks";

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
        {isHe ? (
          <>
            אתה מפיק.
            <br />
            לא מזכירה.
          </>
        ) : (
          <>
            You&apos;re a producer.
            <br />
            Not an assistant.
          </>
        )}
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-[rgb(var(--fg-secondary))] sm:text-xl">
        {isHe
          ? "תיאום סשן לא אמור להיות ארוך יותר מהסשן עצמו. סקיצה מחליפה את WhatsApp, Drive, Notion, DocuSign ו-Stripe — בלינק אחד."
          : "Booking a session shouldn't take longer than the session. Skitza replaces WhatsApp, Drive, Notion, DocuSign, and Stripe — with one link."}
      </p>
      <div className="mt-8 max-w-xl">
        <WaitlistForm locale={locale} thanksHref={thanksHref} />
        <p className="mt-3 text-sm text-[rgb(var(--fg-muted))]">
          {isHe
            ? "בלי ספאם. נשלח לך מייל ברגע שהמקום שלך מתפנה."
            : "No spam. We email you when your spot opens."}
        </p>
      </div>
    </div>
  );
}
