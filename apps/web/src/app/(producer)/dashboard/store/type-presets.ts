// type-presets.ts
//
// Type-preset cards used in the wizard's first step (new products only).
// Ported verbatim from the prototype `storefront.html` (TYPE_PRESETS,
// line 222). Each preset defines: the picker card copy (label / desc /
// icon), the default product name, baseline inclusions (always added
// to the draft includes list), suggested extras (one-tap add), and a
// preset object that seeds the rest of the form on pick.

export type PresetId = "production" | "mix" | "master" | "blank";
export type PresetType = "production" | "mix" | "master" | "consult";
export type PaymentPlanChoice = "full" | "split" | "installments";

export interface ExtraOption {
  label: string;
  icon: string;
  desc: string;
}

export interface PresetSeed {
  type: PresetType;
  name: string;
  price: number;
  duration: string;
  sessions: number;
  unlimitedSessions: boolean;
  paymentPlan: PaymentPlanChoice;
  revisions: number;
  turnaround: string;
  includes: string[];
}

export interface TypePreset {
  id: PresetId;
  label: string;
  icon: string;
  desc: string;
  defaultName: string;
  baseline: string[];
  extras: ExtraOption[];
  preset: PresetSeed;
}

export const TYPE_PRESETS: TypePreset[] = [
  {
    id: "production",
    label: "Production",
    icon: "music-2",
    desc: "End-to-end: tracking, arrangement, mix & master",
    defaultName: "Full production",
    baseline: [
      "Pre-production calls",
      "Tracking sessions",
      "Arrangement & sound design",
      "Mix + master included",
    ],
    extras: [
      { label: "Live musicians", icon: "users", desc: "Hired session players" },
      { label: "Lyrics & topline writing", icon: "pen-line", desc: "Co-write the song" },
      { label: "Vocal coaching", icon: "mic", desc: "Performance direction" },
      { label: "Beat / instrumental", icon: "music", desc: "Original production" },
      { label: "Stem delivery (WAV)", icon: "layers", desc: "All multitracks" },
      { label: "Music video shoot", icon: "video", desc: "Visual deliverable" },
      { label: "Distribution help", icon: "send", desc: "Release strategy" },
      { label: "Mastering for vinyl", icon: "disc-3", desc: "Pre-master + cut" },
    ],
    preset: {
      type: "production",
      name: "",
      price: 2500,
      duration: "multi-session",
      sessions: 8,
      unlimitedSessions: false,
      paymentPlan: "split",
      revisions: 3,
      turnaround: "6–10 weeks",
      includes: [],
    },
  },
  {
    id: "mix",
    label: "Mix",
    icon: "sliders-horizontal",
    desc: "Per-song mixing with stems, revisions and references",
    defaultName: "Mixing session",
    baseline: [
      "Stereo bus + mix prep",
      "2 revision rounds",
      "Reference matching",
      "High-res WAV master",
    ],
    extras: [
      { label: "Up to 64 stems", icon: "layers", desc: "Large session support" },
      { label: "Vocal tuning + comp", icon: "mic", desc: "Pitch + timing" },
      { label: "Atmos mix", icon: "compass", desc: "Spatial / immersive" },
      { label: "Loom walk-through", icon: "video", desc: "Recorded mix notes" },
      { label: "Live session attendance", icon: "users", desc: "You join the mix" },
      { label: "Instrumental + acappella", icon: "volume-2", desc: "Bonus exports" },
    ],
    preset: {
      type: "mix",
      name: "",
      price: 150,
      duration: "180 min",
      sessions: 1,
      unlimitedSessions: false,
      paymentPlan: "split",
      revisions: 2,
      turnaround: "5–7 days",
      includes: [],
    },
  },
  {
    id: "master",
    label: "Master",
    icon: "volume-2",
    desc: "Loud, balanced, platform-ready masters",
    defaultName: "Mastering pass",
    baseline: [
      "Streaming master (-14 LUFS)",
      "High-res WAV + MP3",
      "1 revision",
    ],
    extras: [
      { label: "CD master", icon: "disc", desc: "Red-book delivery" },
      { label: "Vinyl pre-master", icon: "disc-3", desc: "Side-aware cut" },
      { label: "MFiT / Apple Digital Master", icon: "apple", desc: "Apple-spec master" },
      { label: "Loudness report (PDF)", icon: "file-text", desc: "Spec sheet" },
      { label: "Stem mastering", icon: "layers", desc: "Multi-stem master" },
      { label: "Instrumental master", icon: "volume-2", desc: "Bonus version" },
    ],
    preset: {
      type: "master",
      name: "",
      price: 200,
      duration: "90 min",
      sessions: 1,
      unlimitedSessions: false,
      paymentPlan: "full",
      revisions: 1,
      turnaround: "3–5 days",
      includes: [],
    },
  },
  {
    id: "blank",
    label: "Blank",
    icon: "plus",
    desc: "Start from scratch — define your own",
    defaultName: "",
    baseline: [],
    extras: [],
    preset: {
      type: "consult",
      name: "",
      price: 100,
      duration: "60 min",
      sessions: 1,
      unlimitedSessions: false,
      paymentPlan: "full",
      revisions: 0,
      turnaround: "1 week",
      includes: [],
    },
  },
];

export function getPreset(id: PresetId): TypePreset | undefined {
  return TYPE_PRESETS.find((p) => p.id === id);
}
