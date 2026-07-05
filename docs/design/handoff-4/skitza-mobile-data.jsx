/* ===================================================================
   Skitza — mobile purchase flow · DATA + ICONS
   Section 1 sample content (reuses the desktop store's Gili Studio).
   Currency: Israeli Shekel (₪). Exported to window.
=================================================================== */

/* gradient cover art — matches the desktop store's oklch covers.
   Lighter at the top so the iOS status bar (black text) stays legible. */
/* vignette layer (safe radial-gradient) adds depth to cover art without a fragile SVG noise URL */
const SK_VIGNETTE =
  "radial-gradient(125% 115% at 50% 6%, transparent 42%, rgba(17,16,9,0.30) 100%)";

function skCover(hue) {
  return `${SK_VIGNETTE}, linear-gradient(168deg, oklch(0.82 0.075 ${hue}) 0%, oklch(0.60 0.13 ${(hue + 8) % 360}) 52%, oklch(0.42 0.135 ${(hue + 24) % 360}) 100%)`;
}
function skSwatch(hue) {
  return `linear-gradient(135deg, oklch(0.72 0.13 ${hue}) 0%, oklch(0.46 0.14 ${(hue + 30) % 360}) 100%)`;
}

const ils = (n) => "₪" + Number(n).toLocaleString("en-US");

/* ── The artist (the person using the app) ── */
const ARTIST = {
  name: "Noa",
  initials: "N",
  hue: 268,
  first: "Noa",
  full: "Noa Berman",
};

/* ── The producer behind the invite link ── */
const GILI = {
  id: "gili",
  slug: "gili-studio",
  initials: "GS",
  name: "Gili Studio",
  tagline: "Indie · vocal-led",
  bio: "Vocal-led indie records, cut warm and close in a small Tel Aviv room.",
  city: "Tel Aviv",
  hue: 30,
  rating: 4.9,
  reviews: 38,
  since: "Mar 2024",
  credits: 0,
  pay: { bank: "Hapoalim · IL •••• 4471", bit: "+972 50 ••• 4421" },
};

/* ── Portfolio tracks for the invite landing (S1) ── */
const TRACKS = [
  { id: "t1", title: "Slow Tide", artist: "with Maya Ron", len: "3:12", hue: 30 },
  { id: "t2", title: "Golden Hour", artist: "with The Avivs", len: "2:58", hue: 52 },
  { id: "t3", title: "Closer Still", artist: "with Dana Lev", len: "3:41", hue: 12 },
  { id: "t4", title: "Room 4 AM", artist: "with Yonatan K.", len: "4:05", hue: 340 },
];

/* ── Catalog (₪). g1 is the flagship/focal offer on Store browse ── */
const FLAGSHIP_ID = "g1";
const PRODUCTS = [
  {
    id: "g1",
    sku: "GS-01",
    flagship: true,
    name: "Single — start to finish",
    tagline: "Track, comp, mix & master one song in Gili’s room.",
    price: 2400,
    duration: "Multi-session · 3–4 weeks",
    sessions: 3,
    revisions: 2,
    deposit: 50,
    planHint: "Full, or 50–50",
    plans: ["full", "split"],
    includes: [
      "Up to 4 song parts tracked",
      "Comped & tuned lead vocal",
      "Full mix + master",
      "2 revision rounds",
      "WAV stems + masters delivered",
    ],
    badge: "Signature",
  },
  {
    id: "g2",
    sku: "GS-02",
    name: "3-hour vocal session",
    tagline: "Tracking + comping — walk out with stems.",
    price: 900,
    duration: "3 hours · in person",
    sessions: 1,
    revisions: 1,
    deposit: 50,
    planHint: "Full, or 50–50",
    plans: ["full", "split"],
    includes: ["Up to 4 song parts", "Comped lead vocal", "WAV stems delivered"],
    badge: null,
  },
  {
    id: "g3",
    sku: "GS-03",
    name: "Mix + master",
    tagline: "Two revision rounds, broadcast-ready.",
    price: 1300,
    duration: "Async · 7–10 days",
    sessions: 1,
    revisions: 2,
    deposit: 30,
    planHint: "Full, or a plan",
    plans: ["full", "split"],
    includes: [
      "Up to 32 stems",
      "Reference matching",
      "2 revision rounds",
      "Streaming + CD masters",
    ],
    badge: null,
  },
  {
    id: "g4",
    sku: "GS-04",
    name: "5-song album pack",
    tagline: "Bundle five singles, save 18%.",
    price: 9600,
    duration: "Multi-session · 6–10 weeks",
    sessions: 5,
    revisions: 3,
    deposit: 30,
    planHint: "Milestones",
    plans: ["milestones"],
    includes: [
      "Five booked singles",
      "Mix + master per song",
      "3 revisions per song",
      "Stem packs + loudness sheet",
    ],
    badge: "Save 18%",
  },
];
const productById = (id) => PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];

/* ===================================================================
   Icons — stroke 1.7, currentColor. Compact set for the flow.
=================================================================== */
const Ic = {
  play: (p = {}) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M4 2.8v10.4a.7.7 0 001.06.6l8.4-5.2a.7.7 0 000-1.2L5.06 2.2A.7.7 0 004 2.8z" />
    </svg>
  ),
  pause: (p = {}) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" {...p}>
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  ),
  chevL: (p = {}) => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      {...p}
    >
      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevR: (p = {}) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      {...p}
    >
      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  arrowR: (p = {}) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      {...p}
    >
      <path d="M4 12h15m0 0l-6-6m6 6l-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (p = {}) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      {...p}
    >
      <path d="M3 8.5l3.2 3.2L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  star: (p = {}) => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M8 1l2.2 4.6L15 6.3l-3.5 3.4.8 4.8L8 12.2l-4.3 2.3.8-4.8L1 6.3l4.8-.7z" />
    </svg>
  ),
  pin: (p = {}) => (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...p}
    >
      <circle cx="7" cy="6" r="2.2" />
      <path
        d="M7 12.5C9.5 9.8 11 8 11 5.6A4 4 0 003 5.6c0 2.4 1.5 4.2 4 6.9z"
        strokeLinejoin="round"
      />
    </svg>
  ),
  clock: (p = {}) => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...p}
    >
      <circle cx="7" cy="7" r="5.5" />
      <path d="M7 4v3.2l2 1.4" strokeLinecap="round" />
    </svg>
  ),
  lock: (p = {}) => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      {...p}
    >
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
      <path d="M5.4 7V5a2.6 2.6 0 015.2 0v2" />
    </svg>
  ),
  shield: (p = {}) => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      {...p}
    >
      <path d="M7 1l5 2v4c0 3-2.5 5-5 6-2.5-1-5-3-5-6V3z" strokeLinejoin="round" />
    </svg>
  ),
  refresh: (p = {}) => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...p}
    >
      <path
        d="M2.5 7a4.5 4.5 0 018-2.8M11.5 7a4.5 4.5 0 01-8 2.8M11 2v3h-3M3 12V9h3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  layers: (p = {}) => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...p}
    >
      <path d="M7 1.5l5 2.5-5 2.5-5-2.5zM2 7l5 2.5L12 7M2 9.5l5 2.5 5-2.5" strokeLinejoin="round" />
    </svg>
  ),
  spark: (p = {}) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" {...p}>
      <path d="M7 0l1.2 4.2L12.4 5.6 8.2 7 7 11.2 5.8 7 1.6 5.6 5.8 4.2z" />
    </svg>
  ),
  heart: (p = {}) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      {...p}
    >
      <path
        d="M12 20s-7-4.5-9.3-9C1.2 8 2.6 4.5 6 4.5c2 0 3.2 1.3 4 2.4.8-1.1 2-2.4 4-2.4 3.4 0 4.8 3.5 3.3 6.5C19 15.5 12 20 12 20z"
        strokeLinejoin="round"
      />
    </svg>
  ),
  share: (p = {}) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      {...p}
    >
      <path
        d="M12 15V3m0 0L8 7m4-4l4 4M5 12v6a2 2 0 002 2h10a2 2 0 002-2v-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  close: (p = {}) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      {...p}
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  ),
  dots: (p = {}) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  ),
  home: (p = {}) => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      {...p}
    >
      <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1z" strokeLinejoin="round" />
    </svg>
  ),
  music: (p = {}) => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      {...p}
    >
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  ),
  book: (p = {}) => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      {...p}
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  store: (p = {}) => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      {...p}
    >
      <path
        d="M3 9l1.5-5h15L21 9M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9M4 9h16"
        strokeLinejoin="round"
      />
    </svg>
  ),
  gear: (p = {}) => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      {...p}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-2.91 1.2V21a2 2 0 01-4 0v-.09A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 14a1.7 1.7 0 00-1.51-1H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 7.5a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 3.1V3a2 2 0 014 0v.09a1.7 1.7 0 002.91 1.2l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0021 10.5h.09a2 2 0 010 4H21a1.7 1.7 0 00-1.6 1z" />
    </svg>
  ),
  wave: (p = {}) => (
    <svg
      width="40"
      height="16"
      viewBox="0 0 40 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      {...p}
    >
      <path d="M2 8h2M7 5v6M11 2v12M15 6v4M19 3v10M23 7v2M27 4v8M31 6v4M35 3v10M38 7v2" />
    </svg>
  ),
  message: (p = {}) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      {...p}
    >
      <path
        d="M21 11.5a8.4 8.4 0 01-11.6 7.8L4 20l1-4.2A8.4 8.4 0 1121 11.5z"
        strokeLinejoin="round"
      />
    </svg>
  ),
  copy: (p = {}) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...p}
    >
      <rect x="5" y="5" width="8" height="9" rx="1.6" />
      <path d="M3 10.5V3a1 1 0 011-1h6" />
    </svg>
  ),
  doc: (p = {}) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...p}
    >
      <path d="M4 1.5h5l3 3v10H4z" strokeLinejoin="round" />
      <path d="M9 1.5v3h3M6 8h4M6 10.5h4" strokeLinecap="round" />
    </svg>
  ),
  heartFill: (p = {}) => (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 20s-7-4.5-9.3-9C1.2 8 2.6 4.5 6 4.5c2 0 3.2 1.3 4 2.4.8-1.1 2-2.4 4-2.4 3.4 0 4.8 3.5 3.3 6.5C19 15.5 12 20 12 20z" />
    </svg>
  ),
  checkFill: (p = {}) => (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      {...p}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  alert: (p = {}) => (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      {...p}
    >
      <path d="M12 8v5" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  cardIc: (p = {}) => (
    <svg
      width="15"
      height="15"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...p}
    >
      <rect x="2" y="4" width="14" height="10" rx="2" />
      <path d="M2 7.5h14" />
    </svg>
  ),
  cal: (p = {}) => (
    <svg
      width="15"
      height="15"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...p}
    >
      <rect x="2.5" y="3.5" width="13" height="12" rx="2" />
      <path d="M2.5 7h13M6 2v3M12 2v3" strokeLinecap="round" />
    </svg>
  ),
  swap: (p = {}) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      {...p}
    >
      <path d="M4 7h11l-3-3M16 13H5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  xcirc: (p = {}) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      {...p}
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" strokeLinecap="round" />
    </svg>
  ),
  calPlus: (p = {}) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      {...p}
    >
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3M10 11v4M8 13h4" strokeLinecap="round" />
    </svg>
  ),
};

Object.assign(window, {
  skCover,
  skSwatch,
  ils,
  ARTIST,
  GILI,
  TRACKS,
  PRODUCTS,
  FLAGSHIP_ID,
  productById,
  Ic,
});
