// Page hero — date eyebrow + Syne greeting + plain-English status line.
// Pure server-renderable. The greeting reads "Welcome back, <first>." or
// "Welcome back." when first name is unavailable. Today's date renders
// in JetBrains Mono uppercase per the locked design.
//
// Mobile and desktop share the same hero — only the size/spacing
// differs via `lg:` modifiers, no fork.

export function PageHero({
  firstName,
  statusLine,
}: {
  firstName: string | null;
  statusLine: string;
}) {
  const today = new Date();
  const dateStr = today
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
  const name = firstName?.trim() ? firstName.trim() : null;

  return (
    <header className="reveal-up">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        {dateStr}
      </p>
      <h1 className="mt-1.5 font-display text-[34px] font-extrabold leading-none tracking-tight text-[rgb(var(--fg-default))] lg:text-[44px]">
        {name ? `Welcome back, ${name}` : "Welcome back"}
        <span className="text-[rgb(var(--brand-primary))]">.</span>
      </h1>
      <p className="mt-2.5 max-w-xl text-sm leading-snug text-[rgb(var(--fg-muted))]">
        {statusLine}
      </p>
    </header>
  );
}
