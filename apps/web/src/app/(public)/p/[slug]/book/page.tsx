import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { createDb, eq, producers } from "@skitza/db";
import { appRouter } from "~/server/trpc/routers/_app";
import { EmptyState } from "~/components/ui/empty-state";
import { BookingClient } from "./booking-client";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Book a session with ${slug}`,
    description: `Pick a service, pick a slot, request a session.`,
  };
}

// Public booking page. Pre-loads packages + slots for each package
// server-side so the visitor sees content on first paint (no
// skeleton-then-swap). Timezone in `producers.timezone` is the
// producer's studio TZ; visitor-TZ conversion is v2.
export default async function BookPage({ params }: PageProps) {
  const { slug } = await params;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const db = createDb(dbUrl);

  const [producer] = await db
    .select({
      id: producers.id,
      displayName: producers.displayName,
      timezone: producers.timezone,
    })
    .from(producers)
    .where(eq(producers.slug, slug))
    .limit(1);
  if (!producer || producer.displayName === null) notFound();

  const caller = appRouter.createCaller({ userId: null });
  const { packages } = await caller.booking.publicPackages({ slug });

  // Pre-fetch slots per package. For cold visitors this is 1 extra
  // round-trip per package but pays off on UX (no loading spinners
  // during slot browse). Kept at 14 days.
  const initialSlotsByPackage: Record<string, string[]> = {};
  for (const p of packages) {
    try {
      const res = await caller.booking.publicSlots({ slug, packageId: p.id, days: 14 });
      initialSlotsByPackage[p.id] = res.slots;
    } catch {
      // Non-fatal — render with an empty slot list; the client shows
      // a friendly "no slots available" message.
      initialSlotsByPackage[p.id] = [];
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute -left-40 top-[-8rem] h-[40rem] w-[40rem] rounded-full blur-[140px]"
          style={{ background: "rgba(212,150,10,0.14)" }}
        />
      </div>

      <main className="relative z-10 mx-auto max-w-4xl px-6 pb-24 pt-14 sm:px-10 sm:pt-20">
        <header className="mb-12 text-center reveal-up">
          <Link
            href={`/p/${slug}`}
            className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))]"
          >
            ← {producer.displayName}&apos;s portfolio
          </Link>
          <h1
            className="mt-4 font-display text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.98] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            Book a session.
          </h1>
          <p className="mt-4 text-[rgb(var(--fg-secondary))]">
            With <span className="font-semibold text-[rgb(var(--fg-primary))]">{producer.displayName}</span>.
            Pick a package, pick a slot — they&apos;ll confirm within 24h.
          </p>
        </header>

        {packages.length === 0 ? (
          <EmptyState
            title="No packages offered yet."
            description={`${producer.displayName} hasn't listed services for booking. Check their portfolio or reach out directly.`}
            action={
              <Link
                href={`/p/${slug}`}
                className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 text-sm transition-colors hover:bg-[rgb(var(--bg-overlay))]"
              >
                View portfolio →
              </Link>
            }
          />
        ) : (
          <BookingClient
            slug={slug}
            displayName={producer.displayName}
            timezone={producer.timezone}
            packages={packages.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              durationMin: p.durationMin,
              sessionCount: p.sessionCount,
              priceCents: p.priceCents,
              currency: p.currency,
              depositPct: p.depositPct,
            }))}
            initialSlotsByPackage={initialSlotsByPackage}
          />
        )}
      </main>
    </div>
  );
}
