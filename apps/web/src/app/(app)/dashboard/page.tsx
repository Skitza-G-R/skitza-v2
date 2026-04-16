import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { AppShell } from "~/components/shell/app-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/components/ui/card";

// Dashboard overview — the first surface a producer sees every login.
// Goal: show identity + a short list of useful actions, feel warm, not sterile.
export default async function Dashboard() {
  const user = await currentUser();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const db = createDb(dbUrl);

  // (app)/layout.tsx guarantees both `user` and a complete Producer row
  // before this component renders, so we can rely on the lookup succeeding.
  if (!user) throw new Error("unauthenticated"); // belt-and-braces; layout should have redirected
  const [row] = await db
    .select({ displayName: producers.displayName, slug: producers.slug })
    .from(producers)
    .where(eq(producers.clerkUserId, user.id))
    .limit(1);
  const displayName = row?.displayName ?? user.firstName ?? "producer";
  const slug = row?.slug ?? "";

  return (
    <AppShell active="overview">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Studio overview
          </p>
          <h1
            className="mt-3 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            Welcome back,{" "}
            <span className="text-[rgb(var(--brand-primary))]">{displayName}</span>.
          </h1>
          {slug ? (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[rgb(var(--fg-secondary))]">
              Your public portfolio lives at{" "}
              <Link
                href={`/p/${slug}`}
                className="font-mono text-[rgb(var(--brand-primary))] underline-offset-4 hover:underline"
              >
                /p/{slug}
              </Link>
            </p>
          ) : null}
        </header>

        {/* Primary action cards — each is a rack-unit-style card with a
            subtle top border in the tile's accent hue. */}
        <section className="mt-10 grid gap-4 reveal-up-delay-1 sm:mt-14 md:grid-cols-2">
          <ActionCard
            href="/dashboard/portfolio"
            label="Portfolio"
            title="Showcase your work"
            description="Curate the tracks visitors hear when they land on your public page."
            cta="Manage tracks"
            accent="primary"
          />
          <ActionCard
            href="/dashboard/leads"
            label="Lead Links"
            title="Send a smart URL"
            description="Mint a single magic link that routes a lead through portfolio, booking, and deposit — with analytics."
            cta="Issue a link"
            accent="accent"
          />
        </section>

        {/* Coming-soon rail: sets expectations for Phase 2+ features. */}
        <section className="mt-10">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Coming next
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <SoonCard title="Booking" body="Cal.com-powered public booking page." />
            <SoonCard title="Project Rooms" body="One URL per engagement: files, feedback, payments." />
            <SoonCard title="Stripe Connect" body="Deposits & milestone invoices with Stripe Tax." />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function ActionCard({
  href,
  label,
  title,
  description,
  cta,
  accent,
}: {
  href: string;
  label: string;
  title: string;
  description: string;
  cta: string;
  accent: "primary" | "accent";
}) {
  const bar =
    accent === "primary"
      ? "bg-[rgb(var(--brand-primary))]"
      : "bg-[rgb(var(--brand-accent))]";
  return (
    <Link href={href} className="group block">
      <Card className="relative h-full overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgb(var(--border-strong))] hover:shadow-[var(--shadow-md)]">
        <div className={`absolute left-0 top-0 h-full w-[3px] ${bar}`} />
        <CardContent className="flex h-full flex-col justify-between gap-6 pl-6 pt-5">
          <div>
            <div className="flex items-center justify-between">
              <Badge variant={accent === "primary" ? "active" : "accent"} dot>
                {label}
              </Badge>
              <span className="font-mono text-xs text-[rgb(var(--fg-muted))] transition-colors group-hover:text-[rgb(var(--fg-secondary))]">
                ↗
              </span>
            </div>
            <h2 className="mt-4 font-display text-2xl leading-tight tracking-tight">
              {title}
            </h2>
            <CardDescription className="mt-2">{description}</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="w-fit">
            {cta}
          </Button>
        </CardContent>
      </Card>
    </Link>
  );
}

function SoonCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="opacity-70">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge>Soon</Badge>
        </div>
        <CardDescription className="mt-1 text-xs">{body}</CardDescription>
      </CardContent>
    </Card>
  );
}
