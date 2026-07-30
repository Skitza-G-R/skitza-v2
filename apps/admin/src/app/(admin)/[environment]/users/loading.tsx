import styles from "~/features/registered-users/registered-users.module.css";

export default function RegisteredUsersLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className={styles.page}>
      <span className={styles.visuallyHidden}>Loading registered users…</span>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Registered accounts</p>
          <h1>Users</h1>
          <p>Loading the selected environment safely…</p>
        </div>
      </header>
      <section
        className={[styles.panel, styles.skeleton]
          .filter((value): value is string => Boolean(value))
          .join(" ")}
      >
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonLine} />
      </section>
    </div>
  );
}
