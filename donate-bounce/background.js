importScripts('config.js');

const { DEFAULTS, sanitizeDelay } = DonateBounceConfig;
const ALARM = 'donate-bounce';
const IDLE = { showing: false, tabId: null, motion: null };

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
  await chrome.alarms.clear(ALARM);
  await follow();
  return (await getState()).tabId != null;
}

async function dismiss() {
  const { tabId } = await getState();
  await setState(IDLE);
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

chrome.runtime.onInstalled.addListener(({ reason }) => serially(async () => {
  if (reason === chrome.runtime.OnInstalledReason.UPDATE) await removeEverywhere();
  await schedule();
}));
chrome.runtime.onStartup.addListener(() => serially(schedule));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) serially(show);
});

chrome.tabs.onActivated.addListener(() => serially(follow));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) serially(follow);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // A page navigation wipes the injected popup, so put it back.
  if (changeInfo.status === 'complete' && tab.active) serially(follow);
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
