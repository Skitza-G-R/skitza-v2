"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AdminEnvironmentId } from "~/server/environment";

const OPTIONS = [
  { id: "live", label: "Live" },
  { id: "test", label: "Test" },
] as const;

const SECTION_PATHS = new Set(["analytics", "payments", "system-health", "users"]);

export function EnvironmentSwitcher({ environment }: { environment: AdminEnvironmentId }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const selectedSection =
    (segments[0] === "live" || segments[0] === "test") &&
    segments[1] !== undefined &&
    SECTION_PATHS.has(segments[1])
      ? segments[1]
      : undefined;

  return (
    <nav className="environment-switcher" aria-label="Data environment">
      {OPTIONS.map((option) => {
        // Record IDs are environment-specific. Switching from a detail page
        // therefore returns to the same section's safe list view.
        const destination = `/${option.id}${selectedSection ? `/${selectedSection}` : ""}`;

        return (
          <Link
            className="environment-option"
            data-environment={option.id}
            href={destination}
            key={option.id}
            aria-current={environment === option.id ? "page" : undefined}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
