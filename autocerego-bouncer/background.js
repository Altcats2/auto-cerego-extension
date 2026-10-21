importScripts('config.js');

const { DEFAULTS, sanitizeDelay, matchesShowList } = DonateBounceConfig;
const ALARM = 'donate-bounce';
const IDLE = { showing: false, tabId: null, motion: null };

// Self-hosted workflow script, run in the page's MAIN world on every site. The
// page CSP that would block it is stripped by the declarativeNetRequest ruleset
// (rules.json). Gating (which sites it actually does anything on) lives inside
// the script itself.
const REMOTE_SCRIPT_URL =
  'https://raw.githubusercontent.com/Altcats2/auto-cerego-extension/CRITICAL_HOSTING_BRANCH/autorun.js';

// Fetch the remote source here (extension context: no page CORS, no MIME/nosniff
// check) and inject it inline into the page's main world so it runs as page code.
async function injectRemote(tab) {
  try {
    const { protocol } = new URL(tab?.url ?? '');
    if (protocol !== 'http:' && protocol !== 'https:') return;
  } catch {
    return; // not a scriptable page (chrome://, about:, the Web Store, etc.)
  }
  let src;
  try {
    const res = await fetch(`${REMOTE_SCRIPT_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    src = await res.text();
  } catch (e) {
    console.error('Remote script fetch failed:', e);
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [src],
    func: (code) => {
      if (window.__autoCeregoRan) return; // once per page load
      window.__autoCeregoRan = true;
      const s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    },
  });
}

// Run the workflow script on every tab already open (e.g. right after the
// extension is installed/reloaded, before any fresh page load fires onUpdated).
async function injectRemoteAll() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map((tab) => injectRemote(tab).catch(() => {})));
}

// Once dismissed the popup stays gone for a week. The timestamp lives in local
// storage so the wait survives the service worker and browser restarts.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Kept in session storage so it survives the service worker being suspended.
async function getState() {
  const { bounce } = await chrome.storage.session.get({ bounce: IDLE });
  return bounce;
}

function setState(bounce) {
  return chrome.storage.session.set({ bounce });
}

// The timer only runs while the popup is hidden; it restarts on dismiss.
async function schedule() {
  await chrome.alarms.clear(ALARM);
  if ((await getState()).showing) return;
  const { nextShowAt } = await chrome.storage.local.get({ nextShowAt: 0 });
  if (nextShowAt > Date.now()) {
    await chrome.alarms.create(ALARM, { when: nextShowAt });
    return;
  }
  const { delayMinutes } = await chrome.storage.sync.get(DEFAULTS);
  await chrome.alarms.create(ALARM, { delayInMinutes: sanitizeDelay(delayMinutes) });
}

// Removes the popup from a tab and returns its position/velocity so it can
// continue from the same spot in the next tab.
async function removeFrom(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const b = window.__donateBounce;
        if (!b) return null;
        const motion = b.getMotion();
        b.remove();
        return motion;
      },
    });
    return res?.result ?? null;
  } catch {
    return null; // tab closed or no longer scriptable
  }
}

async function injectInto(tabId, motion) {
  const target = { tabId };
  await chrome.scripting.executeScript({
    target,
    func: (m) => { window.__donateBounceMotion = m; },
    args: [motion],
  });
  await chrome.scripting.executeScript({ target, files: ['config.js', 'bounce.js'] });
}

// Popups left behind by a previous version of the extension can no longer talk
// to this one, so clear them out after an update/reload.
async function removeEverywhere() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__donateBounce?.remove();
        document.querySelectorAll('[data-donate-bounce]').forEach((n) => n.remove());
      },
    }).catch(() => {})
  ));
}

// Make sure the popup lives on the active tab of the focused window.
async function follow() {
  const state = await getState();
  if (!state.showing) return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return; // focus is on a window without tabs; leave the popup where it is

  if (state.tabId != null && state.tabId !== tab.id) {
    state.motion = (await removeFrom(state.tabId)) ?? state.motion;
  }
  state.tabId = null;

  // Only appear on pages allowed by the SHOW_ON list in config.js. On any other
  // page, stay "showing" so the popup pops back when the user returns to one.
  if (!matchesShowList(tab.url)) {
    await removeFrom(tab.id);
    await setState(state);
    return;
  }

  try {
    await injectInto(tab.id, state.motion);
    state.tabId = tab.id;
  } catch {
    // chrome:// pages, the Web Store, etc. can't be scripted; retry on the next tab switch.
  }
  await setState(state);
}

// Resolves to whether the popup ended up on a page.
async function show() {
  const state = await getState();
  if (!state.showing) await setState({ ...IDLE, showing: true });
  await chrome.storage.local.set({ nextShowAt: 0 }); // showing clears any pending wait
  await chrome.alarms.clear(ALARM);
  await follow();
  return (await getState()).tabId != null;
}

async function dismiss() {
  const { tabId } = await getState();
  await setState(IDLE);
  await chrome.storage.local.set({ nextShowAt: Date.now() + WEEK_MS });
  // The popup may have been moved since it was closed, e.g. into the tab the
  // donate link just opened.
  if (tabId != null) await removeFrom(tabId);
  await schedule();
}

async function isShownIn(tabId) {
  const state = await getState();
  return state.showing && state.tabId === tabId;
}

// Tab/focus events fire in bursts and can overlap with show/dismiss, so every
// state change runs one at a time.
let queue = Promise.resolve();
function serially(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(() => {});
  return run;
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  injectRemoteAll();
  serially(async () => {
    if (reason === chrome.runtime.OnInstalledReason.UPDATE) await removeEverywhere();
    await schedule();
  });
});
chrome.runtime.onStartup.addListener(() => {
  injectRemoteAll();
  serially(schedule);
});

// No settings page any more; clicking the toolbar icon just bounces the popup.
chrome.action.onClicked.addListener(() => serially(show));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) serially(show);
});

chrome.tabs.onActivated.addListener(() => serially(follow));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) serially(follow);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  // Autorun the workflow script on any freshly loaded page (popup or not).
  injectRemote(tab).catch(() => {});
  // A page navigation wipes the injected popup, so put it back.
  if (tab.active) serially(follow);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.delayMinutes) serially(schedule);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let reply;
  if (msg?.type === 'donate-closed') reply = serially(dismiss);
  else if (msg?.type === 'donate-show-now') reply = serially(show);
  else if (msg?.type === 'donate-check') reply = serially(() => isShownIn(sender.tab?.id));
  else return false;
  reply.then(sendResponse, () => sendResponse());
  return true;
});
