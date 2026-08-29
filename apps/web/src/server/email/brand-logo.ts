// The Skitza app tile that heads transactional email: the amber rounded
// square with the "S" mark, on a transparent background.
//
// WHY A BARE TILE AND NOT THE FULL LOCKUP
//
// Email clients recolour backgrounds in dark mode but NEVER touch images.
// The previous version shipped the full "skitza." lockup as one PNG with the
// hero's #0e0d08 background baked in, and that single fact broke it in both
// directions:
//
//   - Gmail Android partial-inverts: it repainted the light card dark but
//     left the PNG alone, so the logo's black background showed up as a slab
//     inside a white band.
//   - Gmail iOS and Outlook Windows FULL-invert, which turns a dark-designed
//     email light — so building the email dark just moves the same seam.
//
// There is no static colour that survives every client. The fix is to stop
// asking an image to carry a background at all: this tile is self-contained
// amber on transparency, so it reads correctly on any page colour, and the
// "skitza." wordmark is set as live text that each client recolours for us.
//
// Generated from apps/web/public/icons/skitza-512.png — downscaled to 96px
// (2x of its 48px display size) and corner-rounded at 24% with a 4x
// supersampled mask. Regenerate from that icon if the mark ever changes.

/** Referenced from the template as <Img src="cid:skitzatile" />. */
export const EMAIL_LOGO_CID = "skitzatile";
export const EMAIL_LOGO_FILENAME = "skitza-tile.png";

/** Natural size 96x96; rendered at half for retina crispness. */
export const EMAIL_LOGO_WIDTH = 48;
export const EMAIL_LOGO_HEIGHT = 48;

export const EMAIL_LOGO_PNG_BASE64 =
  "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" +
  "py4GD2QAAAAASUVORK5CYII=";