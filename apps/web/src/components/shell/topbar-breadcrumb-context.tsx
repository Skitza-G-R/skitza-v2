"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { BreadcrumbCrumb } from "~/components/dashboard/common/breadcrumb";

// TopBarBreadcrumbContext lets deep server pages push extra crumbs
// into the sticky DashboardTopBar. Without this, the topbar could
// only show a single section label derived from the pathname (e.g.
// "Clients & Projects") — it couldn't show dynamic data like the
// current client name or project title that lives in the server
// payload of the page below it.
//
// Contract: pages provide ONLY the crumbs that come AFTER the section
// root. The topbar always renders the section root itself (so the
// section label survives even on pages that don't set extras), then
// appends whatever context provides.

type Crumbs = readonly BreadcrumbCrumb[];

interface TopBarBreadcrumbValue {
  crumbs: Crumbs;
  setCrumbs: (next: Crumbs) => void;
}

const TopBarBreadcrumbContext = createContext<TopBarBreadcrumbValue | null>(
  null,
);

export function TopBarBreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumbs>([]);
  const value = useMemo<TopBarBreadcrumbValue>(
    () => ({ crumbs, setCrumbs }),
    [crumbs],
  );
  return (
    <TopBarBreadcrumbContext.Provider value={value}>
      {children}
    </TopBarBreadcrumbContext.Provider>
  );
}

export function useTopBarBreadcrumb(): Crumbs {
  const ctx = useContext(TopBarBreadcrumbContext);
  return ctx ? ctx.crumbs : [];
}

interface SetTopBarBreadcrumbProps {
  /** Crumbs appended AFTER the section root. May be empty. */
  crumbs: Crumbs;
}

// Renders nothing — its only job is to publish the page's crumbs to
// the topbar via context. Lives inside server pages as a client
// island, so server components can describe their breadcrumb path
// declaratively without owning any client state themselves.
//
// Stable dep: we serialise `crumbs` to a string for the effect's dep
// array. Server-rendered pages rebuild the prop array on every
// navigation, so array identity changes even when content is the
// same; the JSON key prevents the effect from firing on every render.
export function SetTopBarBreadcrumb({ crumbs }: SetTopBarBreadcrumbProps) {
  const ctx = useContext(TopBarBreadcrumbContext);
  const key = JSON.stringify(crumbs);
  // `key` (JSON) intentionally is the only dep — `crumbs` array
  // identity changes every server render even when content is the
  // same, and the ctx setter is identity-stable from its provider.
  useEffect(() => {
    if (!ctx) return;
    ctx.setCrumbs(crumbs);
    return () => {
      ctx.setCrumbs([]);
    };
  }, [key]);
  return null;
}
