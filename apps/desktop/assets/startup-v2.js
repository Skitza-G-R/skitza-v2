const status = document.querySelector("#status");
const retry = document.querySelector("#retry");

function retryLaunch() {
  const bridgedRetry = window.__SKITZA_DESKTOP_LOCAL__?.retryLaunch;
  if (typeof bridgedRetry === "function") return bridgedRetry();

  const nativeInvoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof nativeInvoke !== "function") throw new Error("native startup is unavailable");
  return window.__TAURI_INTERNALS__.invoke("retry_launch");
}

async function openSkitza() {
  retry.hidden = true;
  status.textContent = "Opening Skitza…";
  try {
    await retryLaunch();
  } catch {
    status.textContent = "Skitza could not connect. Check your internet connection and try again.";
    retry.hidden = false;
  }
}

Object.defineProperty(window, "__SKITZA_DESKTOP_STARTUP_FAILED__", {
  configurable: false,
  enumerable: false,
  writable: false,
  value() {
    status.textContent = "Skitza could not connect. Check your internet connection and try again.";
    retry.hidden = false;
  },
});

retry.addEventListener("click", openSkitza);
