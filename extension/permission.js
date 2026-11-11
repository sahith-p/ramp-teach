// @ts-check
/**
 * One-time microphone grant for the extension (MV3). A side panel cannot show Chrome's mic prompt, but a
 * normal extension tab can, and the grant then applies to the extension's origin (the side panel included).
 * The mic is released right away; nothing is recorded here.
 */
const state = /** @type {HTMLElement} */ (document.getElementById("state"));
const retry = /** @type {HTMLButtonElement} */ (document.getElementById("retry"));

async function ask() {
  retry.hidden = true;
  state.textContent = "Allow the microphone when Chrome asks.";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    state.textContent = "Microphone allowed. Go back to the side panel and press the mic.";
    setTimeout(async () => {
      try {
        const tab = await chrome.tabs.getCurrent();
        if (tab?.id != null) await chrome.tabs.remove(tab.id);
      } catch {
        window.close();
      }
    }, 1200);
  } catch (err) {
    const name = /** @type {any} */ (err)?.name;
    state.textContent =
      name === "NotAllowedError"
        ? "Microphone blocked. Allow it from the icon in the address bar, then try again."
        : `Microphone unavailable: ${String(/** @type {Error} */ (err)?.message ?? err)}`;
    retry.hidden = false;
  }
}

retry.addEventListener("click", ask);
ask();
