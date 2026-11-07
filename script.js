// ---- Settings (stored in localStorage) -------------------------------------------
const STORAGE_KEY = "webtimer.config.v1";
const DEFAULTS = {
  pageTitle: "", // optional: falls back to "<heading> | <subheading or site name>"
  heading: "Relaunching in",
  subheading: "",
  siteUrl: "https://gritstonetech.com/",
  launchAt: null, // UTC timestamp (ms)
  accent: "#b20d24",
  logoUrl: "assets/gritstone-logo.svg",
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch {
    return false;
  }
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = parseInt(m ? m[1] : "b20d24", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const storedConfig = loadConfig();
const config = storedConfig || { ...DEFAULTS };
let ACCENT_RGB = "178, 13, 36"; // "r, g, b" for canvas drawing; updated by applyAccent()

// Applies an accent colour everywhere: CSS variables and the canvas animations.
function applyAccent(hex) {
  const rgb = hexToRgb(hex);
  const root = document.documentElement.style;
  root.setProperty("--gritstone-red", `rgb(${rgb.join(" ")})`);
  root.setProperty("--accent-rgb", rgb.join(" "));
  ACCENT_RGB = rgb.join(", ");
}
applyAccent(config.accent);

// Apply branding before anything renders.
(function applyConfig() {
  let host = config.siteUrl;
  try { host = new URL(config.siteUrl).hostname; } catch {}
  document.title = config.pageTitle || `${config.heading} | ${config.subheading || host}`;
  document.getElementById("eyebrow").textContent = host;
  document.getElementById("countdown-heading").textContent = config.heading;
  const subheading = document.getElementById("brand-subheading");
  subheading.textContent = config.subheading;
  subheading.hidden = !config.subheading;
  document.getElementById("brand-link").href = config.siteUrl;
  document.getElementById("brand-logo").src = config.logoUrl || DEFAULTS.logoUrl;
  document.getElementById("celebration-sub").textContent = `Taking you to ${host}…`;
})();

// ---- Setup dialog ------------------------------------------------------------------
const setupForm = document.getElementById("setup-form");
const setupError = document.getElementById("setup-error");
const fields = {
  pageTitle: document.getElementById("cfg-page-title"),
  heading: document.getElementById("cfg-heading"),
  subheading: document.getElementById("cfg-subheading"),
  siteUrl: document.getElementById("cfg-site-url"),
  launch: document.getElementById("cfg-launch"),
  accent: document.getElementById("cfg-accent"),
  logoUrl: document.getElementById("cfg-logo"),
};

function toLocalInputValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openSetup() {
  const defaultLaunch = Math.ceil((Date.now() + 3600000) / 900000) * 900000; // ~1h ahead, on a quarter hour
  fields.pageTitle.value = config.pageTitle;
  fields.heading.value = config.heading;
  fields.subheading.value = config.subheading;
  fields.siteUrl.value = config.siteUrl;
  fields.launch.value = toLocalInputValue(config.launchAt || defaultLaunch);
  fields.accent.value = config.accent;
  fields.logoUrl.value = config.logoUrl === DEFAULTS.logoUrl ? "" : config.logoUrl;
  updateLogoPreview();
  setupError.textContent = "";
  document.body.classList.add("setup-open");
  fields.pageTitle.focus();
}

function closeSetup() {
  if (!storedConfig) return; // first run: settings are required
  applyAccent(config.accent); // discard an unsaved accent preview
  document.body.classList.remove("setup-open");
}

// Live preview: recolour the page while the accent is being picked.
fields.accent.addEventListener("input", () => applyAccent(fields.accent.value));

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const pageTitle = fields.pageTitle.value.trim();
  const heading = fields.heading.value.trim();
  const siteUrl = fields.siteUrl.value.trim();
  const launchAt = fields.launch.value ? new Date(fields.launch.value).getTime() : NaN;

  if (!heading) return void (setupError.textContent = "Please fill in the heading.");
  try {
    if (!/^https?:$/.test(new URL(siteUrl).protocol)) throw 0;
  } catch {
    return void (setupError.textContent = "Enter a full site URL, e.g. https://example.com/");
  }
  if (!Number.isFinite(launchAt)) return void (setupError.textContent = "Choose a launch date and time.");
  if (launchAt <= Date.now()) return void (setupError.textContent = "The launch time must be in the future.");

  const saved = saveConfig({
    pageTitle,
    heading,
    subheading: fields.subheading.value.trim(),
    siteUrl,
    launchAt,
    accent: fields.accent.value,
    logoUrl: fields.logoUrl.value.trim() || DEFAULTS.logoUrl,
  });
  if (!saved) return void (setupError.textContent = "Couldn’t save settings: browser storage is blocked.");

  // Reload so the countdown, iframe and branding all start fresh from the new settings.
  try { sessionStorage.setItem("webtimer.showEditTip", "1"); } catch {}
  window.location.reload();
});

// ---- Logo finder -------------------------------------------------------------------
// Reads the site's HTML (only possible when the site allows cross-origin requests) and
// picks a logo <img>, apple-touch-icon, icon or og:image. Falls back to Google's public
// favicon service, which works for any site but returns an icon rather than a full logo.
const logoPreview = document.getElementById("cfg-logo-preview");
const logoFindButton = document.getElementById("cfg-logo-find");

function imageLoads(src) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 8000);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 1); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = src;
  });
}

async function scrapeLogoCandidates(siteUrl) {
  try {
    const res = await fetch(siteUrl, { mode: "cors", credentials: "omit" });
    if (!res.ok) return [];
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const base = doc.querySelector("base[href]")?.getAttribute("href") || siteUrl;
    const pick = (selector, attr) => [...doc.querySelectorAll(selector)].map((el) => el.getAttribute(attr));
    const logoImg = '[src*="logo" i], [class*="logo" i], [id*="logo" i], [alt*="logo" i]';
    const raw = [
      ...pick(`header img:is(${logoImg}), header [class*="logo" i] img, header [id*="logo" i] img`, "src"),
      ...pick(`img:is(${logoImg}), [class*="logo" i] img, [id*="logo" i] img`, "src"),
      ...pick('link[rel~="apple-touch-icon"]', "href"),
      ...pick('meta[property="og:logo"], meta[itemprop="logo"]', "content"),
      ...pick('link[rel~="icon"][type="image/svg+xml"], link[rel~="icon"][sizes]', "href"),
      ...pick('meta[property="og:image"]', "content"),
    ];
    return raw.filter(Boolean).map((src) => {
      try { return new URL(src, new URL(base, siteUrl)).href; } catch { return null; }
    }).filter(Boolean);
  } catch {
    return []; // blocked by CORS or network error
  }
}

async function findLogo() {
  let site;
  try { site = new URL(fields.siteUrl.value.trim()); } catch {
    setupError.textContent = "Enter the site URL first, then press Find.";
    return;
  }
  logoFindButton.disabled = true;
  logoFindButton.textContent = "…";
  setupError.textContent = "";

  const candidates = [...new Set(await scrapeLogoCandidates(site.href))];
  candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site.hostname)}&sz=256`);

  let found = null;
  for (const src of candidates) {
    if (await imageLoads(src)) { found = src; break; }
  }

  logoFindButton.disabled = false;
  logoFindButton.textContent = "Find";
  if (found) {
    fields.logoUrl.value = found;
    updateLogoPreview();
  } else {
    setupError.textContent = "Couldn’t find a logo for that site. Paste an image URL instead.";
  }
}

function updateLogoPreview() {
  const src = fields.logoUrl.value.trim();
  logoPreview.hidden = !src;
  if (src) logoPreview.src = src;
}

logoFindButton.addEventListener("click", findLogo);
fields.logoUrl.addEventListener("input", updateLogoPreview);
logoPreview.addEventListener("error", () => { logoPreview.hidden = true; });
// Auto-find when a site URL is entered and no logo has been chosen yet.
fields.siteUrl.addEventListener("change", () => {
  if (!fields.logoUrl.value.trim()) findLogo();
});

document.getElementById("setup-cancel").addEventListener("click", closeSetup);
document.getElementById("edit-button").addEventListener("click", openSetup);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSetup();
});
document.getElementById("setup").addEventListener("click", (event) => {
  if (event.target.id === "setup") closeSetup();
});

// ---- Live background animation -------------------------------------------------
// Large soft red glows drift toward random targets; small particles wander with
// randomly changing headings and link up with faint lines when close together.
(function startBackground() {
  const canvas = document.getElementById("bg-canvas");
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const rand = (min, max) => min + Math.random() * (max - min);

  let width = 0;
  let height = 0;
  let glows = [];
  let particles = [];
  let frameId = 0;
  let lastTime = 0;

  function makeGlow() {
    return {
      x: rand(0, width), y: rand(0, height),
      tx: rand(0, width), ty: rand(0, height),
      r: rand(0.25, 0.45) * Math.max(width, height),
      alpha: rand(0.05, 0.1),
      speed: rand(0.00015, 0.0004),
    };
  }

  function makeParticle() {
    return {
      x: rand(0, width), y: rand(0, height),
      angle: rand(0, Math.PI * 2),
      turn: rand(-0.6, 0.6),
      speed: rand(12, 34),
      size: rand(1.2, 3.4),
      alpha: rand(0.18, 0.5),
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const particleCount = Math.min(90, Math.round((width * height) / 16000));
    glows = Array.from({ length: 5 }, makeGlow);
    particles = Array.from({ length: particleCount }, makeParticle);
  }

  function step(dt) {
    for (const g of glows) {
      // Ease toward a random target; pick a new one when close.
      g.x += (g.tx - g.x) * g.speed * dt;
      g.y += (g.ty - g.y) * g.speed * dt;
      if (Math.hypot(g.tx - g.x, g.ty - g.y) < 40) {
        g.tx = rand(0, width);
        g.ty = rand(0, height);
      }
    }

    const seconds = dt / 1000;
    for (const p of particles) {
      // Random walk on the heading so every path is different and keeps changing.
      if (Math.random() < 0.02) p.turn = rand(-0.9, 0.9);
      p.angle += p.turn * seconds;
      p.x += Math.cos(p.angle) * p.speed * seconds;
      p.y += Math.sin(p.angle) * p.speed * seconds;

      // Wrap around the edges.
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
      if (p.y < -10) p.y = height + 10;
      if (p.y > height + 10) p.y = -10;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (const g of glows) {
      const gradient = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
      gradient.addColorStop(0, `rgba(${ACCENT_RGB}, ${g.alpha})`);
      gradient.addColorStop(1, `rgba(${ACCENT_RGB}, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    const linkDistance = Math.min(150, Math.max(width, height) * 0.12);
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < linkDistance) {
          ctx.strokeStyle = `rgba(${ACCENT_RGB}, ${0.14 * (1 - d / linkDistance)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    for (const p of particles) {
      ctx.fillStyle = `rgba(${ACCENT_RGB}, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(time) {
    const dt = Math.min(time - (lastTime || time), 50);
    lastTime = time;
    step(dt);
    draw();
    frameId = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(frameId);
    lastTime = 0;
    if (reduceMotion.matches) {
      draw(); // Static snapshot only.
    } else {
      frameId = requestAnimationFrame(frame);
    }
  }

  resize();
  start();
  window.addEventListener("resize", () => { resize(); start(); });
  reduceMotion.addEventListener?.("change", start);
})();

const redirectUrl = config.siteUrl;
const endTime = new Date(config.launchAt || Date.now() + 3600000);

const hoursElement = document.getElementById("hours");
const minutesElement = document.getElementById("minutes");
const secondsElement = document.getElementById("seconds");
const statusElement = document.getElementById("status");

function showLaunchTime() {
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(endTime);
  statusElement.textContent = `Counting down to the launch on ${when}.`;
}

function renderCountdown() {
  const remaining = endTime.getTime() - Date.now();

  if (remaining <= 0) {
    celebrateLaunch();
    return;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  hoursElement.textContent = String(hours).padStart(2, "0");
  minutesElement.textContent = String(minutes).padStart(2, "0");
  secondsElement.textContent = String(seconds).padStart(2, "0");
}

// ---- Launch celebration ----------------------------------------------------------
// Zeroes the timer, fades the panel out, shows a check mark + "We're live!" and fires
// confetti in brand colours for a few seconds, then redirects to the new site.
const CELEBRATION_MS = 4200;
let launched = false;

function celebrateLaunch() {
  if (launched) return;
  launched = true;
  clearInterval(countdownInterval);

  hoursElement.textContent = "00";
  minutesElement.textContent = "00";
  secondsElement.textContent = "00";
  statusElement.textContent = "We’re live! Opening the new website…";

  const celebration = document.getElementById("celebration");
  celebration.removeAttribute("aria-hidden");
  document.body.classList.add("launched");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion) runConfetti(CELEBRATION_MS - 600);

  setTimeout(revealNewSite, reduceMotion ? 2500 : CELEBRATION_MS);
}

// ---- New site reveal ---------------------------------------------------------------
// No redirect: the new landing page is preloaded in a hidden iframe. At launch the
// countdown page scrolls up while the iframe fades in, then the iframe is hard-refreshed
// (cache-busted URL) behind a progress bar so visitors see the freshest build. A
// cross-origin iframe exposes no progress or paint timing, only its load event, so the
// bar sweeps while loading and fills to 100% exactly when the iframe finishes.
const REVEAL_MS = 1200;
const PROGRESS_FILL_MS = 300;
const PROGRESS_MAX_MS = 10000; // never show the progress bar longer than this
const siteLayer = document.getElementById("site-layer");
const siteFrame = document.getElementById("site-frame");

const siteUrl = document.getElementById("site-url");
siteUrl.href = redirectUrl;
try { siteUrl.textContent = new URL(redirectUrl).hostname; } catch { siteUrl.textContent = redirectUrl; }

function cacheBustedUrl() {
  const url = new URL(redirectUrl);
  url.searchParams.set("_", Date.now());
  return url.toString();
}

function revealNewSite() {
  siteLayer.removeAttribute("aria-hidden");
  document.body.classList.add("revealing");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => {
    document.body.classList.remove("loaded");
    document.body.classList.add("reloading");
    // Finish on the iframe's load event, or after PROGRESS_MAX_MS at the latest.
    let finished = false;
    const finishProgress = () => {
      if (finished) return;
      finished = true;
      clearTimeout(maxTimer);
      document.body.classList.add("loaded");
      setTimeout(() => document.body.classList.remove("reloading"), PROGRESS_FILL_MS + 150);
    };
    const maxTimer = setTimeout(finishProgress, PROGRESS_MAX_MS);
    siteFrame.addEventListener("load", finishProgress, { once: true });
    siteFrame.src = cacheBustedUrl();
  }, reduceMotion ? 0 : REVEAL_MS);
}

function runConfetti(durationMs) {
  const canvas = document.getElementById("confetti-canvas");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Accent, two lighter tints of it, plus dark, gold and white.
  const [r, g, b] = ACCENT_RGB.split(",").map(Number);
  const tint = (t) => `rgb(${[r, g, b].map((c) => Math.round(c + (255 - c) * t)).join(", ")})`;
  const colors = [`rgb(${ACCENT_RGB})`, tint(0.25), tint(0.55), "#242326", "#ffc857", "#ffffff"];
  const rand = (min, max) => min + Math.random() * (max - min);
  const power = Math.min(1.4, Math.max(0.7, height / 800));
  const pieces = [];

  function burst(x, y, angleCenter, spread, count, speedMax) {
    for (let i = 0; i < count; i++) {
      const angle = angleCenter + rand(-spread, spread);
      const speed = rand(0.55, 1) * speedMax * power;
      pieces.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: rand(6, 12), h: rand(8, 16),
        rot: rand(0, Math.PI * 2), vrot: rand(-12, 12),
        tilt: rand(0, Math.PI * 2), vtilt: rand(4, 10),
        color: colors[Math.floor(Math.random() * colors.length)],
        round: Math.random() < 0.3,
      });
    }
  }

  // Two cannons from the bottom corners plus a centre pop, then a second volley.
  burst(0, height, -Math.PI / 3, 0.35, 90, 1500);
  burst(width, height, -2 * Math.PI / 3, 0.35, 90, 1500);
  burst(width / 2, height * 0.45, -Math.PI / 2, Math.PI, 70, 900);
  setTimeout(() => {
    burst(width * 0.2, height, -Math.PI / 2.4, 0.3, 50, 1300);
    burst(width * 0.8, height, -Math.PI / 1.7, 0.3, 50, 1300);
  }, 650);

  const GRAVITY = 420;
  const DRAG = 2.6;
  const start = performance.now();
  let last = start;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const elapsed = now - start;
    const fade = Math.max(0, Math.min(1, (durationMs - elapsed) / 600));

    ctx.clearRect(0, 0, width, height);
    for (const p of pieces) {
      p.vx -= p.vx * DRAG * dt;
      p.vy += (GRAVITY - p.vy * DRAG) * dt;
      p.x += (p.vx + Math.sin(p.tilt) * 40) * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.tilt += p.vtilt * dt;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.tilt)); // flutter
      ctx.fillStyle = p.color;
      const outlined = p.color === "#ffffff";
      if (outlined) {
        ctx.strokeStyle = `rgba(${ACCENT_RGB}, 0.35)`;
        ctx.lineWidth = 1;
      }
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
        if (outlined) ctx.stroke();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        if (outlined) ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }

    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
  }

  requestAnimationFrame(frame);
}

function updateCountdown() {
  if (launched) return;
  renderCountdown();
}

let countdownInterval = 0;
if (storedConfig && storedConfig.launchAt) {
  siteFrame.src = redirectUrl; // preload the new site
  showLaunchTime();
  countdownInterval = setInterval(updateCountdown, 250);
  updateCountdown();
} else {
  document.body.classList.add("first-run");
  openSetup();
}

// ---- Edit button tip ------------------------------------------------------------------
// After settings are saved, point out the (faint) edit button for five seconds.
(function showEditTip() {
  let pending = false;
  try {
    pending = sessionStorage.getItem("webtimer.showEditTip") === "1";
    sessionStorage.removeItem("webtimer.showEditTip");
  } catch {}
  if (!pending) return;
  const tip = document.getElementById("edit-tip");
  requestAnimationFrame(() => document.body.classList.add("edit-tip-visible"));
  setTimeout(() => document.body.classList.remove("edit-tip-visible"), 5000);
  tip.addEventListener("click", () => document.body.classList.remove("edit-tip-visible"));
})();
