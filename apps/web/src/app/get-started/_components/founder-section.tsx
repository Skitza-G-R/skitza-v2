// Founder section — design doc §4.4.
// Pre-launch: gradient placeholder for the headshot. Once
// apps/web/public/landing/founder.jpg lands, swap the inner <div>
// for `<Image src="/landing/founder.jpg" .../>` (next/image).

export function FounderSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";

  return (
    <div className="mx-auto grid max-w-4xl items-center gap-8 sm:grid-cols-[auto_1fr]">
      <div
        className="mx-auto h-32 w-32 overflow-hidden rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] sm:h-44 sm:w-44"
        aria-label={isHe ? "גילי אסרף, מייסד סקיצה" : "Gili Asraf, Skitza founder"}
      >
        {/* Pre-launch placeholder — replaces with real photo when ready */}
        <div className="flex h-full items-center justify-center text-3xl font-bold text-[rgb(var(--fg-inverse))]">
          GA
        </div>
      </div>
      <div className="text-[rgb(var(--fg-primary))]">
        {isHe ? (
          <>
            <p className="text-base sm:text-lg">
              אני גילי. בניתי את סקיצה אחרי שצפיתי בחברים מפיקים מבזבזים יותר
              זמן בוואטסאפ מאשר בסטודיו.
              <br />
              <br />
              הזמנות באפליקציה אחת. דרייב באחרת. חוזים בשלישית. תשלומים ברביעית.
              אף אחד מהם לא דיבר עם השני, ואף אחד לא נבנה למוזיקה.
              <br />
              <br />
              סקיצה היא הכלי שתמיד רציתי שיהיה להם — לינק אחד שמטפל בכל הסטאק,
              כדי שתוכל לחזור לעשות מוזיקה.
            </p>
            <p className="mt-4 text-sm text-[rgb(var(--fg-muted))]">
              — גילי אסרף, מייסד
            </p>
          </>
        ) : (
          <>
            <p className="text-base sm:text-lg">
              I&apos;m Gili, and I built Skitza after watching my producer
              friends spend more time on WhatsApp than in the studio.
              <br />
              <br />
              Bookings in one app. Drive in another. Contracts in a third.
              Payments in a fourth. None of them talked to each other. None of
              them were built for music.
              <br />
              <br />
              Skitza is what I wish they had — one link that handles the whole
              stack so you can get back to making music.
            </p>
            <p className="mt-4 text-sm text-[rgb(var(--fg-muted))]">
              — Gili Asraf, founder
            </p>
          </>
        )}
      </div>
    </div>
  );
}
