import type {
  GoogleCalendarPreparedLink,
  GoogleCalendarWorkerAccess,
} from "../calendar/google-delivery";
import type { GoogleCalendarServerConfig } from "./config";
import { decryptGoogleCalendarValue, encryptGoogleCalendarValue } from "./crypto";
import {
  GoogleCalendarProviderError,
  hasRequiredGoogleCalendarScopes,
  type GoogleCalendarProvider,
} from "./provider";
import type { GoogleCalendarConnectionRecord, GoogleCalendarRepository } from "./repository";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

function credentialContext(
  connection: GoogleCalendarConnectionRecord,
  purpose: "access_token" | "refresh_token",
) {
  return {
    producerId: connection.producerId,
    connectionId: connection.id,
    googleSubject: connection.googleSubject,
    accountVersion: connection.accountVersion,
    purpose,
  } as const;
}

function destinationCalendarId(
  link: GoogleCalendarPreparedLink,
  config: GoogleCalendarServerConfig,
): string {
  return decryptGoogleCalendarValue(
    {
      version: 1,
      ciphertext: link.destinationCalendarIdCiphertext,
      iv: link.destinationCalendarIdIv,
      authTag: link.destinationCalendarIdAuthTag,
      keyVersion: link.destinationCalendarIdKeyVersion,
    },
    {
      producerId: link.producerId,
      connectionId: link.connectionId,
      selectionId: link.destinationSelectionId,
      accountVersion: link.accountVersion,
      purpose: "provider_calendar_id",
    },
    config.encryption,
  );
}

export function createGoogleCalendarWorkerAccess(
  input: Readonly<{
    repository: GoogleCalendarRepository;
    provider: GoogleCalendarProvider;
    config: GoogleCalendarServerConfig;
    now?: () => Date;
  }>,
): GoogleCalendarWorkerAccess {
  const now = input.now ?? (() => new Date());

  return async (link) => {
    const connection = await input.repository.getConnection(link.producerId);
    if (
      !connection ||
      connection.id !== link.connectionId ||
      connection.accountVersion !== link.accountVersion
    ) {
      return { status: "unavailable" };
    }
    if (connection.status === "disconnected") return { status: "disconnected" };
    if (connection.status === "reconnect_required") return { status: "reconnect_required" };
    if (connection.status !== "connected") return { status: "unavailable" };

    const markReconnectRequired = async () => {
      await input.repository.markReconnectRequired({
        producerId: connection.producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
        errorCode: "access_unauthorized",
        occurredAt: now(),
      });
    };

    const currentTime = now();
    let accessToken: string;
    if (
      connection.accessToken &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() >
        currentTime.getTime() + ACCESS_TOKEN_REFRESH_SKEW_MS
    ) {
      accessToken = decryptGoogleCalendarValue(
        connection.accessToken,
        credentialContext(connection, "access_token"),
        input.config.encryption,
      );
    } else {
      if (!connection.refreshToken) {
        await input.repository.markReconnectRequired({
          producerId: connection.producerId,
          connectionId: connection.id,
          accountVersion: connection.accountVersion,
          errorCode: "refresh_invalid_grant",
          occurredAt: currentTime,
        });
        return { status: "reconnect_required" };
      }
      const refreshToken = decryptGoogleCalendarValue(
        connection.refreshToken,
        credentialContext(connection, "refresh_token"),
        input.config.encryption,
      );
      let refreshed: Awaited<ReturnType<GoogleCalendarProvider["refreshAccessToken"]>>;
      try {
        refreshed = await input.provider.refreshAccessToken(refreshToken);
      } catch (error) {
        if (
          error instanceof GoogleCalendarProviderError &&
          error.code === "refresh_invalid_grant"
        ) {
          await input.repository.markReconnectRequired({
            producerId: connection.producerId,
            connectionId: connection.id,
            accountVersion: connection.accountVersion,
            errorCode: "refresh_invalid_grant",
            occurredAt: currentTime,
          });
          return { status: "reconnect_required" };
        }
        return { status: "unavailable" };
      }
      const grantedScopes =
        refreshed.grantedScopes.length > 0 ? refreshed.grantedScopes : connection.grantedScopes;
      if (!hasRequiredGoogleCalendarScopes(grantedScopes)) {
        await markReconnectRequired();
        return { status: "reconnect_required" };
      }
      const stored = await input.repository.storeRefreshedAccessToken({
        producerId: connection.producerId,
        connectionId: connection.id,
        googleSubject: connection.googleSubject,
        accountVersion: connection.accountVersion,
        accessToken: encryptGoogleCalendarValue(
          refreshed.accessToken,
          credentialContext(connection, "access_token"),
          input.config.encryption,
        ),
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        grantedScopes: refreshed.grantedScopes.length > 0 ? refreshed.grantedScopes : null,
        refreshedAt: now(),
      });
      if (!stored) return { status: "unavailable" };
      accessToken = refreshed.accessToken;
    }

    return {
      status: "ready",
      accessToken,
      calendarId: destinationCalendarId(link, input.config),
      markReconnectRequired,
    };
  };
}
