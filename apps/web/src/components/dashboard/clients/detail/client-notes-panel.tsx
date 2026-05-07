// Notes & files panel — the calmest of the four tabs. Surfaces:
//   • freeform notes (`contact.notes`) with empty state
//   • tags (`contact.tags`) as small pills
//   • referral source (`contact.referralSource`) when set
//   • a pointer back to project rooms for files (Skitza files live
//     per-project, not per-client — this panel doesn't try to
//     re-aggregate them).
//
// Notes are read-only here in v1. The producer can edit notes from
// the existing CRM editor (`updateClientMeta` mutation) — surfacing
// that editor inline would warrant a "use client" island, which is
// out of scope for the page rebuild. Pre-fill cap is 5,000 chars per
// the router schema.

type Contact = {
  notes: string | null;
  tags: string[];
  referralSource: string | null;
};

export function ClientNotesPanel({
  contact,
  projectCount,
}: {
  contact: Contact;
  projectCount: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <NotesCard notes={contact.notes} />
        <FilesPointerCard projectCount={projectCount} />
      </div>
      <div className="flex flex-col gap-4">
        <TagsCard tags={contact.tags} />
        {contact.referralSource ? (
          <ReferralCard source={contact.referralSource} />
        ) : null}
      </div>
    </div>
  );
}

function NotesCard({ notes }: { notes: string | null }) {
  return (
    <section
      aria-labelledby="notes-card"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <h2
        id="notes-card"
        className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
      >
        Notes
      </h2>
      {notes && notes.trim().length > 0 ? (
        <p className="mt-3 whitespace-pre-wrap text-[13.5px] leading-6 text-[rgb(var(--fg-default))]">
          {notes}
        </p>
      ) : (
        <p className="mt-3 rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          No notes yet.
        </p>
      )}
    </section>
  );
}

function TagsCard({ tags }: { tags: string[] }) {
  return (
    <section
      aria-labelledby="tags-card"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <h2
        id="tags-card"
        className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
      >
        Tags
      </h2>
      {tags.length === 0 ? (
        <p className="mt-3 text-[13px] text-[rgb(var(--fg-muted))]">
          No tags yet.
        </p>
      ) : (
        <ul role="list" className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t}>
              <span className="pill pill-neutral">#{t}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReferralCard({ source }: { source: string }) {
  return (
    <section
      aria-labelledby="referral-card"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <h2
        id="referral-card"
        className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
      >
        Referral source
      </h2>
      <p className="mt-3 text-[13px] text-[rgb(var(--fg-default))]">{source}</p>
    </section>
  );
}

function FilesPointerCard({ projectCount }: { projectCount: number }) {
  return (
    <section
      aria-labelledby="files-card"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <h2
        id="files-card"
        className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
      >
        Files
      </h2>
      <p className="mt-3 text-[13px] text-[rgb(var(--fg-muted))]">
        Files live in each project room.{" "}
        {projectCount > 0
          ? `Open one of the ${projectCount.toString()} project${projectCount === 1 ? "" : "s"} above to manage tracks, references, and deliverables.`
          : "Start a project to begin sharing files with this client."}
      </p>
    </section>
  );
}
