import { notFound, redirect } from "next/navigation";

import {
  AdminAccessError,
  requireActiveAdminAccess,
  requireFounderRole,
  requireFounderWithMfaEnrollment,
  type FounderIdentity,
} from "./access";

function handlePageAccessError(error: unknown): never {
  if (!(error instanceof AdminAccessError)) {
    throw error;
  }

  switch (error.reason) {
    case "signed-out":
      return redirect("/sign-in");
    case "founder-role-required":
    case "impersonated-session":
      return notFound();
    case "mfa-enrollment-required":
      return redirect("/mfa-required");
    case "second-factor-required":
      return redirect("/unlock?reason=mfa");
    case "activity-lock-required":
      return redirect("/unlock?reason=inactive");
    case "configuration-invalid":
      throw new Error("Admin access configuration is unavailable.");
  }
}

export async function requireActiveAdminPage(): Promise<FounderIdentity> {
  try {
    return await requireActiveAdminAccess();
  } catch (error) {
    return handlePageAccessError(error);
  }
}

export async function requireFounderEnrollmentPage(): Promise<FounderIdentity> {
  try {
    return await requireFounderWithMfaEnrollment();
  } catch (error) {
    return handlePageAccessError(error);
  }
}

export async function requireFounderRolePage(): Promise<FounderIdentity> {
  try {
    return await requireFounderRole();
  } catch (error) {
    return handlePageAccessError(error);
  }
}
