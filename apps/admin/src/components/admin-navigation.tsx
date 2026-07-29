"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AdminEnvironmentId } from "~/server/environment";

const ITEMS = [
  { icon: "grid", label: "Overview", section: "" },
  { icon: "users", label: "Users", section: "users" },
  { icon: "payments", label: "Payments", section: "payments" },
  { icon: "chart", label: "Analytics", section: "analytics" },
  {
    icon: "pulse",
    label: "Health & history",
    section: "system-health",
  },
] as const;

type IconName = (typeof ITEMS)[number]["icon"];

function NavigationIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: (
      <>
        <rect height="6" rx="1" width="6" x="3" y="3" />
        <rect height="6" rx="1" width="6" x="15" y="3" />
        <rect height="6" rx="1" width="6" x="3" y="15" />
        <rect height="6" rx="1" width="6" x="15" y="15" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    payments: (
      <>
        <rect height="14" rx="2" width="20" x="2" y="5" />
        <path d="M2 10h20M6 15h2" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19V9M10 19V5M16 19v-7M22 19V2" />
        <path d="M2 19h22" />
      </>
    ),
    pulse: <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />,
  };

  return (
    <svg aria-hidden="true" className="admin-nav-icon" fill="none" viewBox="0 0 24 24">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name]}
      </g>
    </svg>
  );
}

export function AdminNavigation({
  environment,
  mobile = false,
}: {
  environment: AdminEnvironmentId;
  mobile?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="admin-navigation" data-mobile={mobile || undefined}>
      {ITEMS.map((item) => {
        const href = `/${environment}${item.section ? `/${item.section}` : ""}`;
        const active =
          item.section === ""
            ? pathname === href || pathname === `${href}/`
            : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className="admin-nav-link"
            href={href}
            key={item.label}
          >
            <NavigationIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
