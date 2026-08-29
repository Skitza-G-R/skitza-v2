"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "~/features/registered-users/registered-users.module.css";

export default function RegisteredUsersError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const environment = pathname.split("/").filter(Boolean)[0];
  const usersHref =
    environment === "live" || environment === "test"
      ? `/${environment}/users`
      : "/";

  return (
    <section className={styles.emptyState} role="alert">
      <strong>Users could not be loaded.</strong>
      <p>
        Loading failed, but no account changes were made. Retry once, or return
        to the first Users page.
      </p>
      <div className={styles.inlineActions}>
        <button className={styles.primaryButton} onClick={reset} type="button">
          Try again
        </button>
        <Link className={styles.secondaryButton} href={usersHref}>
          First Users page
        </Link>
      </div>
    </section>
  );
}
