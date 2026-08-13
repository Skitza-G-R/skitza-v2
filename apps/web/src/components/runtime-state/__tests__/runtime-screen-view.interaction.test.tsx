// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";

import { RUNTIME_MAIN_NAVIGATION_INTENT_EVENT } from "~/lib/runtime-state/navigation-cache";
import {
  writeRuntimeLaunchPointer,
  writeRuntimeScreenSafeView,
  type RuntimeScreenSafeView,
  type RuntimeStateIdentity,
} from "~/lib/runtime-state/runtime-state";

const mocked = vi.hoisted(() => ({
  auth: {
    isLoaded: true,
    userId: "producer-user" as string | null,
  },
  identity: {
    userId: "producer-user",
    role: "producer" as "producer" | "artist",
    contextId: "producer-studio",
  },
  online: true,
  pathname: "/dashboard",
  search: "",
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => mocked.auth,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocked.pathname,
  useRouter: () => mocked.router,
  useSearchParams: () => new URLSearchParams(mocked.search),
}));

vi.mock("../runtime-state-provider", () => ({
  useRuntimeState: () => ({
    identity: mocked.identity,
    privateStateAccessAllowed: true,
    storage: window.localStorage,
  }),
}));

import {
  RuntimeResumeBoundary,
  RuntimeScreenSafeViewWriter,
  RuntimeScreenTransitionBoundary,
} from "../runtime-screen-view";

const PRODUCER: RuntimeStateIdentity = {
  userId: "producer-user",
  role: "producer",
  contextId: "producer-studio",
};

function musicView(title = "Saved music library"): RuntimeScreenSafeView {
  return {
    kind: "producer-music",
    title,
    subtitle: "Available without waiting for the server",
    metrics: [{ label: "Songs", value: "12" }],
    sections: [
      {
        label: "Recent songs",
        items: [
          {
            key: "song-a",
            title: "Midnight",
            detail: "Demo",
            badge: "Mix",
          },
        ],
      },
    ],
  };
}

function workspaceView(title = "Saved client workspace"): RuntimeScreenSafeView {
  return {
    kind: "producer-workspace",
    title,
    subtitle: "Saved workspace",
    metrics: [{ label: "Projects", value: "4" }],
    sections: [],
  };
}

function overviewView(title = "Saved studio overview"): RuntimeScreenSafeView {
  return {
    kind: "producer-overview",
    title,
    subtitle: "Saved studio activity",
    metrics: [{ label: "Active projects", value: "4" }],
    sections: [],
  };
}

function announceNavigation(href: string, localOnly = false): void {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(RUNTIME_MAIN_NAVIGATION_INTENT_EVENT, {
        detail: {
          href,
          ...(localOnly ? { localOnly: true } : {}),
        },
      }),
    );
  });
}

function renderTransitionBoundary() {
  return render(
    <RuntimeScreenTransitionBoundary>
      <div data-testid="current-server-screen">Current server screen</div>
    </RuntimeScreenTransitionBoundary>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mocked.auth = {
    isLoaded: true,
    userId: "producer-user",
  };
  mocked.identity = {
    userId: "producer-user",
    role: "producer",
    contextId: "producer-studio",
  };
  mocked.online = true;
  mocked.pathname = "/dashboard";
  mocked.search = "";
  mocked.router.push.mockReset();
  mocked.router.replace.mockReset();
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => mocked.online,
  });
  delete document.documentElement.dataset.skScreenSource;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset.skScreenSource;
});

describe("instant runtime screen transitions", () => {
  it("refuses to store server data under a different artist studio context", () => {
    mocked.identity = {
      userId: "artist-user",
      role: "artist",
      contextId: "studio-b",
    };

    render(
      <RuntimeScreenSafeViewWriter
        href="/artist/store?studio=studio-a"
        contextId="studio-a"
        view={{
          ...musicView("Studio A catalog"),
          kind: "artist-store",
        }}
      />,
    );
    expect(window.localStorage.length).toBe(0);
  });

  it("refuses a studio-scoped artist write when the URL has no studio", () => {
    mocked.identity = {
      userId: "artist-user",
      role: "artist",
      contextId: "studio-b",
    };
    mocked.pathname = "/artist/music";
    mocked.search = "";

    render(
      <RuntimeScreenSafeViewWriter
        view={{
          ...musicView("Unscoped artist library"),
          kind: "artist-music",
        }}
      />,
    );

    expect(window.localStorage.length).toBe(0);
  });

  it.each([
    {
      label: "Today",
      origin: "/dashboard/music",
      destination: "/dashboard",
      cachedView: overviewView(),
    },
    {
      label: "Clients",
      origin: "/dashboard",
      destination: "/dashboard/clients-projects",
      cachedView: workspaceView(),
    },
    {
      label: "Music",
      origin: "/dashboard",
      destination: "/dashboard/music",
      cachedView: musicView(),
    },
  ])(
    "keeps the current real screen online while $label navigation commits",
    ({ origin, destination, cachedView }) => {
      mocked.pathname = origin;
      expect(
        writeRuntimeScreenSafeView(
          window.localStorage,
          PRODUCER,
          destination,
          cachedView,
        ),
      ).toBe(true);
      renderTransitionBoundary();

      announceNavigation(destination);

      expect(screen.getByTestId("current-server-screen")).toBeTruthy();
      expect(screen.queryByText(cachedView.title)).toBeNull();
      expect(
        document.querySelector('[data-runtime-screen-source="cache"]'),
      ).toBeNull();
      expect(
        document.querySelector('[data-runtime-screen-source="scaffold"]'),
      ).toBeNull();
      expect(document.documentElement.dataset.skScreenSource).toBeUndefined();
    },
  );

  it("keeps the current real screen online for a never-seen destination", () => {
    renderTransitionBoundary();

    announceNavigation("/dashboard/calendar");

    expect(screen.getByTestId("current-server-screen")).toBeTruthy();
    expect(screen.queryByLabelText("Loading Calendar")).toBeNull();
    expect(
      document.querySelector('[data-runtime-screen-source="cache"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-runtime-screen-source="scaffold"]'),
    ).toBeNull();
    expect(document.documentElement.dataset.skScreenSource).toBeUndefined();
  });

  it("shows a cached destination synchronously for an offline navigation", () => {
    mocked.online = false;
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
        musicView(),
      ),
    ).toBe(true);
    renderTransitionBoundary();

    announceNavigation("/dashboard/music");

    expect(screen.getByText("Saved music library")).toBeTruthy();
    expect(screen.getByText("Midnight")).toBeTruthy();
    expect(screen.queryByTestId("current-server-screen")).toBeNull();
    expect(
      document
        .querySelector('[data-runtime-screen-source="cache"]')
        ?.hasAttribute("aria-busy"),
    ).toBe(false);
    expect(document.querySelector("[data-runtime-resume-shell]")).toBeNull();
    expect(screen.queryByText(/Restoring your last screen/i)).toBeNull();
    expect(document.documentElement.dataset.skScreenSource).toBe("cache");
    expect(
      screen.queryByText(/Showing the last saved view while fresh data loads/i),
    ).toBeNull();
    expect(screen.queryByText("Updating Saved music library")).toBeNull();
  });

  it("shows a destination-shaped scaffold synchronously for an offline never-seen screen", () => {
    mocked.online = false;
    renderTransitionBoundary();

    announceNavigation("/dashboard/calendar");

    expect(screen.getByRole("heading", { name: "Calendar" })).toBeTruthy();
    expect(screen.getByLabelText("Loading Calendar")).toBeTruthy();
    expect(screen.queryByTestId("current-server-screen")).toBeNull();
    expect(
      document.querySelector('[data-runtime-screen-source="scaffold"]'),
    ).toBeTruthy();
    expect(document.documentElement.dataset.skScreenSource).toBe("scaffold");
    expect(
      screen.getByText("Reconnect to load the latest calendar data."),
    ).toBeTruthy();
  });

  it("never renders a cached view from another account or artist studio", () => {
    const owner = {
      userId: "artist-user",
      role: "artist" as const,
      contextId: "studio-a",
    };
    const ownerView: RuntimeScreenSafeView = {
      ...musicView("Studio A private library"),
      kind: "artist-music",
    };
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        owner,
        "/artist/music?studio=studio-a",
        ownerView,
      ),
    ).toBe(true);

    mocked.identity = {
      userId: "artist-user",
      role: "artist",
      contextId: "studio-b",
    };
    mocked.pathname = "/artist";
    mocked.search = "studio=studio-b";
    mocked.online = false;
    renderTransitionBoundary();
    announceNavigation("/artist/music?studio=studio-b");

    expect(screen.queryByText("Studio A private library")).toBeNull();
    expect(screen.getByLabelText("Loading Music")).toBeTruthy();

    cleanup();
    delete document.documentElement.dataset.skScreenSource;
    mocked.identity = {
      userId: "other-artist-user",
      role: "artist",
      contextId: "studio-a",
    };
    mocked.search = "studio=studio-a";
    renderTransitionBoundary();
    announceNavigation("/artist/music?studio=studio-a");

    expect(screen.queryByText("Studio A private library")).toBeNull();
    expect(screen.getByLabelText("Loading Music")).toBeTruthy();
  });

  it("keeps the saved destination readable offline and navigates only after reconnect", () => {
    vi.useFakeTimers();
    mocked.online = false;
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
        musicView("Offline music library"),
      ),
    ).toBe(true);
    renderTransitionBoundary();

    announceNavigation("/dashboard/music");
    expect(screen.getByText("Offline music library")).toBeTruthy();
    const offlinePreview = document.querySelector(
      '[data-runtime-screen-source="cache"]',
    );
    expect(offlinePreview?.hasAttribute("aria-busy")).toBe(false);
    expect(screen.queryByText("Updating Offline music library")).toBeNull();
    expect(mocked.router.push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("Offline music library")).toBeTruthy();
    expect(mocked.router.push).not.toHaveBeenCalled();

    mocked.online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(
      document
        .querySelector('[data-runtime-screen-source="cache"]')
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.getByText("Updating Offline music library")).toBeTruthy();
    expect(mocked.router.push).toHaveBeenCalledOnce();
    expect(mocked.router.push).toHaveBeenCalledWith("/dashboard/music");
  });

  it("handles a real offline destination click before the Link navigation runs", () => {
    mocked.online = false;
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
        musicView("Offline clicked library"),
      ),
    ).toBe(true);
    render(
      <RuntimeScreenTransitionBoundary>
        <Link href="/dashboard/music" data-sk-nav-destination="/dashboard/music">
          Music
        </Link>
      </RuntimeScreenTransitionBoundary>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Music" }));

    expect(screen.getByText("Offline clicked library")).toBeTruthy();
    expect(mocked.router.push).not.toHaveBeenCalled();
  });

  it("shows an unseen destination scaffold offline and continues after reconnect", () => {
    mocked.online = false;
    render(
      <RuntimeScreenTransitionBoundary>
        <Link
          href="/dashboard/calendar"
          data-sk-nav-destination="/dashboard/calendar"
        >
          Calendar
        </Link>
      </RuntimeScreenTransitionBoundary>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Calendar" }));

    expect(screen.getByLabelText("Loading Calendar")).toBeTruthy();
    expect(
      screen.getByText("Reconnect to load the latest calendar data."),
    ).toBeTruthy();
    expect(mocked.router.push).not.toHaveBeenCalled();

    mocked.online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(mocked.router.push).toHaveBeenCalledWith("/dashboard/calendar");
  });

  it("conceals a pending view immediately when the artist studio identity changes", () => {
    const studioA = {
      userId: "artist-user",
      role: "artist" as const,
      contextId: "studio-a",
    };
    mocked.identity = studioA;
    mocked.pathname = "/artist";
    mocked.search = "studio=studio-a";
    mocked.online = false;
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        studioA,
        "/artist/music?studio=studio-a",
        {
          ...musicView("Studio A pending library"),
          kind: "artist-music",
        },
      ),
    ).toBe(true);
    const boundary = renderTransitionBoundary();
    announceNavigation("/artist/music?studio=studio-a");
    expect(screen.getByText("Studio A pending library")).toBeTruthy();

    mocked.identity = {
      userId: "artist-user",
      role: "artist",
      contextId: "studio-b",
    };
    mocked.search = "studio=studio-b";
    boundary.rerender(
      <RuntimeScreenTransitionBoundary>
        <div data-testid="current-server-screen">Current server screen</div>
      </RuntimeScreenTransitionBoundary>,
    );

    expect(screen.queryByText("Studio A pending library")).toBeNull();
    expect(screen.getByTestId("current-server-screen")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(mocked.router.push).not.toHaveBeenCalled();
  });

  it("drops a pending preview when the route commits somewhere else", () => {
    mocked.online = false;
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
        musicView("Pending music"),
      ),
    ).toBe(true);
    const boundary = renderTransitionBoundary();
    announceNavigation("/dashboard/music");
    expect(screen.getByText("Pending music")).toBeTruthy();

    mocked.pathname = "/dashboard/settings";
    boundary.rerender(
      <RuntimeScreenTransitionBoundary>
        <div data-testid="redirected-server-screen">Settings screen</div>
      </RuntimeScreenTransitionBoundary>,
    );

    expect(screen.queryByText("Pending music")).toBeNull();
    expect(screen.getByTestId("redirected-server-screen")).toBeTruthy();
  });
});

describe("close and reopen runtime restore", () => {
  it("shows only the neutral launch cover while an online resume resolves", () => {
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard",
        overviewView(),
      ),
    ).toBe(true);
    expect(
      writeRuntimeLaunchPointer(
        window.localStorage,
        PRODUCER,
        "/dashboard",
      ),
    ).toBe(true);

    render(<RuntimeResumeBoundary navigate />);

    expect(document.querySelector("[data-runtime-launch-cover]")).toBeTruthy();
    expect(document.querySelector("[data-runtime-resume-shell]")).toBeNull();
    expect(
      document.querySelector('[data-runtime-screen-source="resume"]'),
    ).toBeNull();
    expect(screen.queryByText("Saved studio overview")).toBeNull();
    expect(screen.queryByText("Saved studio activity")).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Producer saved tabs" }),
    ).toBeNull();
    expect(mocked.router.replace).toHaveBeenCalledWith(
      "/launch/resolve?next=%2Fdashboard",
    );
  });

  it("restores the last safe screen from persistent storage before auth or network", () => {
    mocked.online = false;
    mocked.auth = {
      isLoaded: false,
      userId: null,
    };
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
        musicView("Reopened music library"),
      ),
    ).toBe(true);
    expect(
      writeRuntimeLaunchPointer(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
      ),
    ).toBe(true);

    render(<RuntimeResumeBoundary navigate />);

    expect(document.querySelector("[data-runtime-resume-shell]")).toBeTruthy();
    expect(
      document.querySelector('[data-runtime-screen-source="resume"]'),
    ).toBeTruthy();
    const offlineResume = document.querySelector(
      '[data-runtime-screen-source="resume"]',
    );
    expect(offlineResume?.hasAttribute("aria-busy")).toBe(false);
    expect(screen.queryByText("Updating Reopened music library")).toBeNull();
    expect(screen.getByText("Reopened music library")).toBeTruthy();
    expect(screen.getByText("Midnight")).toBeTruthy();
    expect(screen.getByText("Opening Skitza…")).toBeTruthy();
    expect(
      screen.queryByText(/Showing the last saved view while fresh data loads/i),
    ).toBeNull();
    expect(mocked.router.replace).not.toHaveBeenCalled();

    cleanup();
    render(<RuntimeResumeBoundary navigate />);
    expect(screen.getByText("Reopened music library")).toBeTruthy();
    expect(
      document.querySelector('[data-runtime-screen-source="resume"]'),
    ).toBeTruthy();
  });

  it("hydrates the public scaffold cleanly, then restores offline data before paint", () => {
    mocked.online = false;
    mocked.auth = {
      isLoaded: false,
      userId: null,
    };
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
        musicView("Hydrated offline library"),
      ),
    ).toBe(true);
    expect(
      writeRuntimeLaunchPointer(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
      ),
    ).toBe(true);

    const serverHtml = renderToString(<RuntimeResumeBoundary navigate />);
    expect(serverHtml).not.toContain("Hydrated offline library");
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const errors: unknown[][] = [];
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });

    let root: ReturnType<typeof hydrateRoot> | undefined;
    act(() => {
      root = hydrateRoot(container, <RuntimeResumeBoundary navigate />);
    });

    expect(within(container).getByText("Hydrated offline library")).toBeTruthy();
    const hydratedResume = container.querySelector(
      '[data-runtime-screen-source="resume"]',
    );
    expect(hydratedResume?.hasAttribute("aria-busy")).toBe(false);
    expect(
      within(container).queryByText("Updating Hydrated offline library"),
    ).toBeNull();
    expect(errors).toEqual([]);

    act(() => {
      root?.unmount();
    });
    errorSpy.mockRestore();
    container.remove();
  });

  it("shows the requested route cache or scaffold instead of an old launch route", () => {
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
        musicView("Old launch screen"),
      ),
    ).toBe(true);
    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        PRODUCER,
        "/dashboard/clients-projects",
        workspaceView(),
      ),
    ).toBe(true);
    expect(
      writeRuntimeLaunchPointer(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
      ),
    ).toBe(true);

    mocked.pathname = "/dashboard/clients-projects";
    const requested = render(
      <RuntimeResumeBoundary expectedRole="producer" />,
    );
    expect(screen.getByText("Saved client workspace")).toBeTruthy();
    expect(screen.queryByText("Old launch screen")).toBeNull();

    requested.unmount();
    mocked.pathname = "/dashboard/calendar";
    render(<RuntimeResumeBoundary expectedRole="producer" />);
    expect(screen.getByLabelText("Loading Calendar")).toBeTruthy();
    expect(screen.queryByText("Old launch screen")).toBeNull();
  });

  it("does not restore a saved artist studio into a missing-studio URL", () => {
    const artist = {
      userId: "artist-user",
      role: "artist" as const,
      contextId: "studio-a",
    };
    mocked.auth = {
      isLoaded: true,
      userId: artist.userId,
    };
    mocked.pathname = "/artist/store";
    mocked.search = "";

    expect(
      writeRuntimeScreenSafeView(
        window.localStorage,
        artist,
        "/artist/store?studio=studio-a",
        {
          ...musicView("Studio A saved store"),
          kind: "artist-store",
        },
      ),
    ).toBe(true);
    expect(
      writeRuntimeLaunchPointer(
        window.localStorage,
        artist,
        "/artist/store?studio=studio-a",
      ),
    ).toBe(true);

    render(<RuntimeResumeBoundary expectedRole="artist" />);

    expect(screen.queryByText("Studio A saved store")).toBeNull();
    expect(screen.getByLabelText("Loading Store")).toBeTruthy();
  });

  it("authorizes a cached launch target through the current server role", () => {
    expect(
      writeRuntimeLaunchPointer(
        window.localStorage,
        PRODUCER,
        "/dashboard/music",
      ),
    ).toBe(true);
    render(<RuntimeResumeBoundary navigate />);

    expect(mocked.router.replace).toHaveBeenCalledWith(
      "/launch/resolve?next=%2Fdashboard%2Fmusic",
    );
    expect(mocked.router.replace).not.toHaveBeenCalledWith(
      "/dashboard/music",
    );
  });

  it("uses the authenticated role resolver when no launch pointer exists", () => {
    mocked.auth = {
      isLoaded: true,
      userId: "artist-without-cache",
    };
    render(<RuntimeResumeBoundary navigate />);

    expect(mocked.router.replace).toHaveBeenCalledWith("/launch/resolve");
    expect(mocked.router.replace).not.toHaveBeenCalledWith("/dashboard");
  });
});
