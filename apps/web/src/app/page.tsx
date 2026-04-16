import { Button } from "~/components/ui/button";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <section className="flex flex-col gap-4 p-12">
        <h1 className="text-3xl font-semibold">Skitza — chrome-dark</h1>
        <p className="text-[rgb(var(--fg-secondary))]">
          Spotify-feel app shell, default theme.
        </p>
        <div>
          <Button>Primary action</Button>
        </div>
      </section>

      <section
        data-theme="room-paper"
        className="flex flex-col gap-4 bg-[rgb(var(--bg-base))] p-12 text-[rgb(var(--fg-primary))]"
      >
        <h1 className="text-3xl font-semibold">Skitza — room-paper</h1>
        <p className="text-[rgb(var(--fg-secondary))]">
          Notion-feel producer workspace and Project Rooms.
        </p>
        <div>
          <Button variant="outline">Outline action</Button>
        </div>
      </section>
    </main>
  );
}
