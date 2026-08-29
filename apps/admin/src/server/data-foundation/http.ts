import { EventFoundationError, type FoundationEnvironment } from "@skitza/db";
import { NextResponse } from "next/server";

import { adminApiErrorResponse, privateAdminResponseHeaders } from "~/server/auth/api-access";
import { AdminEnvironmentConfigurationError, resolveAdminEnvironment } from "~/server/environment";
import { AdminDataFoundationError } from "./service";
import { createAdminDataFoundationRuntime } from "./runtime";

export class AdminDataHttpError extends Error {
  constructor() {
    super("Invalid admin data request.");
    this.name = "AdminDataHttpError";
  }
}

export function forbiddenAdminMutationResponse(): NextResponse {
  return NextResponse.json(
    { error: "forbidden" },
    { status: 403, headers: privateAdminResponseHeaders() },
  );
}

export function adminDataErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof AdminDataHttpError ||
    (error instanceof AdminDataFoundationError && error.code === "INVALID_INPUT") ||
    (error instanceof EventFoundationError && error.code === "UNSAFE_METADATA")
  ) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: privateAdminResponseHeaders() },
    );
  }
  if (error instanceof AdminDataFoundationError && error.code === "NOT_FOUND") {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: privateAdminResponseHeaders() },
    );
  }
  if (error instanceof AdminDataFoundationError && error.code === "STATE_CONFLICT") {
    return NextResponse.json(
      { error: "state_conflict" },
      { status: 409, headers: privateAdminResponseHeaders() },
    );
  }
  if (error instanceof AdminDataFoundationError && error.code === "IDEMPOTENCY_EXPIRED") {
    return NextResponse.json(
      { error: "idempotency_expired" },
      { status: 409, headers: privateAdminResponseHeaders() },
    );
  }
  if (error instanceof EventFoundationError && error.code === "IDEMPOTENCY_CONFLICT") {
    return NextResponse.json(
      { error: "idempotency_conflict" },
      { status: 409, headers: privateAdminResponseHeaders() },
    );
  }
  if (error instanceof AdminEnvironmentConfigurationError) {
    return NextResponse.json(
      { error: "admin_unavailable" },
      { status: 503, headers: privateAdminResponseHeaders() },
    );
  }
  return adminApiErrorResponse(error);
}

export function operationKeyFromRequest(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key) throw new AdminDataHttpError();
  return key;
}

export async function exactJsonObject(
  request: Request,
  allowedKeys: readonly string[],
): Promise<Readonly<Record<string, unknown>>> {
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (!contentType?.startsWith("application/json")) {
    throw new AdminDataHttpError();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AdminDataHttpError();
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AdminDataHttpError();
  }

  const record = body as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new AdminDataHttpError();
  }
  return record;
}

export function requiredBodyString(body: Readonly<Record<string, unknown>>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new AdminDataHttpError();
  return value;
}

export function nullableBodyString(
  body: Readonly<Record<string, unknown>>,
  key: string,
): string | null | undefined {
  const value = body[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new AdminDataHttpError();
  }
  return value;
}

export function runtimeForRequest(): Readonly<{
  environment: FoundationEnvironment;
  foundation: ReturnType<typeof createAdminDataFoundationRuntime>;
}> {
  const resolved = resolveAdminEnvironment(process.env);
  const environment = resolved.publicContext.id;
  return {
    environment,
    foundation: createAdminDataFoundationRuntime({
      databaseUrl: resolved.databaseUrl,
      environment,
    }),
  };
}
