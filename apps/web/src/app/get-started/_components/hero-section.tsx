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
      <SplitScreen locale={locale} />
    </div>
  );
}

// Chaos↔Skitza split-screen animation. The chaos panel cycles through
// the four stressors a producer recognizes (random booking ping,
// confused payment ask, the "FINAL_v7.wav" rabbit hole, a card
// decline). The Skitza panel shows a single confirmed session card —
// the calm version. Aria-hidden because it's pure decoration; the
// hero copy + form are what's announced to screen readers.
function SplitScreen({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  return (
    <div
      className="get-started-split mt-12 sm:mt-16"
      aria-hidden
    >
      <div className="get-started-split__chaos">
        <div className="get-started-split__msg get-started-split__msg--1">
          {isHe ? "פנוי שלישי 19:00?" : "u up to record Tuesday?"}
        </div>
        <div className="get-started-split__msg get-started-split__msg--2">
          {isHe ? "איפה הקישור לתשלום?" : "where's the Stripe link?"}
        </div>
        <div className="get-started-split__msg get-started-split__msg--3">
          FINAL_v7.wav
        </div>
        <div className="get-started-split__msg get-started-split__msg--4">
          DECLINED
        </div>
      </div>
      <div className="get-started-split__calm">
        <div className="get-started-split__card">
          <span className="get-started-split__card-title">
            {isHe ? "סשן · 14.8, 14:00" : "Session — Aug 14, 2:00 PM"}
          </span>
          <span className="get-started-split__card-status">
            {isHe ? "מאושר ✓" : "Confirmed ✓"}
          </span>
        </div>
      </div>
    </div>
  );
}
