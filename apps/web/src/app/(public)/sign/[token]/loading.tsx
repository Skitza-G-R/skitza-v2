// Route-segment loading state for /sign/[token]. Keeps the signer
// page from flashing white on cold loads — the heavy PDF chunk
// (react-pdf + pdfjs-dist) is lazy-loaded so the shell paints fast
// and the loading indicator sits in place of the canvas until it
// arrives.
export default function SignLoading() {
  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-base))]">
      <div className="mx-auto flex max-w-[900px] flex-col items-center gap-6 px-3 py-10 sm:px-6">
        <div className="h-10 w-2/3 animate-pulse rounded bg-[rgb(var(--bg-sunken))]" />
        <div className="h-[70vh] w-full animate-pulse rounded bg-[rgb(var(--bg-sunken))]" />
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Loading contract…
        </p>
      </div>
    </div>
  );
}
