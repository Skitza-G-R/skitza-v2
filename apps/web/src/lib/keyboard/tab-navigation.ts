/** Returns the next index for a horizontal, wrapping ARIA tab list. */
export function nextTabIndex(currentIndex: number, tabCount: number, key: string): number | null {
  if (tabCount <= 0) return null;

  switch (key) {
    case "ArrowRight":
      return (currentIndex + 1) % tabCount;
    case "ArrowLeft":
      return (currentIndex - 1 + tabCount) % tabCount;
    case "Home":
      return 0;
    case "End":
      return tabCount - 1;
    default:
      return null;
  }
}
