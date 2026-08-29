import Link from "next/link";

import styles from "./home.module.css";
import type { HomeRow, HomeView as HomeViewModel } from "./view-model";

// SK-288 — the founder's first screen. Real counts only, and an explicit
// quiet state: a screen that always shows something gets ignored within a
// week, so "Nothing needs you." is the feature, not a placeholder.

function RowContent({ row }: { row: HomeRow }) {
  return (
    <>
      <span aria-hidden="true" className={styles.rowMarker} data-tone={row.tone} />
      <strong className={styles.rowCount}>{row.count}</strong>
      <span className={styles.rowCopy}>
        <span className={styles.rowLabel}>{row.label}</span>
        {row.hint ? <span className={styles.rowHint}>{row.hint}</span> : null}
      </span>
    </>
  );
}

export function HomeView({ view }: { view: HomeViewModel }) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Private operations</p>
          <h1>Home</h1>
          <p>
            What is broken, and who is waiting on you. Nothing else lives here: anything PostHog,
            Sentry or the email provider already reports is left to them.
          </p>
        </div>
      </header>

      {view.quiet ? (
        <p className={styles.empty}>Nothing needs you.</p>
      ) : (
        <ul aria-label="What needs you" className={styles.rowList}>
          {view.rows.map((row) => (
            <li key={row.id}>
              {row.href === undefined ? (
                <div className={styles.row}>
                  <RowContent row={row} />
                </div>
              ) : (
                <Link className={styles.row} data-linked="true" href={row.href}>
                  <RowContent row={row} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
