import { FounderPhoto } from "./founder-photo";

// Founder section — design doc §4.4.
// FounderPhoto auto-swaps to /landing/founder.jpg when the file is
// dropped into apps/web/public/landing/. Until then, the gradient +
// GA initials placeholder shows.

export function FounderSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";

  return (
    <div className="mx-auto grid max-w-4xl items-center gap-8 sm:grid-cols-[auto_1fr]">
      <FounderPhoto
        alt={isHe ? "גילי אסרף, מייסד סקיצה" : "Gili Asraf, Skitza founder"}
      />
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
