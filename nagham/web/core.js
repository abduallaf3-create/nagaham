"use strict";
/* Nagham – shared helpers, state, artwork, colours, menus & dialogs */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = s => { if (!s || !isFinite(s)) return "–:––"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
const fmtLong = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h} hr ${m} min` : `${m} min ${s % 60} sec`; };
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const uid = () => Math.random().toString(36).slice(2, 10);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const IC = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a.5.5 0 0 0 .77.42l11.5-7.5a.5.5 0 0 0 0-.84L7.77 4.08A.5.5 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="2.4" height="14" rx="1"/><path d="M19.5 5.6v12.8a.6.6 0 0 1-.93.5L9.5 12.5a.6.6 0 0 1 0-1l9.07-6.4a.6.6 0 0 1 .93.5z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="16.6" y="5" width="2.4" height="14" rx="1"/><path d="M4.5 5.6v12.8a.6.6 0 0 0 .93.5l9.07-6.4a.6.6 0 0 0 0-1L5.43 5.1a.6.6 0 0 0-.93.5z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20s-7-4.4-9.2-8.6C1.2 8.2 3 4.5 6.6 4.5c2.1 0 3.4 1.2 5.4 3.3 2-2.1 3.3-3.3 5.4-3.3 3.6 0 5.4 3.7 3.8 6.9C19 15.6 12 20 12 20z"/></svg>',
  heartOn: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M12 20s-7-4.4-9.2-8.6C1.2 8.2 3 4.5 6.6 4.5c2.1 0 3.4 1.2 5.4 3.3 2-2.1 3.3-3.3 5.4-3.3 3.6 0 5.4 3.7 3.8 6.9C19 15.6 12 20 12 20z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h13M3 12h13M3 18h9M19 14v6M16 17h6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h12M12 6l6 6-6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  disc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h6l2 2h10v11H3z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-2 0-1.6-1.6-2 0-3.5 1-.9 2.6-.5 4-.5a3 3 0 0 0 3-3c0-5-4-9-9-9z"/></svg>',
  vol3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  vol1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  vol0: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 6 6M22 9l-6 6"/></svg>',
};

/* ------------------------------------------------------------ state */
const lib = {
  tracks: [], byId: {}, online: {}, playlists: [], liked: new Set(), folders: [],
  scanning: false, scanned: 0, canPick: false,
  albums: [], albumById: {}, artists: [], artistById: {}, trackAlbum: {}, trackArtist: {},
};
const settings = {
  volume: 0.8, muted: false, shuffle: false, repeat: "off", lastId: null, lastPos: 0, recent: [], sort: {},
  themeId: "midnight", customThemes: [], dynamic: false, effects: true, country: "sa", history: [],
};
const P = { ctx: [], ctxInfo: null, order: [], opos: -1, upNext: [], current: null, fromUpNext: false, wantPlay: false };
const audio = $("#audio");
const VIEWS_EXTRA = {}; // pages contributed by themes.js / online.js / spotify.js

/* playback engine: the <audio> element, or the Spotify Web Playback SDK (spotify.js) */
/* running inside the iPhone app? (it adds a "nagham" message handler) */
const IOS = !!window.webkit?.messageHandlers?.nagham;
const PHONE = () => IOS || matchMedia("(max-width: 700px)").matches;
if (IOS) document.body.classList.add("ios");
const EXT = { id: null, url: "", win: null, native: null, embedded: false, playing: false, st: null, stAt: 0 };
const YTM_PLAY = "(() => { window.__ngEnd = 0; const v = document.querySelector('video'); if (v) v.play(); })()";
const YTM_PAUSE = "(() => { const v = document.querySelector('video'); if (v) v.pause(); })()";
// every message to the hidden YouTube Music player goes through one queue, so "stop" and "play the next song"
// can never arrive in the wrong order (that made the title change while the old song kept playing)
let ytmQ = Promise.resolve();
let ytmNav = 0; // counts page loads: a request meant for an older page is dropped instead of waiting its turn
const ytmApi = body => {
  const isNav = body && body.url !== undefined, isCmd = body && body.cmd !== undefined && !isNav;
  const my = isNav ? ++ytmNav : ytmNav;
  return (ytmQ = ytmQ.then(() => {
    if ((isNav || isCmd) && my !== ytmNav) return; // a newer load replaced it (fast skipping)
    return Promise.race([api("/api/ytm", body), new Promise((_, rej) => setTimeout(() => rej(new Error("ytm timeout")), 4000))]);
  }).catch(e => { if (/timeout/.test(e?.message)) postLog("ytm request timed out"); }));
};
const ytmCmd = js => ytmApi({ cmd: js });
const extOn = () => E.mode === "external" && EXT.embedded;
function extTime() { const s = EXT.st; if (!s || s.ad || !s.ok) return EXT.seekTo || 0; return Math.min(s.t + (!s.p && EXT.playing ? (Date.now() - EXT.stAt) / 1000 : 0), s.d || 1e9); }
function extDur() { const s = EXT.st; return s && s.ok && !s.ad && s.d > 1 ? s.d : (T(P.current)?.fullDuration || T(P.current)?.duration || 0); }
function extSeek(sec) {
  sec = Math.max(0, +sec || 0);
  ytmCmd(`(() => { const v = document.querySelector('video'); if (v) v.currentTime = ${sec.toFixed(2)}; })()`);
  if (EXT.st) { EXT.st.t = sec; EXT.stAt = Date.now(); } else EXT.seekTo = sec;
  EXT.seekAt = Date.now();
  try { renderTime(); } catch {}
}
const E = {
  mode: "audio",
  get paused() { return this.mode === "external" ? !(EXT.embedded && EXT.playing) : this.mode === "spotify" ? SPP.paused : this.mode === "youtube" ? YTS.paused : audio.paused; },
  get time() { return this.mode === "external" ? (EXT.embedded ? extTime() : 0) : this.mode === "spotify" ? spPos() : this.mode === "youtube" ? ytTime() : audio.currentTime; },
  set time(v) { if (this.mode === "external") { if (EXT.embedded) extSeek(v); } else if (this.mode === "spotify") spSeek(v); else if (this.mode === "youtube") YTS.player?.seekTo(v, true); else if (typeof ypSeek === "function" && ypSeek(v)) {} else audio.currentTime = v; },
  get duration() { return this.mode === "external" ? extDur() : this.mode === "spotify" ? SPP.dur : this.mode === "youtube" ? ytDur() : audio.duration; },
  play() { if (extOn()) { EXT.playing = true; EXT.cmdAt = Date.now(); ytmCmd(YTM_PLAY); setTimeout(() => { renderPP(); markPlaying(); discordUpdate(true); }); return Promise.resolve(); }
    if (this.mode === "external") { const w = window.open(EXT.url, "nagham-ytmusic", ytmFeatures()); if (!w) api("/api/openurl", { url: EXT.url }); return Promise.resolve(); } return this.mode === "spotify" ? Promise.resolve(spResume()) : this.mode === "youtube" ? Promise.resolve(YTS.player?.playVideo()) : audio.play(); },
  pause() { if (this.mode === "external") { if (EXT.embedded) { EXT.playing = false; EXT.cmdAt = Date.now(); ytmCmd(YTM_PAUSE); setTimeout(() => { renderPP(); markPlaying(); discordUpdate(true); }); } return; } if (this.mode === "spotify") spPauseSdk(); else if (this.mode === "youtube") YTS.player?.pauseVideo(); else audio.pause(); },
};

/* ------------------------------------------------------------ problems are logged, never silent */
let errShown = 0;
function postLog(msg) { try { fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msg: String(msg).slice(0, 2000), ua: navigator.userAgent }) }).catch(() => {}); } catch {} }
addEventListener("error", e => { postLog(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`); if (Date.now() - errShown > 10000) { errShown = Date.now(); try { toast("Something went wrong — it was saved to the log. If buttons stop working, press Ctrl+R."); } catch {} } });
addEventListener("unhandledrejection", e => postLog("promise: " + (e.reason?.stack || e.reason)));

/* ------------------------------------------------------------ api */
async function api(path, body, method) {
  const r = await fetch(path, body === undefined ? {} : { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
  return r.json();
}
let saveTimer;
function saveUser() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // keep metadata only for online songs that are referenced somewhere
    const keep = {};
    const ref = id => { if (lib.online[id]) keep[id] = lib.online[id]; };
    lib.liked.forEach(ref);
    lib.playlists.forEach(p => p.tracks.forEach(ref));
    (settings.history || []).forEach(ref);
    (settings.privateIds || []).forEach(ref);
    if (settings.lastId) ref(settings.lastId);
    api("/api/userdata", { playlists: lib.playlists, liked: [...lib.liked], settings, online: keep }, "PUT").catch(e => console.warn(e));
  }, 400);
}

async function loadState(first) {
  const s = await api("/api/state");
  lib.allTracks = s.tracks || [];
  lib.tracks = lib.allTracks;
  lib.byId = Object.fromEntries(lib.allTracks.map(t => [t.id, t]));
  lib.folders = s.folders || [];
  lib.scanning = s.scanning; lib.scanned = s.scanned; lib.canPick = s.canPick;
  if (first) {
    lib.playlists = s.playlists || [];
    lib.liked = new Set(s.liked || []);
    Object.assign(lib.online, s.online || {});
    if (s.settings) Object.assign(settings, s.settings);
  }
  privRefresh();
  buildIndexes();
}

function buildIndexes() {
  const albums = new Map(), artists = new Map();
  for (const t of lib.tracks) {
    const dir = t.path.replace(/[\\/][^\\/]*$/, "");
    const ak = (t.album || "").toLowerCase() + "|" + dir.toLowerCase();
    let a = albums.get(ak);
    if (!a) albums.set(ak, a = { id: "al" + hash(ak).toString(36), name: t.album || "Unknown album", artists: new Set(), tracks: [], added: 0, cover: null });
    a.tracks.push(t.id); a.artists.add(t.artist); a.added = Math.max(a.added, t.added);
    if (!a.cover && t.hasCover) a.cover = t.id;
    const rk = (t.artist || "").toLowerCase();
    let r = artists.get(rk);
    if (!r) artists.set(rk, r = { id: "ar" + hash(rk).toString(36), name: t.artist, tracks: [], cover: null });
    r.tracks.push(t.id);
    if (!r.cover && t.hasCover) r.cover = t.id;
  }
  lib.albums = [...albums.values()].map(a => ({ ...a, artist: a.artists.size > 1 ? "Various artists" : [...a.artists][0] }));
  lib.albums.forEach(a => a.tracks.sort((x, y) => (lib.byId[x].trackNo || 999) - (lib.byId[y].trackNo || 999) || lib.byId[x].title.localeCompare(lib.byId[y].title)));
  lib.albums.sort((a, b) => a.name.localeCompare(b.name));
  lib.albumById = Object.fromEntries(lib.albums.map(a => [a.id, a]));
  lib.trackAlbum = {};
  lib.albums.forEach(a => a.tracks.forEach(id => lib.trackAlbum[id] = a.id));
  lib.artists = [...artists.values()].sort((a, b) => a.name.localeCompare(b.name));
  lib.artistById = Object.fromEntries(lib.artists.map(a => [a.id, a]));
  lib.trackArtist = {};
  lib.artists.forEach(a => a.tracks.forEach(id => lib.trackArtist[id] = a.id));
}

/* ------------------------------------------------------------ tracks (local + online) */
/* private songs: stay in your own library, but friends never see them */
const PRIV = { ids: new Set(), unlocked: false, show: false, keep: new Set() };
const isPrivate = id => PRIV.ids.has(id);
function privRefresh() { PRIV.ids = new Set(settings.privateIds || []); }
function privLock() { PRIV.unlocked = false; PRIV.show = false; }
const T = id => lib.byId[id] || lib.online[id];
const isOnline = id => !!id && id.includes(":");
function registerOnline(list) { (list || []).forEach(t => { if (t && t.id) lib.online[t.id] = Object.assign(lib.online[t.id] || {}, t); }); return (list || []).map(t => t.id); }
function proxImg(u) { return u ? "/img?u=" + encodeURIComponent(u) : null; }
function coverOf(id, small) {
  const t = T(id); if (!t) return null;
  if (t.online) return proxImg(small ? (t.coverSmall || t.cover) : (t.cover || t.coverSmall));
  return t.hasCover ? "/cover/" + id : null;
}
function audioURL(id) { const t = T(id); if (!t) return ""; if (t.online) { const [s, r] = id.split(/:(.*)/s); return `/stream/${s}/${encodeURIComponent(r)}?country=${settings.country}`; } return "/audio/" + id; }
function badge(t) {
  return ""; // songs are just songs – no source labels
  if (!t || !t.online) return "";
  if (t.spotify) return spCanStream() ? '<span class="badge sp" title="Full song on Spotify">Spotify</span>' : '<span class="badge pv" title="30-second preview (full playback needs Spotify Premium)">Preview</span>';
  return t.full ? '<span class="badge full" title="Full song (Audius)">Full</span>' : '<span class="badge pv" title="30-second preview">Preview</span>';
}
function albumKeyOf(id) { const t = T(id); return t?.online ? (t.albumId || t.album) : lib.trackAlbum[id]; }

/* ------------------------------------------------------------ artwork */
function phColors(key) {
  const h = hash(key) % 360;
  return [`hsl(${h} 55% 45%)`, `hsl(${(h + 50) % 360} 60% 25%)`];
}
function phHTML(key, icon) {
  const [a, b] = phColors(key || "x");
  return `<div class="art-ph" style="background:linear-gradient(135deg,${a},${b})">${icon || IC.note}</div>`;
}
function imgHTML(src, key, icon) {
  const ph = phHTML(key, icon);
  if (!src) return ph;
  return `<img src="${esc(src)}" loading="lazy" alt="" draggable="false" onerror="this.outerHTML=this.dataset.ph" data-ph="${esc(ph)}">`;
}
function trackArt(id, small) { return imgHTML(coverOf(id, small), albumKeyOf(id) || id); }
function likedArt() {
  return `<div class="art-ph" style="background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 35%,#ffd6e8))"><svg viewBox="0 0 24 24" fill="#fff" style="opacity:1;width:42%;height:42%"><path d="M12 20s-7-4.4-9.2-8.6C1.2 8.2 3 4.5 6.6 4.5c2.1 0 3.4 1.2 5.4 3.3 2-2.1 3.3-3.3 5.4-3.3 3.6 0 5.4 3.7 3.8 6.9C19 15.6 12 20 12 20z"/></svg></div>`;
}
function playlistArt(pl) {
  const covers = [], seen = new Set();
  for (const id of pl.tracks) {
    const c = coverOf(id, true); if (!c) continue;
    const k = albumKeyOf(id); if (seen.has(k)) continue;
    seen.add(k); covers.push(c);
    if (covers.length === 4) break;
  }
  if (covers.length === 4) return `<div style="display:grid;grid-template-columns:1fr 1fr;width:100%;height:100%">${covers.map(c => `<img src="${esc(c)}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`).join("")}</div>`;
  return imgHTML(covers[0], pl.id);
}

/* ------------------------------------------------------------ colours */
function hexToRgb(h) { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex([r, g, b]) { return "#" + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join(""); }
function rgbToHsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; }
function hslToRgb([h, s, l]) { h /= 360; const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }; return [f(0), f(8), f(4)]; }
function luminance([r, g, b]) { const c = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * c(r) + .7152 * c(g) + .0722 * c(b); }
function mixHex(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t)); }
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/* extract a small palette from an image URL (same-origin only) */
const paletteCache = {};
function palette(src) {
  if (!src) return Promise.resolve(null);
  if (paletteCache[src]) return Promise.resolve(paletteCache[src]);
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      try {
        const S = 28, c = document.createElement("canvas"); c.width = c.height = S;
        const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, S, S);
        const d = x.getImageData(0, 0, S, S).data;
        const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        let ar = 0, ag = 0, ab = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const rgb = [d[i], d[i + 1], d[i + 2]];
          const [h, s, l] = rgbToHsl(rgb);
          ar += rgb[0]; ag += rgb[1]; ab += rgb[2]; n++;
          if (l < .12 || l > .92) continue;
          const w = s * s * (1 - Math.abs(l - .5));
          const bk = buckets[Math.floor(h / 30) % 12];
          bk.w += w; bk.r += rgb[0] * w; bk.g += rgb[1] * w; bk.b += rgb[2] * w;
        }
        const ranked = buckets.filter(b => b.w > 0).sort((a, b) => b.w - a.w).map(b => [b.r / b.w, b.g / b.w, b.b / b.w]);
        const avg = [ar / n, ag / n, ab / n];
        const p = { avg: rgbToHex(avg), main: rgbToHex(ranked[0] || avg), second: rgbToHex(ranked[1] || ranked[0] || avg), third: rgbToHex(ranked[2] || ranked[1] || avg), vibrant: ranked.length > 0 };
        res(paletteCache[src] = p);
      } catch { res(null); }
    };
    img.onerror = () => res(null);
    img.src = src;
  });
}
/* adjust a colour so it works as an accent on a dark or light background */
function accentFor(hex, mode) {
  let [h, s, l] = rgbToHsl(hexToRgb(hex));
  s = Math.max(s, .55);
  l = mode === "light" ? clamp(l, .38, .5) : clamp(l, .58, .72);
  return rgbToHex(hslToRgb([h, s, l]));
}
function heroColor(hex, mode) {
  let [h, s, l] = rgbToHsl(hexToRgb(hex));
  l = mode === "light" ? clamp(l, .7, .85) : clamp(l, .25, .42);
  return rgbToHex(hslToRgb([h, Math.min(s, .7), l]));
}

/* ------------------------------------------------------------ toast, menus, dialogs */
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

let menuEl = null, menuAt = 0;
function closeMenu() { menuEl?.remove(); menuEl = null; }
function menu(x, y, items) {
  closeMenu();
  const m = document.createElement("div"); m.className = "menu";
  m.innerHTML = items.map((it, i) => it === "-" ? "<hr>" : `<button class="mi" data-mi="${i}">${it.icon || '<svg width="16" height="16"></svg>'}<span class="grow">${esc(it.label)}</span>${it.sub ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l6 6-6 6z"/></svg>' : ""}</button>`).join("");
  if (items.length > 12) m.classList.add("sub");
  document.body.appendChild(m); menuEl = m; menuAt = Date.now();
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  m.addEventListener("click", e => {
    const b = e.target.closest("[data-mi]"); if (!b) return;
    const it = items[+b.dataset.mi];
    e.stopPropagation();
    if (it.sub) { const rr = b.getBoundingClientRect(); menu(rr.right - 4, rr.top, it.sub()); return; }
    closeMenu(); it.act();
  });
}
addEventListener("mousedown", e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
addEventListener("blur", closeMenu);

function modal(html, onOk, opts = {}) {
  return new Promise(res => {
    const bg = document.createElement("div"); bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal" style="${opts.wide ? "width:620px" : ""}">${html}</div>`;
    document.body.appendChild(bg);
    const onEsc = e => { if (e.key === "Escape" && [...document.querySelectorAll(".modal-bg")].pop() === bg) done(null); };
    const done = v => { removeEventListener("keydown", onEsc); bg.remove(); res(v); };
    addEventListener("keydown", onEsc);
    bg.addEventListener("mousedown", e => { if (e.target === bg) done(null); });
    $$(".cancel", bg).forEach(b => b.onclick = () => done(null));
    const ok = $(".ok", bg); if (ok) ok.onclick = () => done(onOk ? onOk(bg) : true);
    bg.addEventListener("keydown", e => {
      if (e.key === "Escape") done(null);
      if (e.key === "Enter" && !e.target.matches("textarea,button") && ok) done(onOk ? onOk(bg) : true);
      e.stopPropagation();
    });
    opts.onOpen?.(bg, done);
    setTimeout(() => { const i = $("input,textarea", bg); if (i) { i.focus(); i.select?.(); } else (ok || $("button", bg))?.focus(); });
  });
}
function prompt_(title, value, okLabel) {
  return modal(`<h3>${esc(title)}</h3><p></p><input class="input" style="width:100%" maxlength="100" value="${esc(value)}"><div class="row-gap"><button class="btn ghost cancel">Cancel</button><button class="btn accent ok">${okLabel}</button></div>`, bg => $("input", bg).value);
}
function confirm_(title, text, okLabel) {
  return modal(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="row-gap"><button class="btn ghost cancel">Cancel</button><button class="btn accent ok">${okLabel}</button></div>`, () => true).then(v => !!v);
}
async function copyText(t, msg) {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  toast(msg || "Copied");
}

/* freezes of the interface are written to the log, so a "hang" can be traced afterwards */
try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.duration > 400) postLog(`UI freeze ${Math.round(e.duration)}ms`); }).observe({ entryTypes: ["longtask"] }); } catch {}
