(() => {
  "use strict";

  const trustedOrigin = window.__SKITZA_DESKTOP_TRUSTED_ORIGIN__;
  if (window.location.origin !== trustedOrigin) return;

  const COVER_ID = "skitza-desktop-session-cover";
  const STYLE_ID = "skitza-desktop-session-cover-style";
  const FORBIDDEN_VALID_SURFACES = [
    '[aria-label="Checking connection"]',
    '[aria-label="Secure launch"]',
    "[data-runtime-resume-shell]",
    '[data-runtime-screen-source="cache"]',
    '[data-runtime-screen-source="resume"]',
    '[data-runtime-screen-source="scaffold"]',
  ];
  let releaseGeneration = 0;
  let validationState = "unknown";
  let surfaceObserver = null;

  function isProtectedPath() {
    const { pathname } = window.location;
    return (
      pathname === "/launch" ||
      pathname === "/dashboard" ||
      pathname.startsWith("/dashboard/") ||
      pathname === "/artist" ||
      pathname.startsWith("/artist/") ||
      pathname === "/onboarding" ||
      pathname.startsWith("/onboarding/")
    );
  }

  function cancelRelease() {
    releaseGeneration += 1;
  }

  function mountCover() {
    if (!isProtectedPath()) return;
    cancelRelease();
    if (!document.documentElement) {
      document.addEventListener("readystatechange", mountCover, { once: true });
      return;
    }

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        @keyframes skitza-desktop-cover-float {
          0%, 100% { transform: translate3d(0, 0, 0) rotate(-1deg); }
          50% { transform: translate3d(0, -6px, 0) rotate(1deg); }
        }
        @keyframes skitza-desktop-cover-pulse {
          0% { opacity: .36; transform: scale(.78); }
          72%, 100% { opacity: 0; transform: scale(1.24); }
        }
        #${COVER_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: grid;
          min-height: 100vh;
          place-items: center;
          overflow: hidden;
          background: radial-gradient(circle at 50% 46%, rgba(212, 150, 10, .13), transparent 17rem), rgb(242, 237, 230);
          color: rgb(17, 16, 9);
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
        #${COVER_ID} .skitza-desktop-cover__lockup {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          transform: translateY(-2vh);
        }
        #${COVER_ID} .skitza-desktop-cover__pulse {
          position: relative;
          z-index: 0;
          display: grid;
          width: 7.5rem;
          height: 7.5rem;
          place-items: center;
          isolation: isolate;
        }
        #${COVER_ID} .skitza-desktop-cover__pulse::before,
        #${COVER_ID} .skitza-desktop-cover__pulse::after {
          position: absolute;
          inset: .5rem;
          z-index: -1;
          content: "";
          border: 1px solid rgba(212, 150, 10, .5);
          border-radius: 30%;
          opacity: .18;
        }
        #${COVER_ID} .skitza-desktop-cover__mark {
          display: block;
          width: 6rem;
          height: 6rem;
          overflow: hidden;
          border-radius: 1.5rem;
          box-shadow: 0 0 0 1px rgba(212, 150, 10, .18), 0 18px 42px -16px rgba(212, 150, 10, .65);
        }
        #${COVER_ID} .skitza-desktop-cover__wordmark {
          font-size: 1.45rem;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -.04em;
        }
        #${COVER_ID} .skitza-desktop-cover__wordmark span { color: rgb(212, 150, 10); }
        #${COVER_ID} .skitza-desktop-cover__status {
          margin-top: -.45rem;
          color: rgb(107, 99, 89);
          font-size: .875rem;
          font-weight: 600;
          line-height: 1.25rem;
        }
        @media (prefers-reduced-motion: no-preference) {
          #${COVER_ID} .skitza-desktop-cover__mark {
            animation: skitza-desktop-cover-float 1.8s cubic-bezier(.2, .8, .2, 1) infinite;
            will-change: transform;
          }
          #${COVER_ID} .skitza-desktop-cover__pulse::before,
          #${COVER_ID} .skitza-desktop-cover__pulse::after {
            animation: skitza-desktop-cover-pulse 1.8s cubic-bezier(.16, 1, .3, 1) infinite;
          }
          #${COVER_ID} .skitza-desktop-cover__pulse::after { animation-delay: .6s; }
        }
      `;
      document.documentElement.append(style);
    }

    if (!document.getElementById(COVER_ID)) {
      const cover = document.createElement("div");
      cover.id = COVER_ID;
      cover.setAttribute("role", "status");
      cover.setAttribute("aria-label", "Opening Skitza…");
      cover.setAttribute("aria-live", "polite");
      const markUrl = new URL("/icons/skitza-192.png", trustedOrigin).href;
      cover.innerHTML = `
        <div class="skitza-desktop-cover__lockup">
          <span class="skitza-desktop-cover__pulse" aria-hidden="true">
            <img class="skitza-desktop-cover__mark" src="${markUrl}" width="96" height="96" alt="" />
          </span>
          <span class="skitza-desktop-cover__wordmark">Skitza<span aria-hidden="true">.</span></span>
          <span class="skitza-desktop-cover__status">Opening Skitza…</span>
        </div>
      `;
      document.documentElement.append(cover);
    }
  }

  function removeCover() {
    cancelRelease();
    document.getElementById(COVER_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  function releaseAfterTwoFrames(predicate) {
    const generation = ++releaseGeneration;
    if (!predicate()) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (generation === releaseGeneration && predicate()) removeCover();
      });
    });
  }

  function hasForbiddenSurface() {
    return FORBIDDEN_VALID_SURFACES.some((selector) => document.querySelector(selector));
  }

  function reconcileCover() {
    if (!isProtectedPath()) {
      removeCover();
      return;
    }

    if (validationState === "valid") {
      if (hasForbiddenSurface()) {
        mountCover();
      } else {
        releaseAfterTwoFrames(
          () => isProtectedPath() && validationState === "valid" && !hasForbiddenSurface(),
        );
      }
      return;
    }

    if (
      validationState === "invalid" &&
      document.querySelector('[aria-label="Session ended"]') !== null
    ) {
      removeCover();
      return;
    }

    mountCover();
  }

  function reportSessionValidation(report) {
    if (
      report?.status === "valid" &&
      report.accountMatches === true &&
      typeof report.validatedAt === "number" &&
      Number.isFinite(report.validatedAt)
    ) {
      validationState = "valid";
      reconcileCover();
      return;
    }

    if (report?.status === "invalid") {
      validationState = "invalid";
      reconcileCover();
      return;
    }

    validationState = "unknown";
    reconcileCover();
  }

  function suspendAndShow() {
    validationState = "unknown";
    mountCover();
  }

  function prepareHide() {
    suspendAndShow();
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") return Promise.reject(new Error("native hide unavailable"));
    return invoke("hide_main_window");
  }

  function startSurfaceObserver() {
    if (surfaceObserver) return;
    if (!document.documentElement) {
      document.addEventListener("readystatechange", startSurfaceObserver, { once: true });
      return;
    }
    surfaceObserver = new MutationObserver(reconcileCover);
    surfaceObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  }

  const sessionCover = Object.freeze({
    reportSessionValidation,
    show: suspendAndShow,
  });
  Object.defineProperty(window, "__SKITZA_DESKTOP_SESSION_COVER__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: sessionCover,
  });
  Object.defineProperty(window, "__SKITZA_DESKTOP_PREPARE_HIDE__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: prepareHide,
  });

  startSurfaceObserver();
  window.addEventListener("offline", suspendAndShow, true);
  reconcileCover();
})();
