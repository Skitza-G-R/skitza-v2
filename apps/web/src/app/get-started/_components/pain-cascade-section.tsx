import { StackReveal } from "./stack-reveal";

// Pain cascade — design doc §4.3.
//
// EN copy structure:
//   How much time goes to waste on…
//   <list of recognized pains>
//   Who's got time for this?
//   You used to need a part-time assistant.
//   Now you have Skitza.
//   One app. For everything. Forever.
//
// HE mirrors the same arc with culturally-equivalent producer-talk
// rather than literal translation.

export function PainCascadeSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";

  return (
    <div className="mx-auto max-w-3xl text-center">
      {isHe ? (
        <>
          <h2 className="text-3xl font-semibold sm:text-4xl">
            כמה זמן הולך לך על?
          </h2>
          <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
            לקבוע סשנים. לזכור מי חייב לך. לרדוף אחרי תשלומים. לחפש גרסאות
            בוואטסאפ. לעקוב מי לקוח פעיל ומה דחוף ואז עוד לתעד את הכל מחדש —
            בכל פעם.
          </p>
          <p className="mt-8 text-2xl font-semibold">למי יש זמן לזה?</p>
          <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
            פעם היה צריך לזה מזכירה.
            <br />
            היום, יש סקיצה.
          </p>
          <p className="mt-6 text-xl font-semibold">
            אפליקציה אחת שסוגרת לך את כל הפינות.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-3xl font-semibold sm:text-4xl">
            How much time goes to waste on…
          </h2>
          <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
            Booking sessions. Searching WhatsApp for the right version. Chasing
            payments. Tracking what&apos;s due Friday and re-typing the same
            to-do list, every. single. time.
          </p>
          <p className="mt-8 text-2xl font-semibold">Who&apos;s got time for this?</p>
          <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
            You used to need a part-time assistant just to keep up.
            <br />
            Now you have Skitza.
          </p>
          <p className="mt-6 text-xl font-semibold">
            One app. For everything. Forever.
          </p>
        </>
      )}
      <div className="mt-12">
        <StackReveal />
      </div>
    </div>
  );
}
