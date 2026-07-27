import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  auth: vi.fn(),
  addTrack: vi.fn(),
  createCaller: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocked.auth,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocked.revalidatePath,
}));

vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: {
    createCaller: mocked.createCaller,
  },
}));

import { claimSongSpaceAction } from "../actions";

describe("claimSongSpaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.auth.mockResolvedValue({ userId: "producer-first" });
    mocked.addTrack.mockResolvedValue({
      id: "song-first",
      projectId: "project-first",
      purchaseId: "purchase-first",
      title: "First Song",
    });
    mocked.createCaller.mockReturnValue({
      project: {
        addTrack: mocked.addTrack,
      },
    });
  });

  it("allocates the song space without creating an audio version", async () => {
    const input = {
      projectId: "project-first",
      purchaseId: "purchase-first",
      operationKey: "first-song-operation",
      title: "First Song",
    };

    await expect(claimSongSpaceAction(input)).resolves.toEqual({
      ok: true,
      data: {
        id: "song-first",
        projectId: "project-first",
        purchaseId: "purchase-first",
        title: "First Song",
      },
    });
    expect(mocked.addTrack).toHaveBeenCalledOnce();
    expect(mocked.addTrack).toHaveBeenCalledWith(input);
    expect(mocked.createCaller).toHaveBeenCalledWith({ userId: "producer-first" });
  });
});
