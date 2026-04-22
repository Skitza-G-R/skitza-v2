import { joinArtistWorkspace } from "./actions";

// `/artist-welcome/<slug>` — 2026-04-22 REBUILD.
//
// Previously this was a visible "Welcome to Skitza. You're now
// connected to X" splash with an "Open my artist workspace →" button.
// Gili's manual QA showed that splash was worthless friction ("i dont
// need this page its worthless, when i click the button it should
// take me straight to the app"), AND the button-click approach had
// multiple silent-failure modes (form-action bind issues, action not
// running) that couldn't be diagnosed remotely.
//
// The page is now a silent server-side pass-through. On every visit:
//   1. Resolve the user's Clerk session (redirect to /sign-in if none)
//   2. Look up the producer by slug (redirect to /artist if unknown)
//   3. UPSERT client_contacts for (this user, this producer)
//   4. Also stamp clerkUserId onto any pre-existing client_contacts
//      rows for the same email hash (multi-producer identity unify)
//   5. Redirect to /artist
//
// All of that happens before any HTML leaves the server — the user's
// browser goes straight from Clerk's post-signup redirect to /artist.
// No splash, no click, no wait.
//
// The logic itself lives in ./actions.ts (`joinArtistWorkspace`) so
// the 5 TDD tests we wrote for it still apply. That function
// internally calls redirect() which throws a special Next.js error;
// awaiting it in a Server Component is the canonical pattern for
// "run this mutation then navigate."

// Force dynamic so the redirect runs every visit (not cached).
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function JoinedArtistWelcomePage({ params }: Props) {
  const { slug } = await params;
  await joinArtistWorkspace(slug);
  // Unreachable — joinArtistWorkspace always redirects.
  return null;
}
