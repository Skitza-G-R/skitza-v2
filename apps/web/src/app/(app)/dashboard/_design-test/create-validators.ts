// Pure validators shared by the design-test New Project + New Product
// modals. Mirror the server-side Zod schemas (project.create's
// CreateProjectInput + booking.products.create's input) so the modal
// can show inline errors without a network round-trip on every
// keystroke. Returns the first user-facing error message, or null
// when the input is valid.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewProjectInput = {
  title: string;
  artistName: string;
  artistEmail: string;
};

export function validateNewProjectInput(input: NewProjectInput): string | null {
  const title = input.title.trim();
  const name = input.artistName.trim();
  const email = input.artistEmail.trim();

  if (!title) return "Project title is required.";
  if (title.length > 120) return "Project title is too long (max 120 characters).";
  if (!name) return "Artist or client name is required.";
  if (name.length > 80) return "Artist or client name is too long (max 80 characters).";
  if (!email) return "Artist or client email is required.";
  if (!EMAIL_RE.test(email)) return "Please enter a valid email address.";
  return null;
}

export type NewProductInput = {
  title: string;
  durationMin: number;
  priceCents: number;
};

export function validateNewProductInput(input: NewProductInput): string | null {
  const title = input.title.trim();
  if (!title) return "Product title is required.";
  if (title.length > 120) return "Product title is too long (max 120 characters).";

  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    return "Session length must be greater than 0 minutes.";
  }
  if (input.durationMin > 24 * 60) {
    return "Session length can't exceed 24 hours.";
  }

  if (!Number.isFinite(input.priceCents) || input.priceCents <= 0) {
    return "Price must be greater than 0.";
  }
  return null;
}

export type NewSongInput = {
  projectId: string;
  title: string;
};

export function validateNewSongInput(input: NewSongInput): string | null {
  if (!input.projectId.trim()) return "Pick a project for this song.";
  const title = input.title.trim();
  if (!title) return "Song title is required.";
  if (title.length > 120) return "Song title is too long (max 120 characters).";
  return null;
}
