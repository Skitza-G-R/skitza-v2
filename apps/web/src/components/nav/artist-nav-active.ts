const matchesSection = (pathname: string, section: string): boolean =>
  pathname === section || pathname.startsWith(`${section}/`);

export function isArtistNavItemActive(pathname: string, href: string): boolean {
  if (href === "/artist") return pathname === "/artist";

  if (href === "/artist/store") {
    return (
      matchesSection(pathname, href) ||
      matchesSection(pathname, "/artist/purchase") ||
      matchesSection(pathname, "/artist/offers")
    );
  }

  return matchesSection(pathname, href);
}
