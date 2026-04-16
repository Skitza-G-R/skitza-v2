import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";

export default async function Dashboard() {
  const user = await currentUser();
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Welcome, {user?.firstName ?? "producer"}.</h1>
      <p className="text-[rgb(var(--fg-secondary))]">Your studio dashboard will appear here.</p>
      <Link
        href="/dashboard/portfolio"
        className="mt-4 inline-block text-sm font-medium text-[rgb(var(--brand-primary))] hover:underline"
      >
        Manage portfolio &rarr;
      </Link>
    </main>
  );
}
