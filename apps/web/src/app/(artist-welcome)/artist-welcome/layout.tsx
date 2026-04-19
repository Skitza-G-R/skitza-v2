// Welcome doesn't get the artist app shell — no bottom nav, no
// studio switcher (the user has no studios yet anyway). Just a
// clean splash on the warm-cream brand background.
//
// Lives in its OWN route group (artist-welcome) instead of under
// (artist)/artist/welcome because the (artist) layout's role
// detection unconditionally redirects users with no studios →
// /artist-welcome, which would infinite-loop if welcome shared
// that layout.
export default function ArtistWelcomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      {children}
    </div>
  );
}
