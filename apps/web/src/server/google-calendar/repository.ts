import type { EncryptedGoogleCalendarValue } from "./crypto";
import type { GoogleCalendarAccessRole, GoogleCalendarProviderIdentity } from "./provider";
import type { GoogleCalendarOAuthIntent, GoogleCalendarOAuthStateBinding } from "./oauth";

export type GoogleCalendarConnectionStatus =
  | "needs_selection"
  | "connected"
  | "reconnect_required"
  | "disconnected";

export type GoogleCalendarConnectionRecord = Readonly<{
  id: string;
  producerId: string;
  googleSubject: string;
  googleAccountEmail: string;
  accountVersion: number;
  status: GoogleCalendarConnectionStatus;
  grantedScopes: readonly string[];
  accessToken: EncryptedGoogleCalendarValue | null;
  accessTokenExpiresAt: Date | null;
  refreshToken: EncryptedGoogleCalendarValue | null;
  lastAuthorizedAt: Date;
  reconnectRequiredAt: Date | null;
  disconnectedAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type GoogleCalendarCandidateRecord = Readonly<{
  id: string;
  connectionId: string;
  producerId: string;
  accountVersion: number;
  providerCalendarId: EncryptedGoogleCalendarValue;
  providerCalendarIdFingerprint: string;
  displayName: string;
  timezone: string | null;
  accessRole: GoogleCalendarAccessRole;
  isPrimary: boolean;
  isDestination: boolean;
  blocksAvailability: boolean;
}>;

export type NewGoogleCalendarCandidate = Omit<
  GoogleCalendarCandidateRecord,
  "isDestination" | "blocksAvailability"
>;

export type GoogleCalendarStoredOAuthState = GoogleCalendarOAuthStateBinding &
  Readonly<{
    tokenDigest: string;
    consumedAt: Date | null;
    createdAt: Date;
  }>;

export type GoogleCalendarAuthorizationCommitResult =
  | Readonly<{
      outcome: "stored";
      connection: GoogleCalendarConnectionRecord;
    }>
  | Readonly<{
      outcome: "stale" | "wrong_account" | "missing_refresh";
    }>;

export type GoogleCalendarInitialSyncEnqueueResult = Readonly<{
  scanned: number;
  linksCreated: number;
  jobsEnqueued: number;
  jobIds: readonly string[];
}>;

export type GoogleCalendarConnectionSyncIssue = Readonly<{
  bookingId: string;
  syncState: "not_synced" | "missing" | "conflict";
  bookingStatus:
    | "pending_approval"
    | "confirmed"
    | "rejected"
    | "cancelled"
    | "completed"
    | "no_show";
  artistName: string;
  startsAt: Date;
  durationMin: number;
}>;

export type GoogleCalendarConnectionSyncSummary = Readonly<{
  syncing: number;
  notSynced: number;
  missing: number;
  conflicts: number;
  issues: readonly GoogleCalendarConnectionSyncIssue[];
}>;

export type GoogleCalendarStoredWatchRecord = Readonly<{
  id: string;
  producerId: string;
  connectionId: string;
  accountVersion: number;
  destinationSelectionId: string;
  destinationCalendarId: EncryptedGoogleCalendarValue;
  destinationCalendarIdFingerprint: string;
  renewalOfWatchId: string | null;
  providerChannelId: string;
  providerResourceId: string | null;
  channelTokenDigest: string;
  state: "renewing" | "active" | "retired" | "expired";
  expiresAt: Date | null;
  activatedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}>;

export type GoogleCalendarWatchTarget = Readonly<{
  producerId: string;
  connectionId: string;
  accountVersion: number;
  destinationSelectionId: string;
  destinationCalendarId: EncryptedGoogleCalendarValue;
  destinationCalendarIdFingerprint: string;
}>;

export type GoogleCalendarWatchErrorCode =
  | "watch_create_failed"
  | "watch_renew_failed"
  | "watch_stop_failed";

export interface GoogleCalendarRepository {
  getConnection(producerId: string): Promise<GoogleCalendarConnectionRecord | null>;

  createOAuthState(state: Omit<GoogleCalendarStoredOAuthState, "consumedAt">): Promise<void>;

  consumeOAuthState(
    input: Readonly<{
      producerId: string;
      tokenDigest: string;
      consumedAt: Date;
    }>,
  ): Promise<GoogleCalendarStoredOAuthState | null>;

  commitAuthorization(
    input: Readonly<{
      producerId: string;
      intent: GoogleCalendarOAuthIntent;
      expectedConnectionId: string | null;
      expectedAccountVersion: number | null;
      oauthStateCreatedAt: Date;
      targetConnectionId: string;
      targetAccountVersion: number;
      identity: GoogleCalendarProviderIdentity;
      grantedScopes: readonly string[];
      accessToken: EncryptedGoogleCalendarValue;
      accessTokenExpiresAt: Date;
      refreshToken: EncryptedGoogleCalendarValue | null;
      authorizedAt: Date;
    }>,
  ): Promise<GoogleCalendarAuthorizationCommitResult>;

  storeRefreshedAccessToken(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      googleSubject: string;
      accountVersion: number;
      accessToken: EncryptedGoogleCalendarValue;
      accessTokenExpiresAt: Date;
      grantedScopes: readonly string[] | null;
      refreshedAt: Date;
    }>,
  ): Promise<boolean>;

  markReconnectRequired(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      accountVersion: number;
      errorCode: "refresh_invalid_grant" | "access_unauthorized";
      occurredAt: Date;
    }>,
  ): Promise<void>;

  replaceCalendarCandidates(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      accountVersion: number;
      candidates: readonly NewGoogleCalendarCandidate[];
      refreshedAt: Date;
    }>,
  ): Promise<readonly GoogleCalendarCandidateRecord[] | null>;

  listCalendarCandidates(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      accountVersion: number;
    }>,
  ): Promise<readonly GoogleCalendarCandidateRecord[]>;

  getConnectionSyncSummary(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      accountVersion: number;
    }>,
  ): Promise<GoogleCalendarConnectionSyncSummary>;

  listCalendarWatches(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      accountVersion: number;
    }>,
  ): Promise<readonly GoogleCalendarStoredWatchRecord[]>;

  listRequiredCalendarWatchTargets(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      accountVersion: number;
      now: Date;
    }>,
  ): Promise<readonly GoogleCalendarWatchTarget[]>;

  reserveCalendarWatch(
    input: Readonly<{
      id: string;
      producerId: string;
      connectionId: string;
      accountVersion: number;
      destinationSelectionId: string;
      destinationCalendarId: EncryptedGoogleCalendarValue;
      destinationCalendarIdFingerprint: string;
      renewalOfWatchId: string | null;
      providerChannelId: string;
      channelTokenDigest: string;
      reservedAt: Date;
    }>,
  ): Promise<GoogleCalendarStoredWatchRecord | null>;

  activateCalendarWatch(
    input: Readonly<{
      producerId: string;
      watchId: string;
      providerResourceId: string;
      expiresAt: Date;
      activatedAt: Date;
    }>,
  ): Promise<boolean>;

  endCalendarWatch(
    input: Readonly<{
      producerId: string;
      watchId: string;
      state: "retired" | "expired";
      errorCode: GoogleCalendarWatchErrorCode | null;
      endedAt: Date;
    }>,
  ): Promise<boolean>;

  listCalendarWatchesDueForRenewal(
    input: Readonly<{ renewBefore: Date; limit: number }>,
  ): Promise<readonly GoogleCalendarStoredWatchRecord[]>;

  listCalendarWatchRepairProducerIds(
    input: Readonly<{ now: Date; limit: number }>,
  ): Promise<readonly string[]>;

  saveCalendarSelection(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      accountVersion: number;
      destinationCalendarId: string;
      availabilityCalendarIds: readonly string[];
      savedAt: Date;
    }>,
  ): Promise<"saved" | "invalid_selection" | "stale">;

  enqueueFutureConfirmedEvents(
    input: Readonly<{
      producerId?: string;
      now: Date;
      limit: number;
    }>,
  ): Promise<GoogleCalendarInitialSyncEnqueueResult>;

  disconnect(
    input: Readonly<{
      producerId: string;
      connectionId: string;
      accountVersion: number;
      disconnectedAt: Date;
    }>,
  ): Promise<boolean>;
}
