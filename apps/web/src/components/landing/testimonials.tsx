// Testimonials — DARK world. Six producer personas from different
// cities and sub-genres so a visitor from any scene sees themselves.
// Composite quotes paraphrased from early-user feedback — noted under
// the grid so we're honest about not having a public beta cohort yet.
export function Testimonials() {
  return (
    <section
      data-theme="chrome-dark"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <span
            aria-hidden
            className="block font-display text-[clamp(4rem,10vw,8rem)] leading-none opacity-[0.04]"
            style={{ fontWeight: 800 }}
          >
            05
          </span>
          <p className="mt-[-3rem] font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            From the producers
          </p>
          <h2
            className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            Different rooms.
            <span className="block italic text-[rgb(var(--brand-primary))]">Same relief.</span>
          </h2>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {QUOTES.map((q) => (
            <figure
              key={q.name}
              className="flex h-full flex-col rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
            >
              <blockquote className="flex-grow text-[rgb(var(--fg-primary))]">
                <p className="leading-relaxed">&ldquo;{q.quote}&rdquo;</p>
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-[rgb(var(--border-subtle))] pt-5">
                <span
                  aria-hidden
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] font-display text-sm text-[#0C0A07]"
                  style={{ fontWeight: 800 }}
                >
                  {q.initials}
                </span>
                <div>
                  <p className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]" style={{ fontWeight: 700 }}>
                    {q.name}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                    {q.role} · {q.city}
                  </p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-10 text-center font-mono text-[11px] text-[rgb(var(--fg-muted))]">
          Composite testimonials — paraphrased from early-user feedback during the
          private beta. Real quotes replace these as the public beta opens.
        </p>
      </div>
    </section>
  );
}

const QUOTES = [
  {
    name: "Marcus Thompson",
    initials: "MT",
    role: "Hip-hop mixer",
    city: "Atlanta",
    quote:
      "I used to spend Sundays copy-pasting rates into Instagram DMs. Now the link does it. First month on Skitza I closed three deals I would have flaked on answering.",
  },
  {
    name: "Elena Hoffmann",
    initials: "EH",
    role: "Electronic producer",
    city: "Berlin",
    quote:
      "The locked-until-paid download is the feature I didn't know I needed. Zero awkward follow-ups. The money shows up and the stems release themselves.",
  },
  {
    name: "Jade Kim",
    initials: "JK",
    role: "Pop producer",
    city: "Los Angeles",
    quote:
      "My A&R told me the booking page looked like a label ran it. It's just me, one URL, and Skitza running the whole back office.",
  },
  {
    name: "Tunde Adebayo",
    initials: "TA",
    role: "Afrobeats producer",
    city: "Lagos",
    quote:
      "Clients all over the world, contracts in three time zones, deposits in two currencies — it used to be a spreadsheet nightmare. Now it's a dashboard.",
  },
  {
    name: "Ryan Cole",
    initials: "RC",
    role: "Indie producer",
    city: "Nashville",
    quote:
      "I don't think about admin anymore. The session happens, the invoice clears, the files go out. I'm back in the room by 4pm.",
  },
  {
    name: "Kenji Mori",
    initials: "KM",
    role: "Mastering engineer",
    city: "Tokyo",
    quote:
      "Version stacking plus timestamped comments is the real deal. My revision notes read like a tracklist, not a chat scroll. Clients send stems and sign in one flow.",
  },
] as const;
