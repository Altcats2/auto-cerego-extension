// Shared settings. Loaded by the background worker (importScripts), the popup
// (<script>), and injected into pages right before bounce.js. A page can get it
// injected more than once, so nothing here may be a top-level const/let.
globalThis.DonateBounceConfig = (() => {
  const DEFAULTS = Object.freeze({
    delayMinutes: 1,
    donateUrl: 'https://example.com/donate',
  });

  // Chrome won't fire alarms sooner than 30s.
  const MIN_DELAY_MINUTES = 0.5;

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

  return Object.freeze({ DEFAULTS, MIN_DELAY_MINUTES, sanitizeDelay, sanitizeUrl });
})();
