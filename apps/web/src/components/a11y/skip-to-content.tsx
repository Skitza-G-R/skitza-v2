"use client";

export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="skip-to-content"
      onClick={() => {
        requestAnimationFrame(() => {
          document.getElementById("main-content")?.focus({ preventScroll: true });
        });
      }}
    >
      Skip to content
    </a>
  );
}
