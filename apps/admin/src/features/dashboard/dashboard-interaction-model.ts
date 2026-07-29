export type DashboardBreadcrumbItem = {
  href?: string;
  label: string;
};

export type PaginationModel = {
  currentPage: number;
  endItem: number;
  pages: readonly number[];
  startItem: number;
  totalPages: number;
};

export type FloatingMenuPlacement = "down" | "up";

export type FloatingMenuPosition = {
  left: number;
  top: number;
};

type FloatingMenuRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

const SECTION_LABELS: Readonly<Record<string, string>> = {
  analytics: "Analytics",
  payments: "Payments",
  "system-health": "Health",
  users: "Users",
};

export function buildDashboardBreadcrumbs(
  pathname: string,
  trustedRecordLabel?: string,
): readonly DashboardBreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean);
  const environment = segments[0];

  if (environment !== "live" && environment !== "test") {
    return [{ label: "Admin" }];
  }

  const environmentLabel = environment === "live" ? "Live" : "Test";
  const items: DashboardBreadcrumbItem[] = [
    {
      href: `/${environment}`,
      label: environmentLabel,
    },
  ];
  const section = segments[1];
  const sectionLabel = section ? SECTION_LABELS[section] : undefined;

  if (section && sectionLabel) {
    items.push({
      href: `/${environment}/${section}`,
      label: sectionLabel,
    });
  }

  const safeRecordLabel = trustedRecordLabel?.trim();
  if (segments.length > 2 && sectionLabel && safeRecordLabel) {
    items.push({ label: safeRecordLabel });
  } else if (items.length > 0) {
    const lastItem = items.at(-1);
    if (lastItem) delete lastItem.href;
  }

  return items;
}

export function createPaginationModel({
  currentPage,
  pageSize,
  totalItems,
}: {
  currentPage: number;
  pageSize: number;
  totalItems: number;
}): PaginationModel {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const safeTotalItems = Math.max(0, Math.floor(totalItems));
  const totalPages = Math.max(1, Math.ceil(safeTotalItems / safePageSize));
  const safeCurrentPage = Math.min(totalPages, Math.max(1, Math.floor(currentPage)));
  const firstVisiblePage = Math.max(1, Math.min(safeCurrentPage - 2, totalPages - 4));
  const lastVisiblePage = Math.min(totalPages, firstVisiblePage + 4);
  const pages = Array.from(
    { length: lastVisiblePage - firstVisiblePage + 1 },
    (_, index) => firstVisiblePage + index,
  );

  return {
    currentPage: safeCurrentPage,
    endItem: Math.min(safeTotalItems, safeCurrentPage * safePageSize),
    pages,
    startItem: safeTotalItems === 0 ? 0 : (safeCurrentPage - 1) * safePageSize + 1,
    totalPages,
  };
}

export function calculateFloatingMenuPosition({
  menu,
  placement,
  trigger,
  viewportHeight,
  viewportWidth,
}: {
  menu: Pick<FloatingMenuRect, "height" | "width">;
  placement: FloatingMenuPlacement;
  trigger: Omit<FloatingMenuRect, "height" | "width">;
  viewportHeight: number;
  viewportWidth: number;
}): FloatingMenuPosition {
  const gap = 6;
  const viewportPadding = 16;
  const maximumLeft = Math.max(viewportPadding, viewportWidth - menu.width - viewportPadding);
  const left = Math.min(
    maximumLeft,
    Math.max(viewportPadding, trigger.right - menu.width),
  );
  const topWhenDown = trigger.bottom + gap;
  const topWhenUp = trigger.top - menu.height - gap;
  const fitsDown = topWhenDown + menu.height <= viewportHeight - viewportPadding;
  const fitsUp = topWhenUp >= viewportPadding;
  const preferredTop = placement === "up" ? topWhenUp : topWhenDown;
  const alternateTop = placement === "up" ? topWhenDown : topWhenUp;
  const preferredFits = placement === "up" ? fitsUp : fitsDown;
  const alternateFits = placement === "up" ? fitsDown : fitsUp;
  const unclampedTop = preferredFits ? preferredTop : alternateFits ? alternateTop : preferredTop;
  const maximumTop = Math.max(viewportPadding, viewportHeight - menu.height - viewportPadding);

  return {
    left,
    top: Math.min(maximumTop, Math.max(viewportPadding, unclampedTop)),
  };
}
