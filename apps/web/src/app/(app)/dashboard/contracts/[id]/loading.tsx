import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /dashboard/contracts/[id]. Server
// work includes signing a fresh R2 URL for the PDF; react-pdf is then
// lazy-loaded after hydration. The skeleton mirrors the editor shell
// (toolbar + canvas + inspector) so the transition is a smooth swap
// rather than a blank flash.
export default function ContractEditorLoading() {
  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-base))]">
      <div className="h-[57px] border-b border-[rgb(var(--border-subtle))]" />
      <div className="mx-auto flex max-w-7xl gap-4 px-4 py-6 sm:px-6">
        <Skeleton className="hidden h-[70vh] w-56 md:block" />
        <Skeleton className="h-[70vh] flex-1" />
        <Skeleton className="hidden h-[70vh] w-64 lg:block" />
      </div>
    </div>
  );
}
