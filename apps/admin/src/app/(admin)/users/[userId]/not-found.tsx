"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "~/features/registered-users/registered-users.module.css";

export default function RegisteredUserNotFound() {
  const pathname = usePathname();
  const environment = pathname.split("/").filter(Boolean)[0];
  const usersHref =
    environment === "live" || environment === "test"
      ? `/${environment}/users`
      : "/";

  return (
    <section className={styles.emptyState}>
      <strong>This registered account is not available.</strong>
      <p>
        It may belong to another environment, or its saved link may no longer
        be valid.
      </p>
      <Link href={usersHref}>Back to Users</Link>
    </section>
  );
}
