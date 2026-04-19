import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";

import { createDb, eq, and, clientContacts } from "@skitza/db";
import { SoftSignInBanner } from "~/components/artist/soft-signin-banner";
import { appRouter } from "~/server/trpc/routers/_app";
import {
  selectBanner,
  type BannerStageInput,
} from "./banner-helpers";
import { PausedBannerHost } from "./paused-banner-host";
import { ShareClient } from "./share-client";

type PageProps = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  // noindex + no preview. Tokens are unguessable but we don't want
  // Googlebot indexing share URLs that leaked to pastebin.
  return {
    title: "Project Room",
    description: `Private project room on Skitza`,
    robots: { index: false, follow: false },
    other: { "x-token-prefix": token.slice(0, 4) },
  };
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const caller = appRouter.createCaller({ userId: null });

  let data;
  try {
    data = await caller.project.publicByToken({ token });
  } catch {
    notFound();
  }

  // Task 13 — soft sign-in banner. Magic-link flow is still primary;
  // the banner is purely additive and must never block access.
  //   - Signed out → "Sign in to see all your studios" CTA.
  //   - Signed in AND linked to this producer via clientContacts →
  //     "View in app" deep-link.
  //   - Signed in but NOT linked → no banner (artist app has nothing
  //     to show for this producer yet).
  const { userId } = await auth();
  let softBanner: React.ReactNode = null;
  if (!userId) {
    softBanner = (
      <SoftSignInBanner
        mode="signin"
        token={token}
        returnUrl={`/share/${token}`}
      />
    );
  } else {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      const db = createDb(dbUrl);
      const [contactRow] = await db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, userId),
            eq(clientContacts.producerId, data.project.producerId),
          ),
        )
        .limit(1);
      if (contactRow) {
        softBanner = (
          <SoftSignInBanner
            mode="in-app"
            token={token}
            appUrl={`/artist/music/${data.project.id}?studio=${data.project.producerId}`}
            studioName={data.project.producerName}
          />
        );
      }
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
        {softBanner}
        {(() => {
          const banner = selectBanner(data.project.stage as BannerStageInput);
          if (banner === "paused") {
            return (
              <PausedBannerHost projectId={data.project.id} token={token} />
            );
          }
          if (banner === "cancelled") {
            return (
              <div
                role="status"
                className="mb-8 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-raised))] p-6"
              >
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  Project cancelled
                </p>
                <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
                  This project was cancelled. Past mixes remain accessible
                  below, but the engagement has ended — please reach out to
                  the producer directly for any further work.
                </p>
              </div>
            );
          }
          return null;
        })()}
        <header className="mb-10 reveal-up">
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Project Room · by{" "}
            <Link
              href={`/p/${data.project.producerSlug}`}
              className="underline-offset-4 hover:text-[rgb(var(--fg-primary))] hover:underline"
            >
              {data.project.producerName}
            </Link>
          </p>
          <h1
            className="mt-3 font-display text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.98] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            {data.project.title}
          </h1>
          <p className="mt-3 text-sm text-[rgb(var(--fg-secondary))]">
            Hey {data.project.artistName} — stream the latest, leave timestamped notes.
          </p>
        </header>

        <ShareClient
          token={token}
          project={{
            id: data.project.id,
            title: data.project.title,
            artistName: data.project.artistName,
            producerName: data.project.producerName,
            producerSlug: data.project.producerSlug,
            depositPaid: data.project.depositPaid,
            finalPaid: data.project.finalPaid,
          }}
          tracks={data.tracks.map((t) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            position: t.position,
          }))}
          versions={data.versions.map((v) => ({
            id: v.id,
            trackId: v.trackId,
            label: v.label,
            // Nullable: share-client shows an "upload pending" placeholder.
            audioUrl: v.audioUrl,
            uploadedAt: v.uploadedAt,
          }))}
          comments={data.comments.map((c) => ({
            id: c.id,
            versionId: c.versionId,
            authorName: c.authorName,
            body: c.body,
            timestampMs: c.timestampMs,
            resolvedAt: c.resolvedAt,
            fromProducer: c.fromProducer,
            createdAt: c.createdAt,
          }))}
        />

        <footer className="mt-16 text-center font-mono text-xs text-[rgb(var(--fg-muted))]">
          <Link
            href={`/p/${data.project.producerSlug}`}
            className="hover:text-[rgb(var(--fg-primary))]"
          >
            ← {data.project.producerName}&apos;s portfolio
          </Link>{" "}
          · powered by{" "}
          <Link href="/" className="hover:text-[rgb(var(--brand-primary))]">
            Skitza
          </Link>
        </footer>
      </main>
    </div>
  );
}
