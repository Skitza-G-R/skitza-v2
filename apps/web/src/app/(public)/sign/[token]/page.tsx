import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { appRouter } from "~/server/trpc/routers/_app";
import { SignClient } from "./sign-client";

type PageProps = { params: Promise<{ token: string }> };

export function generateMetadata(): Metadata {
  // Never indexed — signing URLs are private.
  return {
    title: "Review & sign",
    description: "Private contract on Skitza",
    robots: { index: false, follow: false },
  };
}

// Render the resolved contract body as a chain of paragraphs. The body
// is stored as markdown but we ship a very small renderer rather than
// pulling in a full markdown lib — we only need headings, paragraphs,
// and bold. The body has already been HTML-escaped during merge field
// resolution, so any `<` in user values is rendered as `&lt;`.
function renderBody(body: string): React.ReactElement[] {
  const lines = body.split(/\r?\n/);
  const out: React.ReactElement[] = [];
  let paragraph: string[] = [];
  let key = 0;
  function flush() {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(" ");
    out.push(<p key={`p-${String(key++)}`} className="mt-3 leading-relaxed">{renderInline(joined)}</p>);
    paragraph = [];
  }
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith("# ")) {
      flush();
      out.push(
        <h1
          key={`h1-${String(key++)}`}
          className="mt-6 font-display text-2xl leading-tight tracking-tight"
          style={{ fontWeight: 800 }}
        >
          {renderInline(line.slice(2))}
        </h1>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      out.push(
        <h2
          key={`h2-${String(key++)}`}
          className="mt-5 font-display text-lg tracking-tight"
          style={{ fontWeight: 700 }}
        >
          {renderInline(line.slice(3))}
        </h2>,
      );
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out;
}

// Render `**bold**` inline. Everything else passes through.
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[rgb(var(--fg-primary))]">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export default async function SignPage({ params }: PageProps) {
  const { token } = await params;
  const caller = appRouter.createCaller({ userId: null });

  let data;
  try {
    data = await caller.contract.publicByToken({ token });
  } catch {
    notFound();
  }

  const statusLabel: Record<string, string> = {
    draft: "Draft",
    sent: "Pending signature",
    viewed: "Pending signature",
    signed: "Signed",
    expired: "Expired",
    cancelled: "Cancelled",
  };

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute -right-40 top-[-8rem] h-[40rem] w-[40rem] rounded-full blur-[140px]"
          style={{ background: "rgba(176,104,48,0.12)" }}
        />
      </div>
      <main className="relative z-10 mx-auto max-w-3xl px-6 pb-24 pt-14 sm:px-10 sm:pt-20">
        <header className="mb-8 reveal-up">
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Contract from{" "}
            <Link
              href={`/p/${data.producer.slug}`}
              className="underline-offset-4 hover:text-[rgb(var(--fg-primary))] hover:underline"
            >
              {data.producer.displayName}
            </Link>
            {" · "}
            {statusLabel[data.contract.status] ?? data.contract.status}
          </p>
          <h1
            className="mt-3 font-display text-[clamp(2.25rem,6vw,3.5rem)] leading-[1] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            {data.contract.title}
          </h1>
          <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
            For {data.contract.artistName} · review the terms below and sign.
          </p>
        </header>

        {/* Contract body */}
        <article className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 sm:p-8">
          <div className="text-[rgb(var(--fg-primary))]">{renderBody(data.contract.bodyResolved)}</div>
        </article>

        {/* Signature block */}
        <div className="mt-8">
          <SignClient
            token={token}
            artistName={data.contract.artistName}
            producerName={data.producer.displayName}
            initialStatus={data.contract.status}
            initialSignedAt={data.contract.signedAt}
          />
        </div>

        <footer className="mt-16 text-center font-mono text-xs text-[rgb(var(--fg-muted))]">
          <Link href="/" className="hover:text-[rgb(var(--brand-primary))]">
            Powered by Skitza
          </Link>
        </footer>
      </main>
    </div>
  );
}
