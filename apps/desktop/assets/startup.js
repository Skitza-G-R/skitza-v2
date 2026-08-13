const status = document.querySelector("#status");
const retry = document.querySelector("#retry");

async function openSkitza() {
  retry.hidden = true;
  status.textContent = "Connecting securely to Skitza.";
  try {
    await window.__SKITZA_DESKTOP_LOCAL__.retryLaunch();
  } catch {
    status.textContent = "Skitza could not connect. Check your internet connection and try again.";
    retry.hidden = false;
  }
}

retry.addEventListener("click", openSkitza);
void openSkitza();
