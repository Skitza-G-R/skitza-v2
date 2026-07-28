import {
  RUNTIME_SCREEN_DETAIL_MAX_LENGTH,
  RUNTIME_SCREEN_KEY_MAX_LENGTH,
  RUNTIME_SCREEN_LABEL_MAX_LENGTH,
  RUNTIME_SCREEN_MAX_ITEMS,
  RUNTIME_SCREEN_MAX_ITEMS_PER_SECTION,
  RUNTIME_SCREEN_MAX_METRICS,
  RUNTIME_SCREEN_MAX_SECTIONS,
  RUNTIME_SCREEN_TITLE_MAX_LENGTH,
  type RuntimeScreenSafeView,
} from "./runtime-state";

export const SCREEN_VIEW_MAPPER_LIMITS = {
  metrics: RUNTIME_SCREEN_MAX_METRICS,
  sections: RUNTIME_SCREEN_MAX_SECTIONS,
  itemsPerSection: RUNTIME_SCREEN_MAX_ITEMS_PER_SECTION,
  totalItems: RUNTIME_SCREEN_MAX_ITEMS,
  key: RUNTIME_SCREEN_KEY_MAX_LENGTH,
  label: RUNTIME_SCREEN_LABEL_MAX_LENGTH,
  metricValue: RUNTIME_SCREEN_LABEL_MAX_LENGTH,
  title: RUNTIME_SCREEN_TITLE_MAX_LENGTH,
  detail: RUNTIME_SCREEN_DETAIL_MAX_LENGTH,
  subtitle: RUNTIME_SCREEN_DETAIL_MAX_LENGTH,
  badge: RUNTIME_SCREEN_LABEL_MAX_LENGTH,
} as const;

interface ProducerOverviewProjectSource {
  id: string;
  title: string;
  clientName?: string | null;
  stage?: string | null;
  urgency?: string | null;
}

interface ProducerOverviewUploadSource {
  id?: string;
  versionId?: string;
  title: string;
  versionLabel?: string | null;
  projectClientName?: string | null;
}

export interface ProducerOverviewScreenSource {
  displayName: string | null;
  activeProjectCount?: number;
  activeProjects?: number;
  urgentProjects: readonly ProducerOverviewProjectSource[];
  recentUploads: readonly ProducerOverviewUploadSource[];
}

interface ProducerWorkspaceProjectSource {
  id: string;
  title: string;
  client?: string | null;
  clientName?: string | null;
  status?: string | null;
  lifecycleStatus?: string | null;
  workflowStage?: string | null;
  deadline?: string | null;
}

interface ProducerWorkspaceClientSource {
  id: string;
  name: string;
  projects?: number;
  archived?: boolean;
  needsAttention?: boolean;
}

export interface ProducerWorkspaceScreenSource {
  projects: readonly ProducerWorkspaceProjectSource[];
  clients: readonly ProducerWorkspaceClientSource[];
  needsAttentionCount?: number;
}

interface MusicProjectSource {
  id: string;
  title: string;
  artistLabel?: string | null;
  clientName?: string | null;
  visibleSpaceCount?: number;
  trackCount?: number;
  projectLifecycleStatus?: string | null;
}

interface MusicSongSource {
  kind?: "track" | "empty-slot";
  id: string;
  trackId?: string;
  trackTitle?: string;
  trackArtist?: string | null;
  projectTitle: string;
  clientName?: string | null;
  label?: string | null;
  archivedAtIso?: string | null;
}

export interface MusicScreenSource {
  projects: readonly MusicProjectSource[];
  songs?: readonly MusicSongSource[];
  tracks?: readonly MusicSongSource[];
}

interface ArtistHomeStudioSource {
  id?: string;
  producerId?: string;
  name?: string;
  producerName?: string;
}

interface ArtistLatestMixSource {
  id: string;
  trackTitle: string;
  label?: string | null;
  producerName: string;
}

export interface ArtistHomeScreenSource {
  firstName: string;
  studios: readonly ArtistHomeStudioSource[];
  latestMix?: ArtistLatestMixSource | null;
}

interface ArtistStoreProductSource {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
}

export interface ArtistStoreScreenSource {
  studioName: string | null;
  products: readonly ArtistStoreProductSource[];
}

type ScreenItem = RuntimeScreenSafeView["sections"][number]["items"][number];
type ScreenSection = RuntimeScreenSafeView["sections"][number];

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maximum);
}

function nullableText(value: unknown, maximum: number): string | null {
  const cleaned = cleanText(value, maximum);
  return cleaned.length > 0 ? cleaned : null;
}

function safeKey(value: unknown, fallback: string): string {
  return cleanText(value, SCREEN_VIEW_MAPPER_LIMITS.key) || fallback;
}

function humanize(value: unknown): string | null {
  const text = cleanText(value, SCREEN_VIEW_MAPPER_LIMITS.badge);
  if (!text) return null;
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .slice(0, SCREEN_VIEW_MAPPER_LIMITS.badge);
}

function safeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(999_999, Math.max(0, Math.trunc(value)));
}

function countLabel(value: number, noun: string): string {
  const count = safeCount(value);
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

function metric(label: string, value: number | string): RuntimeScreenSafeView["metrics"][number] {
  return {
    label: cleanText(label, SCREEN_VIEW_MAPPER_LIMITS.label),
    value: cleanText(String(value), SCREEN_VIEW_MAPPER_LIMITS.metricValue),
  };
}

function boundedItems<T>(
  values: readonly T[],
  mapItem: (value: T, index: number) => ScreenItem | null,
): ScreenItem[] {
  const items: ScreenItem[] = [];
  const maximum = Math.min(
    values.length,
    SCREEN_VIEW_MAPPER_LIMITS.itemsPerSection,
    SCREEN_VIEW_MAPPER_LIMITS.totalItems,
  );
  for (let index = 0; index < maximum; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    const item = mapItem(value, index);
    if (item) items.push(item);
  }
  return items;
}

function boundedSections(sections: readonly ScreenSection[]): ScreenSection[] {
  const result: ScreenSection[] = [];
  let remainingItems = SCREEN_VIEW_MAPPER_LIMITS.totalItems;

  for (const section of sections.slice(0, SCREEN_VIEW_MAPPER_LIMITS.sections)) {
    const items = section.items.slice(
      0,
      Math.min(SCREEN_VIEW_MAPPER_LIMITS.itemsPerSection, remainingItems),
    );
    result.push({
      label: cleanText(section.label, SCREEN_VIEW_MAPPER_LIMITS.label),
      items,
    });
    remainingItems -= items.length;
  }

  return result;
}

function screenItem(input: {
  key: unknown;
  fallbackKey: string;
  title: unknown;
  detail?: unknown;
  badge?: unknown;
}): ScreenItem | null {
  const title = cleanText(input.title, SCREEN_VIEW_MAPPER_LIMITS.title);
  if (!title) return null;
  return {
    key: safeKey(input.key, input.fallbackKey),
    title,
    detail: nullableText(input.detail, SCREEN_VIEW_MAPPER_LIMITS.detail),
    badge: nullableText(input.badge, SCREEN_VIEW_MAPPER_LIMITS.badge),
  };
}

function firstName(value: string | null): string {
  return cleanText(value, SCREEN_VIEW_MAPPER_LIMITS.title).split(/\s+/)[0] ?? "";
}

function overviewProjectItem(
  project: ProducerOverviewProjectSource,
  index: number,
): ScreenItem | null {
  return screenItem({
    key: null,
    fallbackKey: `urgent-${String(index)}`,
    title: project.title,
    detail: project.clientName,
    badge: humanize(project.urgency ?? project.stage),
  });
}

function overviewUploadItem(
  upload: ProducerOverviewUploadSource,
  index: number,
): ScreenItem | null {
  return screenItem({
    key: null,
    fallbackKey: `upload-${String(index)}`,
    title: upload.title,
    detail: upload.projectClientName,
    badge: upload.versionLabel,
  });
}

export function mapProducerOverviewSafeScreen(
  input: ProducerOverviewScreenSource,
): RuntimeScreenSafeView {
  const name = firstName(input.displayName);
  const activeProjects = safeCount(input.activeProjectCount ?? input.activeProjects ?? 0);
  const urgentItems = boundedItems(input.urgentProjects, overviewProjectItem);
  const uploadItems = boundedItems(input.recentUploads, overviewUploadItem);

  return {
    kind: "producer-overview",
    title: name ? `Hi, ${name}` : "Studio overview",
    subtitle: "Saved studio activity",
    metrics: [
      metric("Active projects", activeProjects),
      metric("Need attention", input.urgentProjects.length),
      metric("Recent uploads", input.recentUploads.length),
    ],
    sections: boundedSections([
      { label: "Needs attention", items: urgentItems },
      { label: "Recent uploads", items: uploadItems },
    ]),
  };
}

function workspaceProjectItem(
  project: ProducerWorkspaceProjectSource,
  index: number,
): ScreenItem | null {
  const client = nullableText(
    project.client ?? project.clientName,
    SCREEN_VIEW_MAPPER_LIMITS.detail,
  );
  const deadline = nullableText(project.deadline, SCREEN_VIEW_MAPPER_LIMITS.detail);
  return screenItem({
    key: null,
    fallbackKey: `project-${String(index)}`,
    title: project.title,
    detail: [client, deadline].filter((value): value is string => value !== null).join(" · "),
    badge: humanize(project.status ?? project.workflowStage ?? project.lifecycleStatus),
  });
}

function workspaceClientItem(
  client: ProducerWorkspaceClientSource,
  index: number,
): ScreenItem | null {
  return screenItem({
    key: null,
    fallbackKey: `client-${String(index)}`,
    title: client.name,
    detail: countLabel(client.projects ?? 0, "project"),
    badge: client.archived ? "Archived" : client.needsAttention ? "Needs attention" : null,
  });
}

export function mapProducerWorkspaceSafeScreen(
  input: ProducerWorkspaceScreenSource,
): RuntimeScreenSafeView {
  const inferredNeedsAttention = input.projects.filter((project) => {
    const status = `${project.status ?? ""} ${project.workflowStage ?? ""}`.toLowerCase();
    return status.includes("attention") || status.includes("overdue");
  }).length;

  return {
    kind: "producer-workspace",
    title: "Clients & Projects",
    subtitle: "Saved workspace",
    metrics: [
      metric("Projects", input.projects.length),
      metric("Clients", input.clients.length),
      metric("Need attention", input.needsAttentionCount ?? inferredNeedsAttention),
    ],
    sections: boundedSections([
      { label: "Projects", items: boundedItems(input.projects, workspaceProjectItem) },
      { label: "Clients", items: boundedItems(input.clients, workspaceClientItem) },
    ]),
  };
}

function musicProjectItem(project: MusicProjectSource, index: number): ScreenItem | null {
  const partner = project.artistLabel ?? project.clientName;
  const count = project.visibleSpaceCount ?? project.trackCount;
  return screenItem({
    key: null,
    fallbackKey: `music-project-${String(index)}`,
    title: project.title,
    detail: [
      nullableText(partner, SCREEN_VIEW_MAPPER_LIMITS.detail),
      count === undefined ? null : countLabel(count, "song"),
    ]
      .filter((value): value is string => value !== null)
      .join(" · "),
    badge: humanize(project.projectLifecycleStatus),
  });
}

function musicSongItem(song: MusicSongSource, index: number): ScreenItem | null {
  if (song.kind === "empty-slot") return null;
  const artist = nullableText(song.trackArtist, SCREEN_VIEW_MAPPER_LIMITS.detail);
  const project = nullableText(song.projectTitle, SCREEN_VIEW_MAPPER_LIMITS.detail);
  return screenItem({
    key: null,
    fallbackKey: `song-${String(index)}`,
    title: song.trackTitle,
    detail: [artist, project].filter((value): value is string => value !== null).join(" · "),
    badge: song.archivedAtIso ? "Archived" : song.label,
  });
}

function mapMusicSafeScreen(
  kind: "producer-music" | "artist-music",
  input: MusicScreenSource,
): RuntimeScreenSafeView {
  const songs = (input.songs ?? input.tracks ?? []).filter((song) => song.kind !== "empty-slot");
  const archivedSongs = songs.filter((song) => Boolean(song.archivedAtIso)).length;

  return {
    kind,
    title: "Music",
    subtitle: kind === "producer-music" ? "Saved studio catalog" : "Saved from your studios",
    metrics: [
      metric("Projects", input.projects.length),
      metric("Songs", songs.length),
      metric("Archived", archivedSongs),
    ],
    sections: boundedSections([
      { label: "Projects", items: boundedItems(input.projects, musicProjectItem) },
      { label: "Songs", items: boundedItems(songs, musicSongItem) },
    ]),
  };
}

export function mapProducerMusicSafeScreen(input: MusicScreenSource): RuntimeScreenSafeView {
  return mapMusicSafeScreen("producer-music", input);
}

export function mapArtistMusicSafeScreen(input: MusicScreenSource): RuntimeScreenSafeView {
  return mapMusicSafeScreen("artist-music", input);
}

function artistStudioItem(studio: ArtistHomeStudioSource, index: number): ScreenItem | null {
  return screenItem({
    key: null,
    fallbackKey: `studio-${String(index)}`,
    title: studio.producerName ?? studio.name,
    detail: "Studio",
  });
}

export function mapArtistHomeSafeScreen(input: ArtistHomeScreenSource): RuntimeScreenSafeView {
  const name = firstName(input.firstName);
  const latestMixItems = input.latestMix
    ? boundedItems([input.latestMix], (mix, index) =>
        screenItem({
          key: null,
          fallbackKey: `latest-mix-${String(index)}`,
          title: mix.trackTitle,
          detail: mix.producerName,
          badge: mix.label,
        }),
      )
    : [];

  return {
    kind: "artist-home",
    title: name ? `Hi, ${name}` : "Your studios",
    subtitle: "Saved artist home",
    metrics: [
      metric("Studios", input.studios.length),
      metric("Latest mix", latestMixItems.length > 0 ? "Ready" : "None yet"),
    ],
    sections: boundedSections([
      { label: "Latest mix", items: latestMixItems },
      { label: "Studios", items: boundedItems(input.studios, artistStudioItem) },
    ]),
  };
}

function artistStoreProductItem(
  product: ArtistStoreProductSource,
  index: number,
): ScreenItem | null {
  return screenItem({
    key: null,
    fallbackKey: `store-product-${String(index)}`,
    title: product.name,
    detail: product.description,
    badge: humanize(product.type),
  });
}

export function mapArtistStoreSafeScreen(input: ArtistStoreScreenSource): RuntimeScreenSafeView {
  return {
    kind: "artist-store",
    title: "Store",
    subtitle: nullableText(input.studioName, SCREEN_VIEW_MAPPER_LIMITS.subtitle),
    metrics: [metric("Products", input.products.length)],
    sections: boundedSections([
      { label: "Catalog", items: boundedItems(input.products, artistStoreProductItem) },
    ]),
  };
}
