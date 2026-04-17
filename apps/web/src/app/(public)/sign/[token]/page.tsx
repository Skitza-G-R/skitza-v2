import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { SignerView } from "~/components/contracts/signer-view";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ token: string }> };

// Signing URLs are private-by-link — never indexable.
export function generateMetadata(): Metadata {
  return {
    title: "Sign contract · Skitza",
    description: "Review and sign the contract.",
    robots: { index: false, follow: false },
  };
}

// Pin zoom so text-field focus on iOS Safari doesn't trigger the
// auto-zoom-on-small-input behaviour that breaks our fixed-position
// bars. Overrides the app-wide viewport from the root layout.
export const viewport: Viewport = {
  themeColor: "#F2EDE6",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Public signer entry. The tRPC caller is built with userId=null —
// `publicByToken` is a mutation (it writes viewedAt on first open), so
// we call it from the server component on every request. The DB
// side-effect is idempotent from the second view onwards (signedAt
// is checked by the mutation itself).
export default async function SignPage({ params }: PageProps) {
  const { token } = await params;
  const caller = appRouter.createCaller({ userId: null });

  let initial;
  try {
    initial = await caller.contract.publicByToken({ token });
  } catch {
    notFound();
  }

  return (
    <main className="min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <SignerView token={token} initial={initial} />
    </main>
  );
}
