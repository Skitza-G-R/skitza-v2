import type { AdminEnvironmentId } from "~/server/environment";

const OPTIONS = [
  { id: "live", label: "Live" },
  { id: "test", label: "Test" },
] as const;

export function EnvironmentSwitcher({
  environment,
}: {
  environment: AdminEnvironmentId;
}) {
  return (
    <nav className="environment-switcher" aria-label="Data environment">
      {OPTIONS.map((option) => (
        <a
          className="environment-option"
          data-environment={option.id}
          href={`/?environment=${option.id}`}
          key={option.id}
          aria-current={environment === option.id ? "page" : undefined}
        >
          {option.label}
        </a>
      ))}
    </nav>
  );
}
