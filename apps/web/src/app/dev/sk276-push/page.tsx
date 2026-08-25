import { notFound } from "next/navigation";

import { PushMomentBanner } from "~/components/push/push-moment-banner";
import { PushPreferences } from "~/components/push/push-preferences";
import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

// SK-276 visual check — the notifications card in both roles plus the
// smart-moment banner, without a signed-in producer or artist. The card
// reads live browser support and calls the real status action, which
// fails with "Please sign in" here; that is expected. What this page is
// for is the layout: the master button, the six switches, artist vs
// producer wording, and the banner sitting inside a narrow column.

export default function Sk276PushVisualCheck() {
  if (!isDevGalleryAvailable()) notFound();
  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8">
      <h1 className="font-display mb-6 text-[22px] font-extrabold text-[rgb(var(--fg-default))]">
        SK-276 · Push notifications visual check
      </h1>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-mono text-[11px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
            Producer card
          </h2>
          <PushPreferences />
        </section>

        <section>
          <h2 className="mb-3 font-mono text-[11px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
            Artist card
          </h2>
          <PushPreferences role="artist" />
        </section>

        <section className="max-w-[440px]">
          <h2 className="mb-3 font-mono text-[11px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
            Smart-moment banner
          </h2>
          <PushMomentBanner message="Get an alert the moment your session is confirmed." />
          <p className="mt-3 text-xs leading-5 text-[rgb(var(--fg-muted))]">
            The banner hides itself unless push is supported, configured, unsubscribed, and not
            dismissed in the last 90 days — so an empty space here is a pass, not a bug.
          </p>
        </section>
      </div>
    </main>
  );
}
