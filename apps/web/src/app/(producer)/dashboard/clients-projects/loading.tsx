import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /dashboard/clients-projects.
// Mirrors the WorkspaceListView shape: header strip with eyebrow + h1 +
// primary CTA, then a 4-tile KPI strip, then the segmented Clients /
// Projects tab control, then the filter-chip + layout + sort toolbar,
// and finally the card grid body. The previous version of this file
// mirrored the old stage-grouped /dashboard/projects page and caused a
// visible layout jump when the new workspace mounted.
export default function ClientsProjectsLoading() {
  return (
    <div
      aria-hidden
      aria-label="Loading workspace"
      className="mx-auto max-w-[1400px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10"
    >
      {/* Header strip: eyebrow + h1 + right CTA pill */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32 rounded-full" />
      </div>

      {/* 4-tile KPI strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Skeleton className="h-[88px]" />
        <Skeleton className="h-[88px]" />
        <Skeleton className="h-[88px]" />
        <Skeleton className="h-[88px]" />
      </div>

      {/* Tab seg (Clients / Projects) */}
      <div className="mt-6 flex gap-2">
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>

      {/* Toolbar: filter chips + (sort/layout cluster) */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-14 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>

      {/* List body — card grid placeholder. 1 col on mobile, 2 col on
          tablet, 3 col on desktop matches the live WorkspaceListView. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
      </div>
    </div>
  );
}
