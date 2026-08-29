import { BetaRowActions, ImportBetaList, ReleaseWaveButton } from "./beta-controls";
import styles from "./beta.module.css";
import {
  BETA_STATUS_LABELS,
  betaStatusTone,
  countBetaStatuses,
  formatBetaDate,
  groupBetaInviteesByWave,
  type BetaInviteeView,
} from "./view-model";

// SK-273 — founder Beta workspace. Server-rendered from database truth
// (statuses are refreshed by the page before this renders); all mutations
// happen in the client islands imported above.

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.summaryChip}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function WaveSection({
  invitees,
  wave,
}: {
  invitees: readonly BetaInviteeView[];
  wave: number;
}) {
  const counts = countBetaStatuses(invitees);
  return (
    <section aria-label={`Wave ${String(wave)}`} className={styles.panel}>
      <div className={styles.waveHeader}>
        <div>
          <h2>Wave {wave}</h2>
          <p>
            {counts.pending} waiting · {counts.invited} invited · {counts.signed_up} signed up ·{" "}
            {counts.active} active
          </p>
        </div>
        <ReleaseWaveButton pendingCount={counts.pending} wave={wave} />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Status</th>
              <th scope="col">Invited</th>
              <th scope="col">Signed up</th>
              <th scope="col">First project</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invitees.map((invitee) => (
              <tr key={invitee.email}>
                <td>
                  <div className={styles.person}>
                    <strong>{invitee.name ?? invitee.email}</strong>
                    {invitee.name ? <span>{invitee.email}</span> : null}
                  </div>
                </td>
                <td>
                  <span className={styles.badge} data-tone={betaStatusTone(invitee.status)}>
                    {BETA_STATUS_LABELS[invitee.status]}
                  </span>
                </td>
                <td>{formatBetaDate(invitee.invitedAt)}</td>
                <td>{formatBetaDate(invitee.signedUpAt)}</td>
                <td>{formatBetaDate(invitee.activatedAt)}</td>
                <td>
                  <BetaRowActions
                    email={invitee.email}
                    status={invitee.status}
                    wave={invitee.wave}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function BetaView({
  invitees,
}: {
  invitees: readonly BetaInviteeView[];
}) {
  const counts = countBetaStatuses(invitees);
  const waves = groupBetaInviteesByWave(invitees);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Closed beta</p>
          <h1>Beta invites</h1>
          <p>
            Import your email list, release invitation waves, and watch people move from invited to
            active. Statuses refresh from the live database every time this page loads; stalled
            invitees get one automatic nudge email each from the daily cron.
          </p>
        </div>
      </header>

      <section aria-label="Beta totals" className={styles.summaryRow}>
        <SummaryChip label="On the list" value={invitees.length} />
        <SummaryChip label="Waiting" value={counts.pending} />
        <SummaryChip label="Invited" value={counts.invited} />
        <SummaryChip label="Signed up" value={counts.signed_up} />
        <SummaryChip label="Active" value={counts.active} />
      </section>

      <ImportBetaList />

      {waves.length === 0 ? (
        <p className={styles.empty}>
          Nobody on the list yet. Paste your beta emails above — invitations only go out when you
          release a wave.
        </p>
      ) : (
        waves.map(([wave, waveInvitees]) => (
          <WaveSection
            invitees={waveInvitees}
            key={wave}
            wave={wave}
          />
        ))
      )}
    </div>
  );
}
