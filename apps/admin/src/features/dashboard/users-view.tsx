import Link from "next/link";

import type {
  DemoAccountStatus,
  DemoUserDirectory,
  DemoUserProfile,
} from "~/lib/admin-demo-view-models";
import styles from "./dashboard.module.css";
import { Badge, EmptyState, PageHeader, Panel } from "./shared";

function accountTone(status: DemoAccountStatus): "danger" | "success" | "warning" {
  if (status === "Active") return "success";
  if (status === "Suspended") return "danger";
  return "warning";
}

export type UserRoleFilter = "all" | "artist" | "both" | "producer";

export function parseUserRoleFilter(value: string | undefined): UserRoleFilter {
  return value === "artist" || value === "both" || value === "producer" ? value : "all";
}

export function UsersDirectoryView({
  data,
  query = "",
  role = "all",
}: {
  data: DemoUserDirectory;
  query?: string;
  role?: UserRoleFilter;
}) {
  const base = `/${data.environment}/users`;
  const normalizedQuery = query.trim().toLowerCase();
  const roleHref = (nextRole: UserRoleFilter) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (nextRole !== "all") params.set("role", nextRole);
    const search = params.toString();
    return search ? `${base}?${search}` : base;
  };
  const users = data.users.filter((user) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [user.name, user.email, user.id].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      );
    const matchesRole =
      role === "all" ||
      (role === "producer" && user.roles.includes("Producer")) ||
      (role === "artist" && user.roles.includes("Artist")) ||
      (role === "both" && user.roles.length === 2);
    return matchesQuery && matchesRole;
  });

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Registered accounts"
        title="Users."
        description="Find one registered person once, understand every role, and spot accounts that need support."
        updatedAt={data.updatedAt}
      />

      <form className={styles.toolbar} action={base} role="search">
        <input
          aria-label="Search registered users"
          className={styles.search}
          defaultValue={query}
          name="query"
          placeholder="Search name, email, or Clerk ID…"
          type="search"
        />
        {role === "all" ? null : <input name="role" type="hidden" value={role} />}
        <div className={styles.filters} aria-label="Example role filters">
          <Link
            aria-current={role === "all" ? "page" : undefined}
            className={styles.filter}
            data-active={role === "all"}
            href={roleHref("all")}
          >
            All roles
          </Link>
          <Link
            aria-current={role === "producer" ? "page" : undefined}
            className={styles.filter}
            data-active={role === "producer"}
            href={roleHref("producer")}
          >
            Producers
          </Link>
          <Link
            aria-current={role === "artist" ? "page" : undefined}
            className={styles.filter}
            data-active={role === "artist"}
            href={roleHref("artist")}
          >
            Artists
          </Link>
          <Link
            aria-current={role === "both" ? "page" : undefined}
            className={styles.filter}
            data-active={role === "both"}
            href={roleHref("both")}
          >
            Both roles
          </Link>
        </div>
      </form>

      {users.length === 0 ? (
        <section className={styles.panel}>
          <EmptyState>No registered demo account matches this search and role filter.</EmptyState>
        </section>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Onboarding</th>
                  <th>Activation</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className={styles.identity}>
                        <span className={styles.avatar} aria-hidden="true">
                          {user.initials}
                        </span>
                        <div>
                          <Link className={styles.recordLink} href={`${base}/${user.id}`}>
                            {user.name}
                          </Link>
                          <span>{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={styles.badges}>
                        {user.roles.map((userRole) => (
                          <Badge key={userRole}>{userRole}</Badge>
                        ))}
                      </span>
                    </td>
                    <td>
                      <Badge tone={accountTone(user.status)}>{user.status}</Badge>
                    </td>
                    <td>{user.onboarding}</td>
                    <td>{user.activation}</td>
                    <td className={styles.itemTime}>{user.lastActivity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.mobileCards} aria-label="Registered users">
            {users.map((user) => (
              <Link className={styles.mobileCard} href={`${base}/${user.id}`} key={user.id}>
                <div className={styles.identity}>
                  <span className={styles.avatar} aria-hidden="true">
                    {user.initials}
                  </span>
                  <div>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </div>
                </div>
                <div className={styles.badges}>
                  {user.roles.map((userRole) => (
                    <Badge key={userRole}>{userRole}</Badge>
                  ))}
                  <Badge tone={accountTone(user.status)}>{user.status}</Badge>
                </div>
                <div className={styles.mobileCardMeta}>
                  <span>{user.activation}</span>
                  <span>{user.lastActivity}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const PROFILE_TABS = ["summary", "activity", "business", "support"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function parseProfileTab(value: string | undefined): ProfileTab {
  return PROFILE_TABS.includes(value as ProfileTab) ? (value as ProfileTab) : "summary";
}

export function UserProfileView({ data, tab }: { data: DemoUserProfile; tab: ProfileTab }) {
  const base = `/${data.environment}/users/${data.user.id}`;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Registered account"
        title={data.user.name}
        description="One identity across producer and artist roles. Private information stays hidden until a real audited reveal exists."
        updatedAt={data.updatedAt}
      />

      <section className={styles.profileHeader}>
        <div className={styles.profileIdentity}>
          <span className={styles.avatar} aria-hidden="true">
            {data.user.initials}
          </span>
          <div>
            <h2>{data.user.name}</h2>
            <p>{data.user.email}</p>
          </div>
        </div>
        <div className={styles.badges}>
          {data.user.roles.map((role) => (
            <Badge key={role}>{role}</Badge>
          ))}
          <Badge tone={accountTone(data.user.status)}>{data.user.status}</Badge>
        </div>
      </section>

      <nav className={styles.tabs} aria-label="User profile sections">
        {PROFILE_TABS.map((profileTab) => (
          <Link
            aria-current={tab === profileTab ? "page" : undefined}
            className={styles.tab}
            data-active={tab === profileTab}
            href={`${base}?tab=${profileTab}`}
            key={profileTab}
          >
            {profileTab[0]?.toUpperCase()}
            {profileTab.slice(1)}
          </Link>
        ))}
      </nav>

      <div className={styles.profileGrid}>
        <Panel
          title={
            tab === "summary"
              ? "Account summary"
              : tab === "activity"
                ? "Meaningful activity"
                : tab === "business"
                  ? "Business state"
                  : "Support context"
          }
          meta="Demo view"
        >
          {tab === "activity" ? (
            <ul className={styles.activityList}>
              {data.activity.map((activity) => (
                <li className={styles.activityItem} key={activity.id}>
                  <span
                    className={styles.activityDot}
                    data-tone={activity.tone}
                    aria-hidden="true"
                  />
                  <div>
                    <p className={styles.itemTitle}>{activity.label}</p>
                    <p className={styles.itemDetail}>{activity.detail}</p>
                  </div>
                  <span className={styles.itemTime}>{activity.occurredAt}</span>
                </li>
              ))}
            </ul>
          ) : (
            <dl className={styles.detailList}>
              {(tab === "summary"
                ? data.summary
                : tab === "business"
                  ? data.business
                  : data.support
              ).map((fact) => (
                <div className={styles.detailRow} key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <aside className={styles.actionRail}>
          <header className={styles.actionRailHeader}>
            <h3>Account controls</h3>
            <p>{data.capability.reason}</p>
          </header>
          <div className={styles.actionList}>
            <button className={styles.disabledButton} disabled type="button">
              Suspend account
            </button>
            <button className={styles.disabledButton} disabled type="button">
              Hide public page
            </button>
            <button className={styles.disabledButton} disabled type="button">
              Restart onboarding
            </button>
            <button className={styles.disabledButton} disabled type="button">
              Add private support note
            </button>
          </div>
          <div className={styles.dangerZone}>
            <p className={styles.dangerLabel}>Danger zone · desktop only</p>
            <button className={styles.disabledButton} disabled type="button">
              Schedule workspace deletion
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
