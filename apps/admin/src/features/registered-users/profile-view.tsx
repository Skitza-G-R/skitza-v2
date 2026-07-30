import Link from "next/link";
import type { ReactNode } from "react";

import type { AdminEnvironmentId } from "~/server/environment";
import {
  REGISTERED_USER_PROFILE_TABS,
  type RegisteredUserBusinessCounts,
  type RegisteredUserProfileHeader,
  type RegisteredUserProfileTab,
  type RegisteredUserProfileTabData,
} from "~/server/registered-users/service";
import { CopyUserId, RevealSupportNote } from "./client-controls";
import styles from "./registered-users.module.css";
import {
  buildUserProfileHref,
  formatAdminDate,
  humanizeAdminCode,
  initials,
  safeMetadataEntries,
} from "./view-model";

function classes(...values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}

function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "danger" | "muted" | "success" | "warning";
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}

function statusTone(
  status: RegisteredUserProfileHeader["status"],
): "danger" | "success" | "warning" {
  if (status === "Active") return "success";
  if (status === "Deleted" || status === "Restricted") return "danger";
  return "warning";
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SummaryTab({ header }: { header: RegisteredUserProfileHeader }) {
  const deleted = header.status === "Deleted";
  return (
    <section aria-labelledby="summary-heading" className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Account facts</p>
          <h2 id="summary-heading">Summary</h2>
        </div>
        <span>
          {deleted
            ? "Minimal provider tombstone"
            : "Provider + Skitza relationships"}
        </span>
      </header>
      <dl className={styles.factGrid}>
        {!deleted ? (
          <>
            <Fact label="Identity source" value={header.identitySource} />
            <Fact
              label="Email verified"
              value={
                header.emailVerified === null
                  ? "Not recorded"
                  : header.emailVerified
                    ? "Verified"
                    : "Not verified"
              }
            />
            <Fact
              label="Audience"
              value={humanizeAdminCode(header.audienceType)}
            />
          </>
        ) : null}
        <Fact
          label="Provider state"
          value={humanizeAdminCode(header.providerState)}
        />
        <Fact
          label="Signed up"
          value={formatAdminDate(header.providerCreatedAt)}
        />
        {!deleted ? (
          <>
            <Fact
              label="Last sign-in"
              value={formatAdminDate(header.lastSignInAt)}
            />
            <Fact label="Onboarding" value={header.onboarding} />
            <Fact label="Activation" value={header.activation} />
            <Fact
              label="Last meaningful activity"
              value={formatAdminDate(header.lastMeaningfulActivityAt)}
            />
          </>
        ) : null}
        <Fact
          label="Provider updated"
          value={formatAdminDate(header.providerUpdatedAt)}
        />
      </dl>
    </section>
  );
}

function ActivityTab({
  activityCursor,
  data,
  environment,
  header,
  userId,
}: {
  activityCursor: string | null;
  data: Extract<RegisteredUserProfileTabData, { tab: "activity" }>;
  environment: AdminEnvironmentId;
  header: RegisteredUserProfileHeader;
  userId: string;
}) {
  const newestHref = buildUserProfileHref(
    environment,
    userId,
    "activity",
  );
  return (
    <section aria-labelledby="activity-heading" className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Safe event metadata</p>
          <h2 id="activity-heading">Activity</h2>
        </div>
        <span>Newest first · 50 per page</span>
      </header>
      {data.cursorReset ? (
        <div className={styles.notice} role="status">
          That activity page expired, so we returned to the newest events.
        </div>
      ) : null}
      {data.items.length ? (
        <ol className={styles.timeline}>
          {data.items.map((item) => {
            const metadata = safeMetadataEntries(item.safeMetadata);
            return (
              <li key={`${item.eventName}:${item.id}`}>
                <span aria-hidden="true" className={styles.timelineDot} />
                <div>
                  <div className={styles.timelineTop}>
                    <strong>{humanizeAdminCode(item.eventName)}</strong>
                    <time dateTime={item.occurredAt.toISOString()}>
                      {formatAdminDate(item.occurredAt)}
                    </time>
                  </div>
                  <p>
                    {humanizeAdminCode(item.targetType)} ·{" "}
                    <code>{item.targetId}</code>
                  </p>
                  {metadata.length ? (
                    <dl className={styles.metadata}>
                      {metadata.map((entry) => (
                        <div key={entry.key}>
                          <dt>{entry.key}</dt>
                          <dd>{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.emptyInline}>
          <strong>No meaningful activity recorded.</strong>
          <p>
            Sign-ins are not counted here. This list shows safe business events
            for {header.displayName}.
          </p>
        </div>
      )}
      <div className={styles.panelFooter}>
        {data.nextCursor ? (
          <Link
            href={buildUserProfileHref(
              environment,
              userId,
              "activity",
              data.nextCursor,
            )}
            prefetch={false}
          >
            Older activity →
          </Link>
        ) : (
          <span>End of recorded activity</span>
        )}
        {activityCursor || data.cursorReset ? (
          <Link href={newestHref} prefetch={false}>
            Back to newest
          </Link>
        ) : null}
      </div>
    </section>
  );
}

const COUNT_LABELS = [
  ["projects", "Projects"],
  ["purchaseRequests", "Requests"],
  ["purchases", "Purchases"],
  ["bookings", "Bookings"],
  ["paymentRecords", "Payment records"],
] as const;

function BusinessCounts({
  counts,
  title,
}: {
  counts: RegisteredUserBusinessCounts;
  title: string;
}) {
  return (
    <section className={styles.countGroup}>
      <h3>{title}</h3>
      <dl>
        {COUNT_LABELS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{counts[key].toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BusinessTab({
  data,
  header,
}: {
  data: Extract<RegisteredUserProfileTabData, { tab: "business" }>["data"];
  header: RegisteredUserProfileHeader;
}) {
  return (
    <div className={styles.businessGrid}>
      <section aria-labelledby="business-heading" className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.panelEyebrow}>Role-aware totals</p>
            <h2 id="business-heading">Business</h2>
          </div>
          <span>Read only</span>
        </header>
        <div className={styles.countGroups}>
          {header.roles.includes("Producer") ? (
            <BusinessCounts counts={data.counts.asProducer} title="As producer" />
          ) : null}
          {header.roles.includes("Artist") || data.totalStudios > 0 ? (
            <BusinessCounts counts={data.counts.asArtist} title="As artist" />
          ) : null}
          {!header.roles.length && data.totalStudios === 0 ? (
            <div className={styles.emptyInline}>
              <strong>No business role is currently mapped.</strong>
              <p>The registered account still remains visible for support.</p>
            </div>
          ) : null}
        </div>
      </section>

      {data.producer ? (
        <section aria-labelledby="producer-heading" className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>Producer record</p>
              <h2 id="producer-heading">Workspace</h2>
            </div>
          </header>
          <dl className={styles.stackFacts}>
            <Fact
              label="Name"
              value={data.producer.displayName ?? "Not recorded"}
            />
            <Fact label="Email" value={data.producer.email} />
            <Fact label="Slug" value={data.producer.slug} />
            <Fact label="Onboarding" value={data.producer.onboarding} />
            <Fact
              label="Created"
              value={formatAdminDate(data.producer.createdAt)}
            />
          </dl>
        </section>
      ) : null}

      <section
        aria-labelledby="studios-heading"
        className={classes(styles.panel, styles.fullWidth)}
      >
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.panelEyebrow}>Artist relationships</p>
            <h2 id="studios-heading">Studios</h2>
          </div>
          <span>
            {data.studiosTruncated
              ? `Showing 100 of ${data.totalStudios.toLocaleString("en-US")}`
              : `${data.totalStudios.toLocaleString("en-US")} total`}
          </span>
        </header>
        {data.studios.length ? (
          <div className={styles.studioList}>
            {data.studios.map((studio) => (
              <article key={studio.id}>
                <div>
                  <strong>
                    {studio.producerDisplayName ?? "Unnamed producer"}
                  </strong>
                  <code>{studio.producerId}</code>
                </div>
                <span className={styles.badgeRow}>
                  {studio.archivedAt ? (
                    <Badge tone="warning">Artist disconnected</Badge>
                  ) : (
                    <Badge tone="success">Active artist link</Badge>
                  )}
                  {studio.producerArchivedAt ? (
                    <Badge>Archived in studio</Badge>
                  ) : null}
                </span>
                <time dateTime={studio.lastSeenAt.toISOString()}>
                  Seen {formatAdminDate(studio.lastSeenAt)}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyInline}>
            <strong>No studio history.</strong>
            <p>No registered artist relationship is recorded for this account.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function SupportTab({
  data,
  environment,
  providerDashboardUrl,
  userId,
}: {
  data: Extract<RegisteredUserProfileTabData, { tab: "support" }>["data"];
  environment: AdminEnvironmentId;
  providerDashboardUrl: string;
  userId: string;
}) {
  return (
    <div className={styles.supportGrid}>
      <section aria-labelledby="provider-heading" className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.panelEyebrow}>Selected environment</p>
            <h2 id="provider-heading">Clerk sync</h2>
          </div>
          <Badge
            tone={data.provider.state === "active" ? "success" : "warning"}
          >
            {humanizeAdminCode(data.provider.state)}
          </Badge>
        </header>
        <dl className={styles.stackFacts}>
          <Fact label="Last sync" value={formatAdminDate(data.provider.syncedAt)} />
          <Fact
            label="Provider updated"
            value={formatAdminDate(data.provider.updatedAt)}
          />
          <Fact
            label="Last event"
            value={
              data.provider.lastEventReference ? (
                <code>{data.provider.lastEventReference}</code>
              ) : (
                "Not recorded"
              )
            }
          />
        </dl>
        <a
          className={styles.secondaryButton}
          href={providerDashboardUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open this Clerk instance ↗
        </a>
      </section>

      <section
        aria-labelledby="support-heading"
        className={classes(styles.panel, styles.supportTimelinePanel)}
      >
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.panelEyebrow}>Private support ledger</p>
            <h2 id="support-heading">Notes & admin history</h2>
          </div>
          <span>
            {data.truncated
              ? `Showing 100 of ${data.totalItems.toLocaleString("en-US")}`
              : `${data.totalItems.toLocaleString("en-US")} entries`}
          </span>
        </header>
        {data.items.length ? (
          <ol className={styles.supportTimeline}>
            {data.items.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <div className={styles.timelineTop}>
                  <strong>
                    {item.kind === "note"
                      ? "Private support note"
                      : humanizeAdminCode(item.action ?? "admin action")}
                  </strong>
                  <time dateTime={item.occurredAt.toISOString()}>
                    {formatAdminDate(item.occurredAt)}
                  </time>
                </div>
                <p>
                  By <code>{item.actorClerkUserId}</code>
                  {item.outcome
                    ? ` · ${humanizeAdminCode(item.outcome)}`
                    : ""}
                </p>
                {item.kind === "note" ? (
                  <RevealSupportNote
                    environment={environment}
                    noteId={item.id}
                    userId={userId}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.emptyInline}>
            <strong>No support history yet.</strong>
            <p>No private content was loaded.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function RegisteredUserProfile({
  activityCursor,
  environment,
  header,
  providerDashboardUrl,
  requestedTab,
  tab,
  tabData,
  userId,
}: {
  activityCursor: string | null;
  environment: AdminEnvironmentId;
  header: RegisteredUserProfileHeader;
  providerDashboardUrl: string;
  requestedTab: RegisteredUserProfileTab;
  tab: RegisteredUserProfileTab;
  tabData: RegisteredUserProfileTabData;
  userId: string;
}) {
  const deleted = header.status === "Deleted";
  const visibleTabs: readonly RegisteredUserProfileTab[] = deleted
    ? ["summary"]
    : REGISTERED_USER_PROFILE_TABS;
  return (
    <div className={styles.page}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
        <Link href={`/${environment}`} prefetch={false}>
          Overview
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/${environment}/users`} prefetch={false}>
          Users
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{header.displayName}</span>
      </nav>

      <header className={styles.profileHeader}>
        <div className={styles.profileIdentity}>
          <span aria-hidden="true" className={styles.profileAvatar}>
            {initials(header.displayName)}
          </span>
          <div>
            <span className={styles.badgeRow}>
              <Badge tone={statusTone(header.status)}>{header.status}</Badge>
              {!deleted
                ? header.roles.map((role) => <Badge key={role}>{role}</Badge>)
                : null}
            </span>
            <h1>{header.displayName}</h1>
            <p>
              {deleted
                ? "Minimal provider tombstone"
                : (header.email ?? "Email not recorded")}
            </p>
          </div>
        </div>
        <div className={styles.profileMeta}>
          <span className={styles.realData}>
            <span aria-hidden="true" />
            Real data · Read only
          </span>
          <code>{userId}</code>
          <CopyUserId userId={userId} />
        </div>
      </header>

      {deleted ? (
        <div className={styles.notice} role="status">
          This is a deleted-account tombstone. Copied identity and private
          support content stay unavailable; only the minimal Summary is shown.
        </div>
      ) : null}
      {!deleted && requestedTab !== tab ? (
        <div className={styles.notice} role="status">
          That section was unavailable, so Summary is shown safely.
        </div>
      ) : null}

      <nav aria-label="User profile sections" className={styles.tabs}>
        {visibleTabs.map((profileTab) => (
            <Link
              aria-current={tab === profileTab ? "page" : undefined}
              data-active={tab === profileTab}
              href={buildUserProfileHref(
                environment,
                userId,
                profileTab,
                profileTab === "activity" ? activityCursor : null,
              )}
              key={profileTab}
              prefetch={false}
            >
              {humanizeAdminCode(profileTab)}
            </Link>
          ))}
      </nav>

      {tabData.tab === "summary" ? <SummaryTab header={header} /> : null}
      {tabData.tab === "activity" ? (
        <ActivityTab
          activityCursor={activityCursor}
          data={tabData}
          environment={environment}
          header={header}
          userId={userId}
        />
      ) : null}
      {tabData.tab === "business" ? (
        <BusinessTab data={tabData.data} header={header} />
      ) : null}
      {tabData.tab === "support" ? (
        <SupportTab
          data={tabData.data}
          environment={environment}
          providerDashboardUrl={providerDashboardUrl}
          userId={userId}
        />
      ) : null}
    </div>
  );
}
