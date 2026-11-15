"use strict";
/* Nagham – themes: presets, custom themes, "match the song", animated effects */

const BUILTIN_THEMES = [
  { id: "midnight", name: "Midnight Purple", mode: "dark", accent: "#a970ff", bg1: "#160b2e", bg2: "#05030b", angle: 160, panel: "#1b1033", panelOpacity: .62, blur: 18, radius: 18, fx: "stars", blobs: ["#6d28d9", "#a855f7", "#312e81"] },
  { id: "sakura", name: "Sakura", mode: "light", accent: "#e2558a", bg1: "#fff3f7", bg2: "#ffd3e3", angle: 160, panel: "#ffffff", panelOpacity: .58, blur: 22, radius: 22, fx: "petals", text: "#4a2132", blobs: ["#ffb3cd", "#ffd9e6", "#f9a8d4"] },
  { id: "glass", name: "Glass", mode: "dark", accent: "#7dd3fc", bg1: "#0f172a", bg2: "#1e1b4b", angle: 135, panel: "#ffffff", panelOpacity: .07, panelSolid: "#171c3a", blur: 30, radius: 22, fx: "blobs", border: "rgba(255,255,255,.16)", blobs: ["#3b82f6", "#06b6d4", "#ec4899"] },
  { id: "desert", name: "Desert Night", mode: "dark", accent: "#e8b75c", bg1: "#21180c", bg2: "#090604", angle: 170, panel: "#22190d", panelOpacity: .7, blur: 16, radius: 16, fx: "stars", blobs: ["#b45309", "#78350f", "#451a03"] },
  { id: "ocean", name: "Ocean", mode: "dark", accent: "#38bdf8", bg1: "#04182b", bg2: "#0b2e4a", angle: 160, panel: "#0a2236", panelOpacity: .6, blur: 22, radius: 18, fx: "blobs", blobs: ["#0284c7", "#0d9488", "#1e3a8a"] },
  { id: "sunset", name: "Sunset", mode: "dark", accent: "#ff8a5b", bg1: "#2b0f22", bg2: "#110610", angle: 150, panel: "#2a1022", panelOpacity: .6, blur: 22, radius: 20, fx: "blobs", blobs: ["#f97316", "#db2777", "#7c3aed"] },
  { id: "classic", name: "Classic Dark", mode: "dark", accent: "#2ee6a8", bg1: "#000000", bg2: "#0a0a0a", angle: 180, panel: "#121212", panelOpacity: 1, blur: 0, radius: 10, fx: "none", blobs: ["#2ee6a8", "#0ea5e9", "#22c55e"] },
  { id: "aurora", name: "Aurora", mode: "dark", accent: "#5eead4", accent2: "#a78bfa", gradient: true, bg1: "#061a1f", bg2: "#120a2a", angle: 165, panel: "#0d1f26", panelOpacity: .6, blur: 22, radius: 20, fx: "blobs", blobs: ["#10b981", "#8b5cf6", "#06b6d4"] },
  { id: "cyber", name: "Cyber Neon", mode: "dark", accent: "#ff2fd0", accent2: "#00e5ff", gradient: true, bg1: "#0b0418", bg2: "#001b2e", angle: 150, panel: "#12071f", panelOpacity: .66, blur: 16, radius: 10, fx: "rain", blobs: ["#ff2fd0", "#00e5ff", "#7c3aed"], font: "bahnschrift" },
  { id: "ramadan", name: "Ramadan Nights", mode: "dark", accent: "#f5c451", accent2: "#ffe7a3", gradient: true, bg1: "#0b1633", bg2: "#03060f", angle: 170, panel: "#0e1c3d", panelOpacity: .66, blur: 18, radius: 18, fx: "fireflies", blobs: ["#f5c451", "#1e3a8a", "#312e81"], font: "arabic" },
  { id: "forest", name: "Forest", mode: "dark", accent: "#86d36b", bg1: "#0c1a10", bg2: "#050a06", angle: 170, panel: "#11241a", panelOpacity: .7, blur: 16, radius: 16, fx: "fireflies", blobs: ["#4d7c0f", "#166534", "#14532d"] },
  { id: "lava", name: "Lava", mode: "dark", accent: "#ff5a1f", accent2: "#ffb703", gradient: true, bg1: "#2a0a05", bg2: "#0b0302", angle: 160, panel: "#2a0e08", panelOpacity: .7, blur: 16, radius: 16, fx: "blobs", blobs: ["#dc2626", "#ea580c", "#7c2d12"] },
  { id: "arctic", name: "Arctic", mode: "light", accent: "#2b7de9", bg1: "#f2f8ff", bg2: "#d6eaff", angle: 170, panel: "#ffffff", panelOpacity: .7, blur: 20, radius: 20, fx: "snow", text: "#10243e", blobs: ["#bae6fd", "#dbeafe", "#e0f2fe"] },
  { id: "rosegold", name: "Rose Gold", mode: "light", accent: "#c46b5a", accent2: "#e9b27a", gradient: true, bg1: "#fff6f1", bg2: "#f3d6cb", angle: 160, panel: "#ffffff", panelOpacity: .64, blur: 22, radius: 22, fx: "bubbles", text: "#4a2c25", blobs: ["#fbcfe8", "#fed7aa", "#fecdd3"] },
  { id: "mono", name: "Mono", mode: "dark", accent: "#ffffff", bg1: "#0a0a0a", bg2: "#000000", angle: 180, panel: "#141414", panelOpacity: .96, blur: 0, radius: 6, fx: "none", blobs: ["#444", "#222", "#333"] },
  { id: "daylight", name: "Daylight", mode: "light", accent: "#6d5dfc", bg1: "#f5f6fb", bg2: "#e4e8f4", angle: 160, panel: "#ffffff", panelOpacity: .82, blur: 16, radius: 18, fx: "none", text: "#17151f", blobs: ["#a5b4fc", "#c4b5fd", "#93c5fd"] },
];
const FONTS = {
  default: ['Segoe UI (default)', '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'],
  bahnschrift: ['Bahnschrift', 'Bahnschrift, "Segoe UI", sans-serif'],
  trebuchet: ['Trebuchet', '"Trebuchet MS", "Segoe UI", sans-serif'],
  tahoma: ['Tahoma', 'Tahoma, Verdana, sans-serif'],
  georgia: ['Georgia (serif)', 'Georgia, "Times New Roman", serif'],
  arabic: ['Arabic classic', '"Sakkal Majalla", "Traditional Arabic", "Segoe UI", sans-serif'],
  mono: ['Consolas (mono)', 'Consolas, "Cascadia Mono", monospace'],
  comic: ['Comic', '"Comic Sans MS", "Segoe Print", cursive'],
};
const NAV_ITEMS = [["search", "Search"], ["songs", "On this PC"], ["albums", "Albums"], ["artists", "Artists"], ["themes", "Themes"]];
const ACCENT_SWATCHES = ["#a970ff", "#e2558a", "#7dd3fc", "#2ee6a8", "#e8b75c", "#ff8a5b", "#38bdf8", "#f43f5e", "#84cc16", "#fbbf24", "#ffffff", "#6d5dfc"];

function allThemes() { return [...BUILTIN_THEMES, ...(settings.customThemes || [])]; }
function currentTheme() { return allThemes().find(t => t.id === settings.themeId) || BUILTIN_THEMES[0]; }
let activeTheme = null;

function applyTheme(th) {
  activeTheme = th;
  const r = document.documentElement.style;
  const light = th.mode === "light";
  const text = th.text || (light ? "#1d1520" : "#ffffff");
  const panel = th.panel || (light ? "#ffffff" : mixHex(th.bg1, "#000000", .3));
  const solid = th.panelSolid || (th.panelOpacity < .3 ? mixHex(th.bg1, light ? "#ffffff" : "#000000", .2) : panel);
  document.documentElement.dataset.mode = light ? "light" : "dark";
  r.setProperty("--app-bg", `radial-gradient(1100px 700px at 8% -10%, ${rgba(th.accent, light ? .16 : .2)}, transparent 60%), linear-gradient(${th.angle ?? 160}deg, ${th.bg1}, ${th.bg2})`);
  r.setProperty("--bg-image", th.image ? `url("${th.image}")` : "none");
  const lite = document.body.classList.contains("lite");
  r.setProperty("--panel", rgba(panel, lite ? Math.max(th.panelOpacity ?? .6, .94) : (th.panelOpacity ?? .6)));
  r.setProperty("--panel-solid", solid);
  r.setProperty("--menu-bg", light ? mixHex(solid, "#ffffff", .5) : mixHex(solid, "#ffffff", .07));
  r.setProperty("--panel-border", th.border || (light ? "rgba(0,0,0,.07)" : "rgba(255,255,255,.08)"));
  r.setProperty("--blur", (th.blur ?? 18) + "px");
  r.setProperty("--radius", (th.radius ?? 18) + "px");
  r.setProperty("--text", text);
  r.setProperty("--muted", rgba(text, light ? .62 : .64));
  r.setProperty("--dim", rgba(text, .38));
  r.setProperty("--hero-strength", light ? "55%" : "72%");
  r.setProperty("--shadow", light ? "0 18px 50px rgba(80,40,60,.18)" : "0 18px 50px rgba(0,0,0,.5)");
  const bl = th.blobs || [th.accent, th.bg2, th.bg1];
  bl.forEach((c, i) => r.setProperty(`--blob${i + 1}`, c));
  if (th.muted) r.setProperty("--muted", th.muted);
  r.setProperty("--font", (FONTS[th.font] || FONTS.default)[1]);
  document.body.style.zoom = (th.fontScale || 100) / 100;
  r.setProperty("--zoom", (th.fontScale || 100) / 100);
  r.setProperty("--cover-r", { square: "4px", circle: "50%" }[th.coverShape] || "calc(var(--radius) * .6)");
  r.setProperty("--tile", ({ s: 140, l: 224 }[th.tileSize] || 176) + "px");
  if (th.playerBg) r.setProperty("--player-bg", rgba(th.playerBg, Math.max(th.panelOpacity ?? .6, .35))); else r.removeProperty("--player-bg");
  r.setProperty("--img-filter", `blur(${th.imageBlur || 0}px) brightness(${1 - (th.imageDim || 0) / 100})`);
  const b = document.body.classList;
  b.toggle("side-slim", th.sidebar === "slim"); b.toggle("side-wide", th.sidebar === "wide");
  b.toggle("player-docked", th.player === "docked"); b.toggle("dense", th.density === "compact");
  for (const [k] of NAV_ITEMS) { const a = $(`#side .nav [data-nav="${k}"]`); if (a) a.style.display = (th.hideNav || []).includes(k) ? "none" : ""; }
  setAccent(th.accent);
  r.setProperty("--accent2", th.accent2 || th.accent);
  b.toggle("grad", !!th.gradient && !!th.accent2);
  setTitleBar(th.titleBar || mixHex(th.bg1, th.accent, light ? .1 : .16));
  setFx(settings.effects === false || lite ? "none" : th.fx, th.fxAmount ?? 100);
  document.body.classList.toggle("reduce-motion", settings.anim === false);
  if (settings.dynamic) refreshDynamic();
}
/* colour of the window's title bar (Edge/Chrome app windows follow <meta name="theme-color">) */
function setTitleBar(hex) {
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
  m.content = hex;
  winState.caption = hex;
  windowSync();
}
/* tell Nagham's window (title bar colour + title) about changes */
const winState = { caption: "#160b2e", title: "Nagham" };
let winSyncT;
function windowSync() {
  clearTimeout(winSyncT);
  winSyncT = setTimeout(() => {
    const c = winState.caption, dark = luminance(hexToRgb(c)) < .4;
    const text = (activeTheme?.titleText) || (dark ? "#ffffff" : "#1d1520");
    fetch("/api/window/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption: c, text, dark, title: winState.title }) }).catch(() => {});
    if (settings.windowBg !== c && !draft) { settings.windowBg = c; if (lib.tracks !== undefined) saveUser(); }
  }, 80);
}
function setAccent(hex) {
  const r = document.documentElement.style;
  r.setProperty("--accent", hex);
  r.setProperty("--on-accent", luminance(hexToRgb(hex)) > .42 ? "#111111" : "#ffffff");
  r.setProperty("--hero", hex);
}

/* ---------- match the song ---------- */
let dynToken = 0;
async function refreshDynamic() {
  const th = activeTheme || currentTheme();
  const on = settings.dynamic;
  document.body.classList.toggle("dynamic", !!on);
  $("#dynBtn")?.classList.toggle("on", !!on); renderMe?.();
  if (!on || !P.current) { setAccent(th.accent); restoreBlobs(th); setTitleBar(th.bg1); return; }
  const tok = ++dynToken;
  const p = await palette(coverOf(P.current));
  if (tok !== dynToken || !settings.dynamic) return;
  if (!p || !p.vibrant) { setAccent(th.accent); restoreBlobs(th); setTitleBar(th.bg1); return; }
  const r = document.documentElement.style;
  setAccent(accentFor(p.main, th.mode));
  setTitleBar(mixHex(th.bg1, p.main, th.mode === "light" ? .18 : .22));
  r.setProperty("--hero", heroColor(p.main, th.mode));
  r.setProperty("--dyn1", rgba(p.main, th.mode === "light" ? .35 : .5));
  r.setProperty("--dyn2", rgba(p.second, th.mode === "light" ? .3 : .45));
  r.setProperty("--dyn3", rgba(p.third, th.mode === "light" ? .25 : .35));
  [p.main, p.second, p.third].forEach((c, i) => r.setProperty(`--blob${i + 1}`, c));
}
function restoreBlobs(th) { (th.blobs || []).forEach((c, i) => document.documentElement.style.setProperty(`--blob${i + 1}`, c)); }
function setDynamic(on) {
  settings.dynamic = on; saveUser(); refreshDynamic();
  toast(on ? "Theme now follows each song's colours" : "Match song: off");
  if (nav.stack[nav.idx]?.view === "themes") render(true);
}
if ($("#dynBtn")) $("#dynBtn").onclick = () => setDynamic(!settings.dynamic);

/* ---------- performance mode ---------- */
function setLite(on) {
  document.body.classList.toggle("lite", !!on);
  fxKind = null; applyTheme(activeTheme || currentTheme());
}
/* instant check before the first paint: no graphics acceleration → lite mode right away */
function quickPerfCheck() {
  if (settings.perf === "off") return;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const d = gl && gl.getExtension("WEBGL_debug_renderer_info");
    const name = d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : "";
    if (!gl || /swiftshader|basic render|llvmpipe|software|microsoft basic/i.test(name)) document.body.classList.add("lite");
  } catch { document.body.classList.add("lite"); }
}
function measureFps(ms = 1200) {
  return new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; const dt = performance.now() - t0; if (dt < ms) requestAnimationFrame(f); else res(n * 1000 / dt); })(); });
}
async function detectPerf() {
  const mode = settings.perf || "auto";
  if (mode === "on") return setLite(true);
  if (mode === "off") return setLite(false);
  let soft = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) soft = true;
    else { const d = gl.getExtension("WEBGL_debug_renderer_info"); const name = d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : ""; if (/swiftshader|basic render|llvmpipe|software|microsoft basic/i.test(name)) soft = true; }
  } catch { soft = true; }
  if (soft) { settings.liteAuto = true; saveUser(); return setLite(true); }
  if (document.hidden) return;
  const fps = await measureFps(1500);
  const slow = fps < 40;
  if (slow !== !!settings.liteAuto) { settings.liteAuto = slow; saveUser(); }
  setLite(slow);
}
function setPerfMode(mode) { settings.perf = mode; saveUser(); detectPerf(); }

/* ---------- animated effects ---------- */
let fxKind = null, fxRAF = 0, fxAmt = 100;
function setFx(kind, amt = 100) {
  if (kind === fxKind && amt === fxAmt) return;
  fxKind = kind; fxAmt = amt; cancelAnimationFrame(fxRAF);
  if (amt <= 0) kind = "none";
  const host = $("#fx"); host.innerHTML = "";
  host.style.opacity = Math.min(1, .35 + amt / 150);
  if (kind === "blobs") host.innerHTML = '<div class="blob"></div><div class="blob"></div><div class="blob"></div>';
  else if (kind === "stars") {
    let h = "";
    for (let i = 0; i < Math.round(110 * amt / 100); i++) {
      const s = Math.random() < .15 ? 3 : Math.random() < .5 ? 2 : 1;
      h += `<i class="star" style="left:${(Math.random() * 100).toFixed(2)}%;top:${(Math.random() * 100).toFixed(2)}%;width:${s}px;height:${s}px;animation-delay:${(-Math.random() * 4).toFixed(2)}s;animation-duration:${(3 + Math.random() * 4).toFixed(2)}s"></i>`;
    }
    host.innerHTML = h + '<div class="blob" style="opacity:.25"></div><div class="blob" style="opacity:.2"></div>';
  } else if (kind === "petals") petals(host);
  else if (["snow", "rain", "fireflies", "bubbles"].includes(kind)) particles(host, kind, amt);
}
/* snow, rain, fireflies, bubbles – one light canvas engine */
function particles(host, kind, amt) {
  const c = document.createElement("canvas"); host.appendChild(c);
  const x = c.getContext("2d");
  let W, H, dpr;
  const size = () => { dpr = Math.min(devicePixelRatio || 1, 1.5); W = c.width = innerWidth * dpr; H = c.height = innerHeight * dpr; };
  size(); addEventListener("resize", size);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#a970ff", text = css.getPropertyValue("--text").trim() || "#fff";
  const base = { snow: 90, rain: 110, fireflies: 34, bubbles: 26 }[kind];
  const n = Math.max(6, Math.round(base * amt / 100));
  const R = Math.random;
  const mk = top => {
    const p = { x: R() * W, y: top ? -20 * dpr : R() * H, t: R() * 6.28 };
    if (kind === "snow") Object.assign(p, { r: (1 + R() * 2.6) * dpr, vy: (.3 + R() * .8) * dpr, vx: (R() - .5) * .3 * dpr, a: .4 + R() * .5 });
    if (kind === "rain") Object.assign(p, { l: (10 + R() * 18) * dpr, vy: (7 + R() * 6) * dpr, vx: 1.4 * dpr, a: .15 + R() * .25 });
    if (kind === "fireflies") Object.assign(p, { r: (1.5 + R() * 2.5) * dpr, vx: (R() - .5) * .4 * dpr, vy: (R() - .5) * .4 * dpr, s: .01 + R() * .03 });
    if (kind === "bubbles") Object.assign(p, { y: top ? H + 30 * dpr : R() * H, r: (4 + R() * 14) * dpr, vy: -(.3 + R() * .7) * dpr, a: .12 + R() * .18 });
    return p;
  };
  const ps = Array.from({ length: n }, () => mk(false));
  const draw = () => {
    if (fxKind !== kind) return;
    if (!document.hidden) {
      x.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.t += .02; p.x += p.vx || 0; p.y += p.vy || 0;
        if (kind === "snow") { p.x += Math.sin(p.t) * .3 * dpr; x.globalAlpha = p.a; x.fillStyle = "#fff"; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.28); x.fill(); if (p.y > H + 10) Object.assign(p, mk(true)); }
        if (kind === "rain") { x.globalAlpha = p.a; x.strokeStyle = text; x.lineWidth = dpr; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x - p.vx * 2, p.y - p.l); x.stroke(); if (p.y > H + 20) Object.assign(p, mk(true)); }
        if (kind === "fireflies") {
          p.vx += (R() - .5) * .04 * dpr; p.vy += (R() - .5) * .04 * dpr; p.vx *= .98; p.vy *= .98;
          if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
          const a = .35 + .65 * Math.abs(Math.sin(p.t * (p.s * 40)));
          const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
          g.addColorStop(0, accent); g.addColorStop(1, "transparent");
          x.globalAlpha = a; x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, p.r * 5, 0, 6.28); x.fill();
        }
        if (kind === "bubbles") { p.x += Math.sin(p.t) * .4 * dpr; x.globalAlpha = p.a; x.strokeStyle = accent; x.lineWidth = 1.5 * dpr; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.28); x.stroke(); if (p.y < -30 * dpr) Object.assign(p, mk(true)); }
      }
    }
    fxRAF = requestAnimationFrame(draw);
  };
  draw();
}
function petals(host) {
  const c = document.createElement("canvas"); host.appendChild(c);
  const x = c.getContext("2d");
  let W, H, dpr;
  const size = () => { dpr = devicePixelRatio || 1; W = c.width = innerWidth * dpr; H = c.height = innerHeight * dpr; };
  size(); addEventListener("resize", size);
  const cols = ["#ffb7cf", "#ff9fc0", "#ffd0df", "#fbc4d8", "#ffe3ec"];
  const mk = (top) => ({ x: Math.random() * W, y: top ? -20 * dpr : Math.random() * H, s: (6 + Math.random() * 9) * dpr, vy: (.35 + Math.random() * .7) * dpr, vx: (.2 + Math.random() * .5) * dpr, a: Math.random() * 6.28, va: (Math.random() - .5) * .03, sw: Math.random() * 6.28, c: cols[Math.floor(Math.random() * cols.length)], o: .55 + Math.random() * .4 });
  const ps = Array.from({ length: Math.max(4, Math.round(34 * fxAmt / 100)) }, () => mk(false));
  const draw = () => {
    if (fxKind !== "petals") return;
    if (!document.hidden) {
      x.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.sw += .015; p.y += p.vy; p.x += p.vx + Math.sin(p.sw) * .6 * dpr; p.a += p.va;
        if (p.y > H + 30 * dpr || p.x > W + 30 * dpr) Object.assign(p, mk(true), { x: Math.random() * W * 1.1 - W * .1 });
        x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.scale(1, .6 + .4 * Math.abs(Math.sin(p.sw * 2)));
        x.globalAlpha = p.o; x.fillStyle = p.c;
        x.beginPath(); x.moveTo(0, -p.s);
        x.bezierCurveTo(p.s * .9, -p.s * .6, p.s * .7, p.s * .6, 0, p.s);
        x.bezierCurveTo(-p.s * .7, p.s * .6, -p.s * .9, -p.s * .6, 0, -p.s * .55);
        x.fill(); x.restore();
      }
    }
    fxRAF = requestAnimationFrame(draw);
  };
  draw();
}

/* ---------- themes page ---------- */
function themePreview(th) {
  const light = th.mode === "light";
  const text = th.text || (light ? "#1d1520" : "#fff");
  const panel = rgba(th.panel || (light ? "#ffffff" : "#000000"), Math.max(th.panelOpacity ?? .6, .12));
  const bg = th.image ? `url("${th.image}") center/cover` : `linear-gradient(${th.angle ?? 160}deg, ${th.bg1}, ${th.bg2})`;
  return `<div class="pv" style="background:${bg}">
    <div class="p" style="background:${panel}"><div class="ln" style="background:${text}"></div><div class="ln" style="background:${text};width:60%"></div><div class="ln" style="background:${th.accent};width:70%;opacity:.9"></div></div>
    <div class="p" style="background:${panel}"><div class="ln" style="background:${text};width:50%;height:9px"></div><div class="ln" style="background:${text}"></div></div>
    <div class="dot" style="background:${th.accent}"></div>
    <div class="bar" style="background:${panel}"><div style="width:40%;height:4px;border-radius:2px;background:${th.accent}"></div></div>
  </div>`;
}
function themeCard(th, custom) {
  return `<div class="theme-card ${settings.themeId === th.id ? "on" : ""}" data-theme="${th.id}">${themePreview(th)}
    <div class="check">${IC.check}</div>
    <div class="tc-info"><span>${esc(th.name)}</span>${custom ? `<button class="icon-btn" data-thmenu="${th.id}" title="More">${IC.dots}</button>` : `<span class="muted" style="font-size:12px;font-weight:600">${th.mode === "light" ? "Light" : "Dark"}</span>`}</div></div>`;
}
function switchRow(id, title, desc, on) {
  return `<div class="set-row"><div class="lbl"><b>${title}</b><span>${desc}</span></div><label class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><i></i></label></div>`;
}
VIEWS_EXTRA.themes = () => `<div class="pad fade-in"><h1 class="greet">Themes</h1>${themesBody()}</div>`;
const themesBody = () => `
  <div class="settings-sec">
    ${switchRow("swDyn", "Match the song", "Colours change to match the cover of whatever is playing", settings.dynamic)}
    ${switchRow("swFx", "Animated effects", "Falling petals, stars and moving light in the background", settings.effects !== false)}
    ${switchRow("swAnim", "Interface animations", "Smooth transitions, hover motion and playing effects", settings.anim !== false)}
    <div class="set-row"><div class="lbl"><b>Performance mode</b><span>Turns off glass blur and moving effects so Nagham stays smooth on older PCs. Auto switches it on when your PC needs it.${document.body.classList.contains("lite") ? " <b style='color:var(--accent)'>On right now.</b>" : ""}</span></div>
      <div class="seg" data-perf>${[["auto", "Auto"], ["on", "On"], ["off", "Off"]].map(([v, l]) => `<button data-v="${v}" class="${(settings.perf || "auto") === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
  </div>
  <h2 class="sec">Ready-made</h2>
  <div class="theme-grid">${BUILTIN_THEMES.map(t => themeCard(t)).join("")}</div>
  <h2 class="sec">Your themes <span class="hint">Make your own, or paste a theme code from a friend</span></h2>
  <div class="theme-grid">
    <div class="theme-card" data-newtheme style="display:grid;place-items:center;min-height:178px;border:2px dashed var(--line);background:transparent">
      <div style="text-align:center"><div style="width:48px;height:48px;margin:0 auto 10px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:grid;place-items:center">${IC.plus.replace("<svg", '<svg width="24" height="24"')}</div><b>Create theme</b></div>
    </div>
    ${(settings.customThemes || []).map(t => themeCard(t, true)).join("")}
  </div>`;

function themeMenu(id, x, y) {
  const th = settings.customThemes.find(t => t.id === id); if (!th) return;
  menu(x, y, [
    { label: "Edit", icon: IC.edit, act: () => go("themeEdit", id) },
    { label: "Share theme code", icon: IC.share, act: () => shareTheme(th) },
    { label: "Duplicate", icon: IC.copy, act: () => { const c = { ...th, id: "c" + uid(), name: th.name + " copy" }; settings.customThemes.push(c); saveUser(); render(true); } },
    "-",
    { label: "Delete", icon: IC.trash, act: async () => {
      if (!await confirm_(`Delete “${th.name}”?`, "This theme will be removed.", "Delete")) return;
      settings.customThemes = settings.customThemes.filter(t => t.id !== id);
      if (settings.themeId === id) { settings.themeId = "midnight"; applyTheme(currentTheme()); }
      saveUser(); render(true);
    } },
  ]);
}
function useTheme(id) {
  document.body.classList.add("theme-anim"); clearTimeout(useTheme.t); useTheme.t = setTimeout(() => document.body.classList.remove("theme-anim"), 800);
  settings.themeId = id; applyTheme(currentTheme()); saveUser();
}

$("#view").addEventListener("click", e => {
  const pf = e.target.closest("[data-perf] button");
  if (pf) { setPerfMode(pf.dataset.v); setTimeout(() => render(true), 1700); toast({ auto: "Performance mode: automatic", on: "Performance mode on", off: "Performance mode off" }[pf.dataset.v]); return; }
  const tm = e.target.closest("[data-thmenu]");
  if (tm) { e.stopPropagation(); const r = tm.getBoundingClientRect(); themeMenu(tm.dataset.thmenu, r.left - 150, r.bottom); return; }
  const card = e.target.closest("[data-theme]");
  if (card) { useTheme(card.dataset.theme); $$(".theme-card[data-theme]").forEach(c => c.classList.toggle("on", c.dataset.theme === settings.themeId)); return; }
  if (e.target.closest("[data-newtheme]")) go("themeEdit", "");
});
$("#view").addEventListener("change", e => {
  if (e.target.id === "swDyn") setDynamic(e.target.checked);
  if (e.target.id === "swAnim") { settings.anim = e.target.checked; saveUser(); document.body.classList.toggle("reduce-motion", !settings.anim); }
  if (e.target.id === "swFx") { settings.effects = e.target.checked; saveUser(); fxKind = null; applyTheme(currentTheme()); }
});

/* ---------- theme editor ---------- */
let draft = null;
VIEWS_EXTRA.themeEdit = (id) => {
  const base = settings.customThemes.find(t => t.id === id);
  draft = base ? { ...base, blobs: [...(base.blobs || [])] } : { ...currentTheme(), id: "c" + uid(), name: "My theme", image: currentTheme().image || null, blobs: [...(currentTheme().blobs || [])], _new: true };
  delete draft.panelSolid; delete draft.border;
  if (!draft.text) draft.text = "";
  draft.gradient = draft.gradient ? "1" : ""; draft.accent2 ||= draft.accent;
  draft.coverShape ||= "rounded"; draft.sidebar ||= "normal"; draft.tileSize ||= "m"; draft.player ||= "floating"; draft.density ||= "comfortable";
  draft.hideNav = [...(draft.hideNav || [])];
  return `<div class="pad fade-in" style="max-width:980px">
    <h1 class="greet">${base ? "Edit theme" : "Create your theme"}</h1>
    <p class="muted" style="margin-top:-8px">Changes preview live across the whole app.</p>
    <div class="settings-sec editor" id="editor">
      <label class="full">Name<input class="input" data-k="name" value="${esc(draft.name)}" maxlength="40"></label>
      <h4 class="ed-h full">Colours</h4>
      <label>Style${seg("mode", [["dark", "Dark"], ["light", "Light"]])}</label>
      <label>Accent colour${colorField("accent")}<div class="swatches">${ACCENT_SWATCHES.map(c => `<button data-swatch="${c}" style="background:${c}" title="${c}"></button>`).join("")}</div></label>
      <label>Second accent (for gradients)${colorField("accent2")}</label>
      <label>Gradient buttons${seg("gradient", [["", "Off"], ["1", "On"]])}</label>
      <label>Text colour <span style="font-weight:500">(empty = automatic)</span>${colorField("text")}</label>
      <label>Secondary text <span style="font-weight:500">(empty = automatic)</span>${colorField("muted")}</label>
      <label>Title bar colour <span style="font-weight:500">(empty = automatic)</span>${colorField("titleBar")}</label>
      <label>Player bar colour <span style="font-weight:500">(empty = same as panels)</span>${colorField("playerBg")}</label>
      <h4 class="ed-h full">Background</h4>
      <label>Background top${colorField("bg1")}</label>
      <label>Background bottom${colorField("bg2")}</label>
      <label>Gradient angle <input type="range" data-k="angle" min="0" max="360" value="${draft.angle ?? 160}"></label>
      <label class="full">Background effect${seg("fx", [["none", "None"], ["petals", "Petals"], ["stars", "Stars"], ["blobs", "Glow"], ["snow", "Snow"], ["rain", "Rain"], ["fireflies", "Fireflies"], ["bubbles", "Bubbles"]])}</label>
      <label>Effect amount <input type="range" data-k="fxAmount" min="0" max="200" value="${draft.fxAmount ?? 100}"></label>
      <label>Glow colours<span class="color-row">${[0, 1, 2].map(i => `<input type="color" data-blob="${i}" value="${draft.blobs[i] || draft.accent}">`).join("")}</span></label>
      <label class="full">Background picture
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn ghost sm" id="pickImg">${draft.image ? "Change picture" : "Choose a picture…"}</button>${draft.image ? '<button class="btn ghost sm" id="clearImg">Remove picture</button>' : ""}<span class="muted" style="font-weight:500">JPG or PNG from your PC</span></div>
        <input type="file" id="imgFile" accept="image/*" hidden></label>
      <label>Picture blur <input type="range" data-k="imageBlur" min="0" max="24" value="${draft.imageBlur || 0}"></label>
      <label>Picture darkness <input type="range" data-k="imageDim" min="0" max="80" value="${draft.imageDim || 0}"></label>
      <h4 class="ed-h full">Panels & shapes</h4>
      <label>Panel colour${colorField("panel")}</label>
      <label>Panel see-through <input type="range" data-k="panelOpacity" min="0" max="100" value="${Math.round((1 - (draft.panelOpacity ?? .6)) * 100)}" data-invert></label>
      <label>Glass blur <input type="range" data-k="blur" min="0" max="40" value="${draft.blur ?? 18}"></label>
      <label>Rounded corners <input type="range" data-k="radius" min="0" max="30" value="${draft.radius ?? 18}"></label>
      <label>Cover shape${seg("coverShape", [["rounded", "Rounded"], ["square", "Square"], ["circle", "Circle"]])}</label>
      <h4 class="ed-h full">Text</h4>
      <label>Font<select class="input" data-k="font">${Object.entries(FONTS).map(([k, [l]]) => `<option value="${k}" ${(draft.font || "default") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Size <input type="range" data-k="fontScale" min="85" max="125" value="${draft.fontScale || 100}"></label>
      <h4 class="ed-h full">Layout</h4>
      <label>Sidebar${seg("sidebar", [["slim", "Slim"], ["normal", "Normal"], ["wide", "Wide"]])}</label>
      <label>Cover size${seg("tileSize", [["s", "Small"], ["m", "Medium"], ["l", "Large"]])}</label>
      <label>Player bar${seg("player", [["floating", "Floating"], ["docked", "Docked"]])}</label>
      <label>Song rows${seg("density", [["comfortable", "Comfortable"], ["compact", "Compact"]])}</label>
      <label class="full">Menu items<div class="nav-checks">${NAV_ITEMS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-shownav="${k}" ${(draft.hideNav || []).includes(k) ? "" : "checked"}><span>${l}</span></label>`).join("")}</div></label>
    </div>
    <div style="display:flex;gap:12px;justify-content:flex-end">
      <button class="btn ghost" id="edCancel">Cancel</button>
      <button class="btn accent" id="edSave">${base ? "Save changes" : "Save theme"}</button>
    </div>
  </div>`;
};
const OPTIONAL_COLORS = ["text", "muted", "titleBar", "playerBg"];
function colorField(k) {
  const v = draft[k] || "";
  return `<span class="color-row"><input type="color" data-c="${k}" value="${v || "#888888"}"><input class="input" type="text" data-ct="${k}" value="${esc(v)}" placeholder="${OPTIONAL_COLORS.includes(k) ? "auto" : ""}" maxlength="7"></span>`;
}
const seg = (k, opts) => `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join("")}</div>`;
function syncEditor() {
  const ed = $("#editor"); if (!ed || !draft) return;
  $$("[data-seg]", ed).forEach(s => $$("button", s).forEach(b => b.classList.toggle("on", b.dataset.v === draft[s.dataset.seg])));
}
function previewDraft() { const d = { ...draft }; if (!d.text) delete d.text; applyTheme(d); syncEditor(); }
$("#view").addEventListener("input", e => {
  if (!draft || !$("#editor")) return;
  const t = e.target;
  if (t.dataset.k) {
    let v = t.value;
    if (t.type === "range") v = +v;
    if (t.dataset.invert !== undefined) v = 1 - v / 100;
    draft[t.dataset.k] = v;
  } else if (t.dataset.c) {
    draft[t.dataset.c] = t.value; const tx = $(`[data-ct="${t.dataset.c}"]`); if (tx) tx.value = t.value;
  } else if (t.dataset.ct) {
    const v = t.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) { draft[t.dataset.ct] = v; $(`[data-c="${t.dataset.ct}"]`).value = v; }
    else if (!v && OPTIONAL_COLORS.includes(t.dataset.ct)) draft[t.dataset.ct] = "";
    else return;
  } else if (t.dataset.blob) { draft.blobs[+t.dataset.blob] = t.value; }
  else return;
  if (t.dataset.k !== "name") previewDraft();
});
$("#view").addEventListener("click", e => {
  if (!draft || !$("#editor")) return;
  const seg = e.target.closest("[data-seg] button");
  if (seg) {
    const k = seg.parentElement.dataset.seg; draft[k] = seg.dataset.v;
    if (k === "mode") { // sensible defaults when flipping light/dark
      if (seg.dataset.v === "light") { draft.bg1 = "#fbf7fb"; draft.bg2 = "#efe4ee"; draft.panel = "#ffffff"; draft.panelOpacity = .6; }
      else { draft.bg1 = "#140c24"; draft.bg2 = "#05030b"; draft.panel = "#1b1033"; draft.panelOpacity = .62; }
      draft.text = "";
      refillEditor();
    }
    previewDraft(); return;
  }
  const sw = e.target.closest("[data-swatch]");
  if (sw) { draft.accent = sw.dataset.swatch; $('[data-c="accent"]').value = draft.accent; $('[data-ct="accent"]').value = draft.accent; previewDraft(); return; }
  if (e.target.closest("#pickImg")) { $("#imgFile").click(); return; }
  if (e.target.closest("#clearImg")) { draft.image = null; e.target.closest("#clearImg").remove(); previewDraft(); return; }
  if (e.target.closest("#edCancel")) { draft = null; applyTheme(currentTheme()); history_back(); return; }
  if (e.target.closest("#edSave")) {
    const th = { ...draft }; delete th._new; if (!th.text) delete th.text;
    th.name = (th.name || "").trim() || "My theme";
    const i = settings.customThemes.findIndex(t => t.id === th.id);
    if (i >= 0) settings.customThemes[i] = th; else settings.customThemes.push(th);
    settings.themeId = th.id; draft = null; applyTheme(th); saveUser();
    toast(`Theme “${th.name}” saved`); go("themes", null, true);
  }
});
function refillEditor() {
  // re-render the editor with the current draft values
  const ed = $("#editor"); if (!ed) return;
  $$("[data-c]", ed).forEach(i => { const v = draft[i.dataset.c]; if (v) i.value = v; });
  $$("[data-ct]", ed).forEach(i => { i.value = draft[i.dataset.ct] || ""; });
  $('[data-k="panelOpacity"]', ed).value = Math.round((1 - draft.panelOpacity) * 100);
  $('[data-k="name"]', ed).value = draft.name;
  syncEditor();
}
$("#view").addEventListener("change", e => {
  const nv = e.target.closest?.("[data-shownav]");
  if (nv && draft) { const k = nv.dataset.shownav; draft.hideNav = draft.hideNav.filter(x => x !== k); if (!nv.checked) draft.hideNav.push(k); previewDraft(); return; }
  if (e.target.id !== "imgFile" || !draft) return;
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const max = 1920, k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    draft.image = c.toDataURL("image/jpeg", .82);
    URL.revokeObjectURL(img.src);
    previewDraft();
    const pb = $("#pickImg"); if (pb) pb.textContent = "Change picture";
    if (!$("#clearImg")) pb?.insertAdjacentHTML("afterend", '<button class="btn ghost sm" id="clearImg">Remove picture</button>');
    // pictures look best with see-through panels
    if (draft.panelOpacity > .7) { draft.panelOpacity = .55; $('[data-k="panelOpacity"]').value = 45; previewDraft(); }
  };
  img.src = URL.createObjectURL(f);
});
