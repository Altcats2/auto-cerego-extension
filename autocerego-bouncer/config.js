// Shared settings. Loaded by the background worker (importScripts), the popup
// (<script>), and injected into pages right before bounce.js. A page can get it
// injected more than once, so nothing here may be a top-level const/let.
globalThis.DonateBounceConfig = (() => {
  const DEFAULTS = Object.freeze({
    delayMinutes: 1,
    donateUrl: 'https://donate.stripe.com/eVq4gygsO4MJfvz4DvgrS00?prefilled_email=none@anonymous.com',
  });

  // Chrome won't fire alarms sooner than 30s.
  const MIN_DELAY_MINUTES = 0.5;

  // Pages the donate popup is allowed to appear on, as URL glob patterns where
  // "*" matches any run of characters. EDIT THIS LIST to control where it shows.
  // An empty list means "every page". Examples:
  //   'https://*.cerego.com/*'          -> any cerego page
  //   'https://app.cerego.com/learn/*'  -> only the /learn section
  const SHOW_ON = [
    // 'https://*.cerego.com/*',
  ];

  const globToRe = (glob) =>
    new RegExp(
      '^' +
        String(glob)
          .split('*')
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        '$'
    );
  const SHOW_ON_RES = SHOW_ON.map(globToRe);

  // True when the popup is allowed on this url (or the list is empty).
  const matchesShowList = (url) =>
    SHOW_ON_RES.length === 0 || SHOW_ON_RES.some((re) => re.test(String(url ?? '')));

  const sanitizeDelay = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? Math.max(MIN_DELAY_MINUTES, n) : DEFAULTS.delayMinutes;
  };

  // Returns a normalized http(s) URL, or null if it isn't one. A bare
  // "example.com/donate" gets https:// so it doesn't become a relative link.
  const sanitizeUrl = (value) => {
    let s = String(value ?? '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z\d+.-]*:/i.test(s)) s = `https://${s}`;
    try {
      const url = new URL(s);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  };

  return Object.freeze({ DEFAULTS, MIN_DELAY_MINUTES, SHOW_ON, matchesShowList, sanitizeDelay, sanitizeUrl });
})();
