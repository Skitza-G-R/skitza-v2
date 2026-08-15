(() => {
  "use strict";

  const tauriInternals = window.__TAURI_INTERNALS__;
  if (typeof tauriInternals?.invoke !== "function") return;

  const listeners = new Set();
  const pendingEvents = [];
  const MAX_PENDING_EVENTS = 16;
  const SOCIAL_ERROR_CODES = new Set([
    "callback-invalid",
    "auth-state-invalid",
    "auth-state-unavailable",
    "exchange-failed",
    "webview-untrusted",
    "webview-unavailable",
    "ticket-delivery-failed",
  ]);

  const invoke = (command, args = {}) => tauriInternals.invoke(command, args);
  const sessionCover = window.__SKITZA_DESKTOP_SESSION_COVER__;
  const trustedOrigin = window.__SKITZA_DESKTOP_TRUSTED_ORIGIN__;
  const localOrigins = new Set([
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
  ]);

  if (localOrigins.has(window.location.origin)) {
    Object.defineProperty(window, "__SKITZA_DESKTOP_LOCAL__", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        retryLaunch: () => invoke("retry_launch"),
      }),
    });
    return;
  }
  if (window.location.origin !== trustedOrigin) return;

  const subscribe = (callback) => {
    if (typeof callback !== "function") throw new TypeError("callback must be a function");
    listeners.add(callback);
    while (pendingEvents.length > 0) {
      const event = pendingEvents[0];
      try {
        callback(event);
      } catch (error) {
        listeners.delete(callback);
        throw error;
      }
      pendingEvents.shift();
    }
    return () => {
      listeners.delete(callback);
    };
  };

  const deliver = (event) => {
    if (!event || typeof event.type !== "string") return;
    let frozen;
    if (event.type === "social-sign-in-ticket") {
      if (
        typeof event.ticket !== "string" ||
        event.ticket.length === 0 ||
        event.ticket.length > 4096
      ) return;
      frozen = Object.freeze({ type: event.type, ticket: event.ticket });
    } else if (event.type === "social-sign-in-error") {
      if (!SOCIAL_ERROR_CODES.has(event.code)) return;
      frozen = Object.freeze({ type: event.type, code: event.code });
    } else if (
      event.type === "window-revealed" ||
      event.type === "session-validation-requested" ||
      event.type === "runtime-suspended" ||
      event.type === "session-revoked"
    ) {
      frozen = Object.freeze({ type: event.type });
    } else {
      return;
    }
    if (event.type === "runtime-suspended" || event.type === "session-revoked") {
      sessionCover?.show?.();
    }
    if (listeners.size === 0) {
      if (pendingEvents.length >= MAX_PENDING_EVENTS) {
        const removable = pendingEvents.findIndex((pending) => pending.type !== "social-sign-in-ticket");
        if (removable >= 0) pendingEvents.splice(removable, 1);
      }
      if (pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push(frozen);
      return;
    }
    for (const listener of listeners) listener(frozen);
  };

  const bridge = Object.freeze({
    protocolVersion: 1,
    capabilities: Object.freeze([
      "social-auth-v1",
      "performance-proof-v1",
      "session-validation-v1",
    ]),
    listen: subscribe,
    startSocialSignIn: (provider) => invoke("begin_social_sign_in", { provider }),
    recordGate1Sample: (sample) => invoke("record_gate1_sample", { sample }),
    consumeRevealElapsedMs: () => invoke("consume_reveal_elapsed_ms"),
    exportGate1Samples: () => invoke("export_gate1_samples"),
    reportSessionValidation: (report) =>
      Promise.resolve(invoke("report_session_validation", { report })).then(
        (result) => {
          sessionCover?.reportSessionValidation?.(report);
          return result;
        },
        (error) => {
          sessionCover?.show?.();
          throw error;
        },
      ),
  });

  Object.defineProperty(window, "__SKITZA_DESKTOP_DELIVER__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: deliver,
  });

  Object.defineProperty(window, "__SKITZA_DESKTOP__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: bridge,
  });
})();
