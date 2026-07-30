import styles from "~/features/registered-users/registered-users.module.css";

export default function RegisteredUserProfileLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className={styles.page}>
      <span className={styles.visuallyHidden}>Loading user profile…</span>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Registered account</p>
          <h1>User profile</h1>
          <p>Loading the selected account and one profile section…</p>
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
