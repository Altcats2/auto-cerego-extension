const { DEFAULTS, MIN_DELAY_MINUTES, sanitizeDelay, sanitizeUrl } = DonateBounceConfig;

const delay = document.getElementById('delay');
const url = document.getElementById('url');
const statusEl = document.getElementById('status');

delay.min = MIN_DELAY_MINUTES;
delay.step = MIN_DELAY_MINUTES;
document.getElementById('min-delay').textContent = MIN_DELAY_MINUTES;

let flashTimer;
const flash = (text, isError = false) => {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { statusEl.textContent = ''; }, isError ? 4000 : 1500);
};

chrome.storage.sync.get(DEFAULTS, (s) => {
  delay.value = sanitizeDelay(s.delayMinutes);
  url.value = s.donateUrl;
});

document.getElementById('save').addEventListener('click', async () => {
  const delayMinutes = sanitizeDelay(delay.value);
  // Empty means "use the default"; anything else must be a real http(s) link.
  const donateUrl = url.value.trim() ? sanitizeUrl(url.value) : DEFAULTS.donateUrl;
  if (!donateUrl) {
    flash('Enter a valid http(s) link.', true);
    return;
  }
  await chrome.storage.sync.set({ delayMinutes, donateUrl });
  delay.value = delayMinutes;
  url.value = donateUrl;
  flash('Saved');
});

document.getElementById('now').addEventListener('click', async () => {
  const shown = await chrome.runtime.sendMessage({ type: 'donate-show-now' });
  if (shown) window.close();
  else flash("Can't show on this page. It'll appear when you switch to a regular tab.", true);
});
