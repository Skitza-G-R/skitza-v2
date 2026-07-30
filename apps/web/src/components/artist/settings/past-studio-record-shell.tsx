import { ArrowLeft, LockKeyhole } from "lucide-react";
import Link from "next/link";

export function PastStudioRecordShell({
  backHref,
  studioName,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  backHref: string;
  studioName: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[760px] pb-10">
      <Link
        href={backHref}
        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] px-2 text-[12px] font-bold text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to {studioName}
      </Link>

      <header>
        <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase">
          Past studio · {eyebrow}
        </p>
        <h1 className="font-display mt-1 text-[clamp(2rem,8vw,3.25rem)] leading-[0.98] font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          {title}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {subtitle}
        </p>
      </header>

      <div className="mt-5 flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-4">
        <LockKeyhole
          size={16}
          aria-hidden
          className="mt-0.5 shrink-0 text-[rgb(var(--fg-muted))]"
        />
        <p className="text-[12px] leading-relaxed text-[rgb(var(--fg-secondary))]">
          Preserved record from {studioName}. This screen is read-only and does not
          change your active studio.
        </p>
      </div>

      <div className="mt-5">{children}</div>
    </main>
  );
}
