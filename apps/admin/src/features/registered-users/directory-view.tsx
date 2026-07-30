import Link from "next/link";

import type { AdminEnvironmentId } from "~/server/environment";
import type { RegisteredUserDirectoryQuery } from "~/server/registered-users/model";
import type {
  RegisteredUserDirectoryPage,
  RegisteredUserDirectoryStatus,
  RegisteredUserSummary,
} from "~/server/registered-users/service";
import { ReconcileRegisteredUsers } from "./client-controls";
import styles from "./registered-users.module.css";
import {
  buildUsersDirectoryHref,
  formatAdminDate,
  hasAdvancedDirectoryState,
  hasDirectoryFilters,
  initials,
  ROLE_FILTERS,
  STATUS_FILTERS,
} from "./view-model";

function statusTone(
  status: RegisteredUserDirectoryStatus,
): "danger" | "muted" | "success" | "warning" {
  if (status === "Active") return "success";
  if (status === "Deleted" || status === "Restricted") return "danger";
  return "warning";
}

function Badge({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "danger" | "muted" | "success" | "warning";
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}

function Identity({
  environment,
  user,
}: {
  environment: AdminEnvironmentId;
  user: RegisteredUserSummary;
}) {
  return (
    <div className={styles.identity}>
      <span aria-hidden="true" className={styles.avatar}>
        {initials(user.displayName)}
      </span>
      <div>
        <Link
          className={styles.recordLink}
          href={`/${environment}/users/${encodeURIComponent(user.clerkUserId)}`}
          prefetch={false}
        >
          {user.displayName}
        </Link>
        <span>
          {user.status === "Deleted"
            ? user.clerkUserId
            : (user.email ?? "Email not recorded")}
        </span>
      </div>
    </div>
  );
}

function SortLink({
  children,
  environment,
  query,
  sort,
}: {
  children: string;
  environment: AdminEnvironmentId;
  query: RegisteredUserDirectoryQuery;
  sort: RegisteredUserDirectoryQuery["sort"];
}) {
  const active = query.sort === sort;
  const direction = active
    ? query.direction === "asc"
      ? "desc"
      : "asc"
    : sort === "signup" || sort === "last-activity"
      ? "desc"
      : "asc";
  return (
    <Link
      aria-label={`${children}, sort ${direction === "asc" ? "ascending" : "descending"}`}
      className={styles.sortLink}
      href={buildUsersDirectoryHref(environment, query, {
        direction,
        sort,
      })}
      prefetch={false}
    >
      {children}
      <span aria-hidden="true">
        {active ? (query.direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </Link>
  );
}

function AdvancedFilters({
  query,
}: {
  query: RegisteredUserDirectoryQuery;
}) {
  return (
    <details
      className={styles.moreFilters}
      open={hasAdvancedDirectoryState(query) || undefined}
    >
      <summary>
        More filters
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.advancedGrid}>
        <label>
          <span>Onboarding</span>
          <select defaultValue={query.onboarding} name="onboarding">
            <option value="all">Any onboarding</option>
            <option value="complete">Complete</option>
            <option value="not-complete">Not complete</option>
          </select>
        </label>
        <label>
          <span>Activation</span>
          <select defaultValue={query.activation} name="activation">
            <option value="all">Any activation</option>
            <option value="activated">Activated</option>
            <option value="window-open">Window open</option>
            <option value="not-activated">Not activated</option>
            <option value="not-recorded">Not recorded</option>
          </select>
        </label>
        <label>
          <span>Signed up</span>
          <select defaultValue={query.signup} name="signup">
            <option value="all">Any time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="month">This month</option>
          </select>
        </label>
        <label>
          <span>Meaningful activity</span>
          <select defaultValue={query.activity} name="activity">
            <option value="all">Any activity</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="none">None recorded</option>
          </select>
        </label>
      </div>
      <div className={styles.filterActions}>
        <button className={styles.secondaryButton} type="submit">
          Apply filters
        </button>
      </div>
    </details>
  );
}

function MobileCard({
  environment,
  user,
}: {
  environment: AdminEnvironmentId;
  user: RegisteredUserSummary;
}) {
  const deleted = user.status === "Deleted";
  return (
    <article className={styles.mobileCard}>
      <div className={styles.mobileCardTop}>
        <Identity environment={environment} user={user} />
        <Badge tone={statusTone(user.status)}>{user.status}</Badge>
      </div>
      <dl className={styles.mobileFacts}>
        {deleted ? (
          <>
            <div>
              <dt>Provider state</dt>
              <dd>Deleted</dd>
            </div>
            <div>
              <dt>Provider created</dt>
              <dd>{formatAdminDate(user.providerCreatedAt)}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Roles</dt>
              <dd>{user.roles.length ? user.roles.join(" + ") : "None mapped"}</dd>
            </div>
            <div>
              <dt>Onboarding</dt>
              <dd>{user.onboarding}</dd>
            </div>
            <div>
              <dt>Activation</dt>
              <dd>{user.activation}</dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>{formatAdminDate(user.lastMeaningfulActivityAt)}</dd>
            </div>
          </>
        )}
      </dl>
      <Link
        className={styles.cardLink}
        href={`/${environment}/users/${encodeURIComponent(user.clerkUserId)}`}
        prefetch={false}
      >
        Open profile <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export function RegisteredUsersDirectory({
  data,
  environment,
  query,
}: {
  data: RegisteredUserDirectoryPage;
  environment: AdminEnvironmentId;
  query: RegisteredUserDirectoryQuery;
}) {
  const filtered = hasDirectoryFilters(query);
  return (
    <div className={styles.page}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
        <Link href={`/${environment}`} prefetch={false}>
          Overview
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Users</span>
      </nav>

      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Registered accounts</p>
          <h1>Users</h1>
          <p>
            Find one registered person, then see their roles and support
            history without changing the account.
          </p>
        </div>
        <div className={styles.headerTools}>
          <span className={styles.realData}>
            <span aria-hidden="true" />
            Real data · Read only
          </span>
          <ReconcileRegisteredUsers environment={environment} />
        </div>
      </header>

      {data.cursorReset ? (
        <div className={styles.notice} role="status">
          That saved page was no longer valid, so we safely returned you to the
          first page.
        </div>
      ) : null}

      <section aria-label="Find registered users" className={styles.filterPanel}>
        <form action={`/${environment}/users`} className={styles.searchForm}>
          <label className={styles.searchField}>
            <span className={styles.visuallyHidden}>Search registered users</span>
            <input
              defaultValue={query.query}
              name="q"
              placeholder="Search name, email, or Clerk ID"
              type="search"
            />
          </label>
          <input name="role" type="hidden" value={query.role} />
          <label className={styles.visibleSelect}>
            <span>Status</span>
            <select defaultValue={query.status} name="status">
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.primaryButton} type="submit">
            Search
          </button>
          {filtered ? (
            <Link
              className={styles.quietButton}
              href={`/${environment}/users`}
              prefetch={false}
            >
              Clear
            </Link>
          ) : null}
          <div className={styles.mobileSort}>
            <label>
              <span>Sort</span>
              <select defaultValue={query.sort} name="sort">
                <option value="signup">Signup</option>
                <option value="name">Name</option>
                <option value="status">Status</option>
                <option value="last-activity">Last activity</option>
              </select>
            </label>
            <label>
              <span>Direction</span>
              <select defaultValue={query.direction} name="dir">
                <option value="desc">Newest / Z–A</option>
                <option value="asc">Oldest / A–Z</option>
              </select>
            </label>
          </div>
          <AdvancedFilters query={query} />
        </form>

        <nav aria-label="Filter by role" className={styles.roleFilters}>
          {ROLE_FILTERS.map((filter) => (
            <Link
              aria-current={query.role === filter.value ? "page" : undefined}
              data-active={query.role === filter.value}
              href={buildUsersDirectoryHref(environment, query, {
                role: filter.value,
              })}
              key={filter.value}
              prefetch={false}
            >
              {filter.label}
            </Link>
          ))}
        </nav>
      </section>

      <div className={styles.resultBar}>
        <span>
          {data.items.length
            ? `${String(data.items.length)} shown · ${data.totalCount.toLocaleString("en-US")} matched`
            : "0 users matched"}
        </span>
        <span className={styles.resultSort}>
          {query.sort === "signup"
            ? query.direction === "desc"
              ? "Newest signups"
              : "Oldest signups"
            : query.sort === "name"
              ? query.direction === "asc"
                ? "Name A–Z"
                : "Name Z–A"
              : query.sort === "status"
                ? `Status ${query.direction === "asc" ? "A–Z" : "Z–A"}`
                : query.direction === "desc"
                  ? "Latest activity"
                  : "Oldest activity"}{" "}
          · 25 per page
          <span aria-hidden="true">·</span>
          <SortLink
            environment={environment}
            query={query}
            sort="signup"
          >
            Signup
          </SortLink>
        </span>
      </div>

      {data.items.length === 0 ? (
        <section className={styles.emptyState}>
          <strong>
            {filtered ? "No user matches these filters." : "No registered users yet."}
          </strong>
          <p>
            {filtered
              ? "Clear or change the filters. Nothing was modified."
              : "Use “Refresh from Clerk” to safely populate the support index."}
          </p>
          {filtered ? (
            <Link href={`/${environment}/users`} prefetch={false}>
              Clear all filters
            </Link>
          ) : null}
        </section>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <SortLink
                      environment={environment}
                      query={query}
                      sort="name"
                    >
                      Person
                    </SortLink>
                  </th>
                  <th>Role</th>
                  <th>
                    <SortLink
                      environment={environment}
                      query={query}
                      sort="status"
                    >
                      Status
                    </SortLink>
                  </th>
                  <th>Onboarding</th>
                  <th>Activation</th>
                  <th>
                    <SortLink
                      environment={environment}
                      query={query}
                      sort="last-activity"
                    >
                      Last activity
                    </SortLink>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.clerkUserId}>
                    <td>
                      <Identity environment={environment} user={user} />
                    </td>
                    <td>
                      {user.status === "Deleted" ? (
                        <span className={styles.muted}>Not retained</span>
                      ) : (
                        <span className={styles.badgeRow}>
                          {user.roles.length ? (
                            user.roles.map((role) => (
                              <Badge key={role}>{role}</Badge>
                            ))
                          ) : (
                            <span className={styles.muted}>None mapped</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge tone={statusTone(user.status)}>{user.status}</Badge>
                    </td>
                    <td>
                      {user.status === "Deleted" ? "Not retained" : user.onboarding}
                    </td>
                    <td>
                      {user.status === "Deleted" ? "Not retained" : user.activation}
                    </td>
                    <td className={styles.dateCell}>
                      {user.status === "Deleted"
                        ? "Not retained"
                        : formatAdminDate(user.lastMeaningfulActivityAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div aria-label="Registered users" className={styles.mobileCards}>
            {data.items.map((user) => (
              <MobileCard
                environment={environment}
                key={user.clerkUserId}
                user={user}
              />
            ))}
          </div>
        </>
      )}

      <nav aria-label="Users pages" className={styles.pagination}>
        <span>
          {data.totalCount.toLocaleString("en-US")} total match
          {data.totalCount === 1 ? "" : "es"}
        </span>
        <div>
          {data.previousCursor ? (
            <Link
              href={buildUsersDirectoryHref(environment, query, {
                cursor: data.previousCursor,
              })}
              prefetch={false}
            >
              ← Previous
            </Link>
          ) : (
            <span aria-disabled="true">← Previous</span>
          )}
          {data.nextCursor ? (
            <Link
              href={buildUsersDirectoryHref(environment, query, {
                cursor: data.nextCursor,
              })}
              prefetch={false}
            >
              Next →
            </Link>
          ) : (
            <span aria-disabled="true">Next →</span>
          )}
        </div>
      </nav>
    </div>
  );
}
