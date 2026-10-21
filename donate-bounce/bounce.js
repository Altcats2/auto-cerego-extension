(() => {
  // Always consume the hand-off, even if the popup is already on this page.
  const saved = window.__donateBounceMotion;
  delete window.__donateBounceMotion;
  if (window.__donateBounce) return;

  const { DEFAULTS, sanitizeUrl } = globalThis.DonateBounceConfig;
  const SPEED = 220; // px per second on each axis
  const NEAR = 6; // px from a wall that still counts as a corner

  const host = document.createElement('div');
  host.dataset.donateBounce = '';
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .card {
        position: absolute;
        left: 0;
        top: 0;
        width: 240px;
        box-sizing: border-box;
        padding: 16px 18px 18px;
        border-radius: 14px;
        background: var(--bg);
        color: #fff;
        font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        pointer-events: auto;
        user-select: none;
        will-change: transform;
        transition: background-color 0.25s;
      }
      .card.intro { animation: pop 0.35s ease-out; }
      .card.corner { animation: corner 0.6s ease-out; }
      @keyframes pop { from { opacity: 0; scale: 0.6; } to { opacity: 1; scale: 1; } }
      @keyframes corner {
        0%, 100% { scale: 1; }
        30% { scale: 1.25; box-shadow: 0 0 0 8px #fff, 0 10px 40px rgba(0, 0, 0, 0.4); }
      }
      .title { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; margin: 0 24px 6px 0; }
      p { margin: 0 0 14px; opacity: 0.95; }
      .donate {
        display: block;
        text-align: center;
        padding: 9px 0;
        border-radius: 999px;
        background: #fff;
        color: #111;
        font-weight: 700;
        text-decoration: none;
      }
      .donate:hover { filter: brightness(0.92); }
      .close {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.2);
        color: #fff;
        font: 18px/26px system-ui, sans-serif;
        cursor: pointer;
        padding: 0;
      }
      .close:hover { background: rgba(0, 0, 0, 0.35); }
    </style>
    <div class="card" role="dialog" aria-label="Donate">
      <button class="close" type="button" aria-label="Close">&times;</button>
      <div class="title">Donate?</div>
      <p>Your support keeps this thing bouncing.</p>
      <a class="donate" target="_blank" rel="noopener">Donate now</a>
    </div>`;
  document.documentElement.appendChild(host);

  const card = root.querySelector('.card');
  const link = root.querySelector('.donate');

  const setLink = (url) => { link.href = sanitizeUrl(url) ?? DEFAULTS.donateUrl; };
  setLink(DEFAULTS.donateUrl);
  chrome.storage.sync.get(DEFAULTS, ({ donateUrl }) => setLink(donateUrl));
  const onStorageChange = (changes, area) => {
    if (area === 'sync' && changes.donateUrl) setLink(changes.donateUrl.newValue);
  };
  chrome.storage.onChanged.addListener(onStorageChange);

  // chrome.runtime throws synchronously once the extension has been reloaded.
  const send = (msg) => {
    try {
      return chrome.runtime.sendMessage(msg);
    } catch (err) {
      return Promise.reject(err);
    }
  };

  const bounds = () => ({
    maxX: Math.max(0, host.clientWidth - card.offsetWidth),
    maxY: Math.max(0, host.clientHeight - card.offsetHeight),
  });

  let m;
  {
    const { maxX, maxY } = bounds();
    m = saved ?? {
      x: Math.random() * maxX,
      y: Math.random() * maxY,
      vx: SPEED * (Math.random() < 0.5 ? -1 : 1),
      vy: SPEED * (Math.random() < 0.5 ? -1 : 1),
      hue: Math.floor(Math.random() * 360),
    };
    m.x = Math.min(Math.max(0, m.x), maxX);
    m.y = Math.min(Math.max(0, m.y), maxY);
  }

  const paint = () => card.style.setProperty('--bg', `hsl(${m.hue} 80% 48%)`);
  const place = () => { card.style.transform = `translate(${m.x}px, ${m.y}px)`; };
  paint();
  place();
  if (!saved) card.classList.add('intro');

  // Like the DVD logo: new color on every wall hit.
  const recolor = () => {
    m.hue = (m.hue + 60 + Math.floor(Math.random() * 180)) % 360;
    paint();
  };

  const celebrateCorner = () => {
    card.classList.remove('intro', 'corner');
    void card.offsetWidth; // restart the animation
    card.classList.add('corner');
  };

  // Moves along one axis, bouncing off the walls at 0 and max. Only moving
  // into a wall counts as a hit, and an axis with no room (window smaller than
  // the card) stays pinned, or it would "hit" and recolor on every frame.
  const move = (pos, vel, max, dt) => {
    if (max <= 0) return { pos: 0, vel, hit: false };
    pos += vel * dt;
    if (pos <= 0) return { pos: 0, vel: Math.abs(vel), hit: vel < 0 };
    if (pos >= max) return { pos: max, vel: -Math.abs(vel), hit: vel > 0 };
    return { pos, vel, hit: false };
  };

  let paused = false;
  card.addEventListener('mouseenter', () => { paused = true; });
  card.addEventListener('mouseleave', () => { paused = false; });

  let last = performance.now();
  let raf;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!paused) {
      const { maxX, maxY } = bounds();
      const x = move(m.x, m.vx, maxX, dt);
      const y = move(m.y, m.vy, maxY, dt);
      m.x = x.pos;
      m.vx = x.vel;
      m.y = y.pos;
      m.vy = y.vel;

      if (x.hit || y.hit) {
        recolor();
        const cornerX = x.hit || m.x <= NEAR || m.x >= maxX - NEAR;
        const cornerY = y.hit || m.y <= NEAR || m.y >= maxY - NEAR;
        if (cornerX && cornerY) celebrateCorner();
      }
      place();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // Back/forward cache can restore this page with the popup still on it after
  // it was dismissed or moved elsewhere; ask whether it should still be here.
  const onPageShow = (e) => {
    if (!e.persisted) return;
    send({ type: 'donate-check' }).then((keep) => { if (!keep) remove(); }, remove);
  };
  window.addEventListener('pageshow', onPageShow);

  const remove = () => {
    cancelAnimationFrame(raf);
    host.remove();
    window.removeEventListener('pageshow', onPageShow);
    try {
      chrome.storage.onChanged.removeListener(onStorageChange);
    } catch {
      // extension was reloaded; nothing left to unhook
    }
    delete window.__donateBounce;
  };

  const dismiss = () => {
    remove();
    send({ type: 'donate-closed' }).catch(() => {});
  };

  root.querySelector('.close').addEventListener('click', dismiss);
  link.addEventListener('click', () => setTimeout(dismiss, 0));

  window.__donateBounce = { getMotion: () => ({ ...m }), remove };
})();
