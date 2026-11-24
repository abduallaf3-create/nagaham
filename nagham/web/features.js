"use strict";
/* Nagham – lyrics, radio, sleep timer, crossfade, equalizer, Wrapped, mini player & remote control */

/* ============================================================ lyrics */
const LYR = { id: null, lines: [], plain: "", state: "idle", on: false, idx: -1, userScroll: 0 };
function parseLRC(txt) {
  const out = [];
  for (const raw of (txt || "").split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of tags) out.push({ t: +m[1] * 60 + +m[2], text });
  }
  return out.sort((a, b) => a.t - b.t);
}
const LYR_CACHE = new Map(), LYR_WAIT = new Map();
function lyrFetch(id) {
  const t = T(id); if (!t) return Promise.resolve({ state: "none" });
  if (LYR_CACHE.has(id)) return Promise.resolve(LYR_CACHE.get(id));
  if (LYR_WAIT.has(id)) return LYR_WAIT.get(id);
  const dur = Math.round(t.fullDuration || t.duration || 0);
  const p = Promise.race([
    api(`/api/lyrics?title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist || "")}&album=${encodeURIComponent(t.album || "")}&dur=${dur}`),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
  ]).then(r => {
    const o = r.instrumental ? { state: "instrumental" }
      : r.synced ? (() => { const lines = parseLRC(r.synced); return lines.length ? { state: "synced", lines } : { state: "none" }; })()
      : r.plain ? { state: "plain", plain: r.plain } : { state: "none" };
    LYR_CACHE.set(id, o); if (LYR_CACHE.size > 80) LYR_CACHE.delete(LYR_CACHE.keys().next().value);
    return o;
  }).catch(() => ({ state: "error" })).finally(() => LYR_WAIT.delete(id));
  LYR_WAIT.set(id, p);
  return p;
}
async function loadLyrics(id, force) {
  const t = T(id); if (!t) return;
  if (!force && LYR.id === id && LYR.state !== "error") return; // already loading / loaded
  LYR.id = id; LYR.lines = []; LYR.plain = ""; LYR.idx = -1;
  const hit = LYR_CACHE.get(id);
  LYR.state = hit ? hit.state : "loading";
  if (hit) { LYR.lines = hit.lines || []; LYR.plain = hit.plain || ""; }
  renderLyrics();
  if (!hit) {
    const o = await lyrFetch(id);
    if (LYR.id !== id) return;
    LYR.state = o.state; LYR.lines = o.lines || []; LYR.plain = o.plain || "";
    renderLyrics();
  }
  // warm up the next song's lyrics while this one plays
  setTimeout(() => {
    const nx = P.upNext?.[0] || (P.opos + 1 < P.order.length ? P.ctx[P.order[P.opos + 1]] : null);
    if (nx && T(nx) && P.current === id) lyrFetch(nx);
  }, 2500);
}
const lyrOffTxt = () => { const o = settings.lyrOffset || 0; return "sync " + (o > 0 ? "+" : "") + o.toFixed(1) + "s"; };
function renderLyrics() {
  const box = $("#fLyrics"); if (!box) return;
  const t = T(P.current);
  const head = t ? `<div class="lyr-head"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>` : "";
  const note = msg => `${head}<div class="lyr-note">${msg}</div>`;
  if (LYR.state === "loading") box.innerHTML = `${head}<div class="lyr-skel"><div class="lyr-say"><div class="spin" style="width:18px;height:18px"></div>Finding the lyrics…</div><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
  else if (LYR.state === "instrumental") box.innerHTML = note("♪ This one's instrumental — no words, just vibes");
  else if (LYR.state === "none") box.innerHTML = note("No lyrics found for this song");
  else if (LYR.state === "error") box.innerHTML = note(`Couldn't get the lyrics — check your connection <button class="btn ghost sm" data-lyrretry style="margin-top:14px">Try again</button>`);
  else if (LYR.state === "plain") box.innerHTML = `${head}<div class="lyr-plain">${esc(LYR.plain).replace(/\n/g, "<br>")}</div>`;
  else if (LYR.state === "synced") box.innerHTML = `<div class="lyr-lines"><div class="lyr-pad"></div>${LYR.lines.map((l, i) => `<p data-li="${i}" data-t="${l.t}">${l.text ? esc(l.text) : '<span class="lyr-dots">• • •</span>'}</p>`).join("")}<div class="lyr-pad"></div></div><div class="lyr-sync" title="Lyrics too early or too late? Nudge them"><button data-lsync="-1">−</button><span>${lyrOffTxt()}</span><button data-lsync="1">+</button></div>`;
  else box.innerHTML = "";
  LYR.idx = -1;
}
const lyrOff = () => .3 + (settings.lyrOffset || 0);
function lyrTick() {
  if (!LYR.on || LYR.state !== "synced" || !$("#full").classList.contains("open")) return;
  const now = (E.time || 0) + lyrOff();
  let i = -1;
  for (let k = 0; k < LYR.lines.length; k++) { if (LYR.lines[k].t <= now) i = k; else break; }
  if (i === LYR.idx) return;
  LYR.idx = i;
  const box = $("#fLyrics");
  $$(".lyr-lines p", box).forEach((p, k) => { p.classList.toggle("on", k === i); p.classList.toggle("past", k < i); if (k !== i) { p.style.removeProperty("--ld"); p.style.animationDelay = ""; } });
  const cur = $(`.lyr-lines p[data-li="${i}"]`, box);
  if (cur && Date.now() - LYR.userScroll > 3500) {
    const sc = $(".lyr-lines", box);
    sc.scrollTo({ top: cur.offsetTop - sc.clientHeight / 2 + cur.offsetHeight / 2, behavior: "smooth" });
  }
}
setInterval(lyrTick, 200);
function setLyrics(on) {
  LYR.on = on;
  $("#full").classList.toggle("lyr", on);
  for (const b of [$("#fLyr"), $("#lyrBtn")]) b?.classList.toggle("on", on);
  settings.lyricsOn = on; saveUser();
  if (on && P.current && LYR.id !== P.current) loadLyrics(P.current);
  if (on && $("#ytmini").classList.contains("in-full")) { showYtMini(false); renderPP(); }
  LYR.idx = -1; lyrTick();
}
$("#fLyr").onclick = () => setLyrics(!LYR.on);
$("#lyrBtn").onclick = () => {
  if (!P.current) return toast("Play something first");
  if (!$("#full").classList.contains("open")) { toggleFull(true); setLyrics(true); } else setLyrics(!LYR.on);
};
$("#fLyrics").addEventListener("click", e => {
  const sb = e.target.closest("[data-lsync]");
  if (sb) { // lyrics show too early (−) or too late (+)
    settings.lyrOffset = Math.max(-3, Math.min(3, Math.round(((settings.lyrOffset || 0) + (+sb.dataset.lsync) * .1) * 10) / 10)); saveUser();
    const sp = $(".lyr-sync span", e.currentTarget); if (sp) sp.textContent = lyrOffTxt();
    LYR.idx = -1; lyrTick(); return;
  }
  if (e.target.closest("[data-lyrretry]")) return loadLyrics(P.current, true);
  const p = e.target.closest(".lyr-lines p[data-t]"); if (p) { E.time = +p.dataset.t; LYR.userScroll = 0; }
});
$("#fLyrics").addEventListener("wheel", () => { LYR.userScroll = Date.now(); }, { passive: true });
$("#fLyrics").addEventListener("touchmove", () => { LYR.userScroll = Date.now(); }, { passive: true });
addEventListener("keydown", e => {
  if (e.key.toLowerCase() === "l" && kbdOn("letters") && !e.ctrlKey && !e.metaKey && !e.altKey && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) $("#lyrBtn").click();
});

/* ============================================================ radio: similar songs when the queue runs out */
let radioBusy = false;
function startRadio() {
  if (settings.radio !== true || radioBusy) return false; // only when you turned it on
  const t = T(P.current); if (!t || !t.artist) return false;
  radioBusy = true;
  toast(`Radio: finding songs like “${t.title}”…`);
  const seed = t, seen = new Set([...(P.ctx || []).slice(-60), ...(settings.history || []).slice(0, 30)]);
  api(`/api/online/radio?artist=${encodeURIComponent(seed.artist)}&title=${encodeURIComponent(seed.title)}`)
    .then(r => {
      const list = (r.tracks || []).filter(x => !seen.has(x.id) && x.title !== seed.title).slice(0, 30);
      if (!list.length) throw new Error("nothing found");
      const ids = registerOnline(list);
      playContext(ids, 0, { type: "radio", id: seed.artist, name: `Radio · ${seed.artist.split(",")[0]}` });
      toast(`Radio is on — similar songs to ${seed.artist.split(",")[0]}`);
    })
    .catch(() => { toast("That's the end of the list"); E.pause(); markPlaying(); renderPP(); })
    .finally(() => { radioBusy = false; });
  return true;
}

/* ============================================================ sleep timer */
const SLEEP = { until: 0, eos: false };
function sleepAtSongEnd() {
  if (!SLEEP.eos) return false;
  SLEEP.eos = false; renderSleep();
  E.pause(); markPlaying(); renderPP();
  toast("Sleep timer: goodnight");
  return true;
}
function setSleep(min) {
  SLEEP.eos = min === "eos"; SLEEP.until = typeof min === "number" && min > 0 ? Date.now() + min * 60e3 : 0;
  if (VOLMUL !== 1 && !CF.fading) { VOLMUL = 1; applyEngineVolume(); }
  renderSleep();
  toast(SLEEP.eos ? "Music stops when this song ends" : SLEEP.until ? `Music stops in ${min} minutes` : "Sleep timer off");
}
function renderSleep() {
  const on = SLEEP.eos || SLEEP.until > 0;
  let label = "";
  if (SLEEP.until) { const m = Math.ceil((SLEEP.until - Date.now()) / 60e3); label = m + "m"; }
  else if (SLEEP.eos) label = "1♪";
  for (const b of [$("#sleepBtn"), $("#fSleep")]) {
    if (!b) continue;
    b.classList.toggle("on", on);
    b.title = on ? (SLEEP.eos ? "Sleep timer: stops after this song" : `Sleep timer: ${label} left`) : "Sleep timer";
    const i = $(".sleep-left", b); if (i) i.textContent = label;
  }
}
function sleepMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const opt = (label, v) => ({ label: label, icon: IC.clock || "", act: () => setSleep(v) });
  menu(r.left - 120, r.top - 300, [
    ...(SLEEP.eos || SLEEP.until ? [{ label: "Turn off", act: () => setSleep(0) }, "-"] : []),
    opt("15 minutes", 15), opt("30 minutes", 30), opt("45 minutes", 45), opt("1 hour", 60), opt("1 hour 30 minutes", 90),
    opt("End of this song", "eos"),
  ]);
}
$("#sleepBtn").onclick = sleepMenu; $("#fSleep").onclick = sleepMenu;
setInterval(() => {
  if (!SLEEP.until) return;
  const left = SLEEP.until - Date.now();
  if (left <= 0) {
    SLEEP.until = 0; E.pause(); markPlaying(); renderPP();
    setTimeout(() => { VOLMUL = 1; applyEngineVolume(); }, 600);
    renderSleep(); toast("Sleep timer: goodnight");
  } else if (left <= 12000) { VOLMUL = Math.max(0, left / 12000); applyEngineVolume(); }
  if (Math.round(left / 1000) % 30 === 0) renderSleep();
}, 1000);

/* ============================================================ crossfade (your songs + free full songs) */
const CF = { forId: null, fading: false };
const tail = new Audio(); tail.preload = "auto";
function hasNextReady() {
  if (settings.repeat === "one") return false;
  return P.upNext.length > 0 || P.opos + 1 < P.order.length || (settings.repeat === "all" && P.order.length > 1);
}
function fadeTo(target, secs, onDone) {
  clearInterval(CF.fadeT);
  const start = VOLMUL, steps = Math.max(1, Math.round(secs * (E.mode === "audio" ? 10 : 2))), every = secs * 1000 / steps;
  let k = 0; CF.fading = true;
  CF.fadeT = setInterval(() => {
    k++; VOLMUL = start + (target - start) * Math.min(1, k / steps); applyEngineVolume();
    if (k >= steps) { clearInterval(CF.fadeT); CF.fading = false; onDone?.(); }
  }, every);
}
audio.addEventListener("timeupdate", () => {
  const cf = +settings.crossfade || 0;
  if (!cf || E.mode !== "audio" || (typeof vocActive === "function" && vocActive()) || CF.forId === P.current || !P.current || SLEEP.until || SLEEP.eos) return;
  const d = audio.duration, left = d - audio.currentTime;
  if (!isFinite(d) || d < cf * 3 || left > cf || left < .5 || audio.paused || !hasNextReady()) return;
  CF.forId = P.current;
  // the end of this song keeps playing on a second player while it fades out…
  tail.src = audio.currentSrc; tail.currentTime = audio.currentTime; tail.volume = audio.volume;
  tail.play().catch(() => {});
  const v0 = audio.volume, t0 = Date.now(), ms = left * 1000;
  clearInterval(CF.tailT);
  CF.tailT = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / ms);
    tail.volume = Math.max(0, v0 * (1 - p));
    if (p >= 1) { clearInterval(CF.tailT); tail.pause(); tail.removeAttribute("src"); tail.load(); }
  }, 80);
  // …while the next one fades in
  VOLMUL = 0; applyEngineVolume();
  next(true);
  setTimeout(() => fadeTo(1, cf), 150);
});

/* ============================================================ equalizer (Web Audio) */
const EQ_FREQS = [60, 230, 910, 3600, 14000];
const EQ_PRESETS = {
  flat: ["Flat", [0, 0, 0, 0, 0]], bass: ["Bass boost", [7, 4, 0, 0, 0]], vocal: ["Vocal", [-2, -1, 3, 4, 2]],
  treble: ["Treble", [0, 0, 0, 3, 6]], pop: ["Pop", [-1, 2, 4, 2, -1]], rock: ["Rock", [4, 2, -1, 2, 4]],
  chill: ["Chill", [2, 1, 0, -2, -3]], loud: ["Loud", [5, 3, 0, 3, 5]],
};
let eqCtx = null, eqNodes = [];
function eqGains() { return settings.eq?.gains || EQ_PRESETS[settings.eq?.preset || "flat"]?.[1] || [0, 0, 0, 0, 0]; }
function eqInit() {
  if (eqCtx) return true;
  try {
    eqCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = eqCtx.createMediaElementSource(audio);
    eqNodes = EQ_FREQS.map((f, i) => {
      const n = eqCtx.createBiquadFilter();
      n.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
      n.frequency.value = f; n.Q.value = 1.0; n.gain.value = 0;
      return n;
    });
    let node = typeof vocBuild === "function" ? vocBuild(eqCtx, src) : src; // vocal control sits first in the chain
    for (const n of eqNodes) { node.connect(n); node = n; }
    node.connect(eqCtx.destination);
    window.eqTail = node; // the Karaoke recorder taps the finished sound here
    return true;
  } catch (e) { postLog("equalizer: " + e); eqCtx = null; return false; }
}
function eqApply() {
  const g = eqGains();
  if (typeof fxEngineCheck === "function") { fxEngineCheck(); ytmFxSend(); } // songs in the YouTube Music player get the same equalizer inside that page
  if (E.mode !== "audio" && !eqCtx) return;
  if (!eqCtx && g.every(x => !x) && !(typeof vocWanted === "function" && vocWanted())) return; // nothing to do until it's used
  if (!eqInit()) return;
  eqNodes.forEach((n, i) => n.gain.setTargetAtTime(g[i] || 0, eqCtx.currentTime, .05));
  if (eqCtx.state !== "running") eqCtx.resume().catch(() => {});
}
audio.addEventListener("play", () => { if (eqCtx && eqCtx.state !== "running") eqCtx.resume().catch(() => {}); });

/* ============================================================ listening stats + Wrapped */
const PLAY = { id: null, gen: -1, ms: 0, counted: false };
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
let statsDirty = 0;
setInterval(() => {
  if (E.paused || !P.current) return;
  const t = T(P.current); if (!t) return;
  if (PLAY.id !== P.current || PLAY.gen !== P.gen) Object.assign(PLAY, { id: P.current, gen: P.gen, ms: 0, counted: false });
  PLAY.ms += 1000;
  const st = settings.stats || (settings.stats = {});
  const m = st[monthKey()] || (st[monthKey()] = { ms: 0, songs: {}, artists: {}, hours: Array(24).fill(0) });
  m.ms += 1000; m.hours[new Date().getHours()] += 1000;
  const s = m.songs[t.id] || (m.songs[t.id] = { n: 0, ms: 0 });
  Object.assign(s, { title: t.title, artist: t.artist, cover: coverOf(t.id, true) || "" }); s.ms += 1000;
  const artist = (t.artist || "Unknown").split(",")[0].trim();
  const a = m.artists[artist] || (m.artists[artist] = { n: 0, ms: 0 });
  a.ms += 1000;
  if (!PLAY.counted && PLAY.ms >= 30000) { PLAY.counted = true; s.n++; a.n++; }
  if (++statsDirty >= 30) { statsDirty = 0; pruneStats(); saveUser(); }
}, 1000);
function pruneStats() {
  for (const m of Object.values(settings.stats || {})) {
    const ids = Object.keys(m.songs);
    if (ids.length > 300) ids.sort((x, y) => m.songs[y].ms - m.songs[x].ms).slice(300).forEach(id => delete m.songs[id]);
    const ar = Object.keys(m.artists);
    if (ar.length > 200) ar.sort((x, y) => m.artists[y].ms - m.artists[x].ms).slice(200).forEach(k => delete m.artists[k]);
  }
}
function wrapData(key) {
  const st = settings.stats || {};
  const months = key === "year" ? Object.keys(st).filter(k => k.startsWith(String(new Date().getFullYear()))) : [key];
  const out = { ms: 0, songs: {}, artists: {}, hours: Array(24).fill(0) };
  for (const k of months) {
    const m = st[k]; if (!m) continue;
    out.ms += m.ms; (m.hours || []).forEach((v, i) => out.hours[i] += v);
    for (const [id, s] of Object.entries(m.songs)) { const o = out.songs[id] || (out.songs[id] = { ...s, n: 0, ms: 0 }); o.n += s.n; o.ms += s.ms; }
    for (const [n, a] of Object.entries(m.artists)) { const o = out.artists[n] || (out.artists[n] = { n: 0, ms: 0 }); o.n += a.n; o.ms += a.ms; }
  }
  const songs = Object.entries(out.songs).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.n - a.n || b.ms - a.ms);
  const artists = Object.entries(out.artists).map(([name, a]) => ({ name, ...a })).sort((a, b) => b.ms - a.ms);
  const peak = out.hours.indexOf(Math.max(...out.hours));
  return { ms: out.ms, songs, artists, peak, plays: songs.reduce((x, s) => x + s.n, 0) };
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = k => k === "year" ? "This year" : `${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}`;
const hourName = h => h === 0 ? "midnight" : h < 12 ? `${h} AM` : h === 12 ? "noon" : `${h - 12} PM`;
const vibeOf = h => h < 5 ? "Night owl" : h < 11 ? "Early riser" : h < 17 ? "Daytime groover" : h < 21 ? "Sunset listener" : "Night owl";
VIEWS_EXTRA.wrapped = (key) => {
  const st = settings.stats || {};
  const keys = Object.keys(st).sort().reverse();
  key = key === "year" || st[key] ? key : (keys[0] || monthKey());
  const d = wrapData(key);
  const mins = Math.round(d.ms / 60000);
  const chips = [...keys.slice(0, 6).map(k => [k, monthName(k)]), ["year", "This year"]];
  let h = `<div class="pad fade-in wrapped"><div class="chips">${chips.map(([k, l]) => `<button class="chip ${k === key ? "on" : ""}" data-go="wrapped:${k}">${esc(l)}</button>`).join("")}</div>`;
  if (!d.ms) return h + `<div class="wr-empty"><div class="wr-big">✨</div><h2>Your Wrapped starts now</h2><p class="muted">Listen to some music — Nagham keeps count of your favourite songs and artists right here.</p></div></div>`;
  const top = d.songs[0], art = d.artists[0];
  const cover = (s, cls = "") => `<div class="wr-cover ${cls}">${s?.cover ? `<img src="${esc(s.cover)}" alt="" onerror="this.remove()">` : ""}</div>`;
  h += `<div class="wr-hero stagger" style="--i:0">
      <div class="wr-kicker">Your ${esc(monthName(key))} Wrapped</div>
      <div class="wr-mins"><b data-count="${mins}">0</b><span>minutes listened</span></div>
      <div class="wr-facts"><span><b>${d.plays}</b> plays</span><span><b>${d.songs.length}</b> different songs</span><span><b>${d.artists.length}</b> artists</span></div>
      <div class="wr-actions"><button class="btn accent" data-wrshare="${esc(key)}">${IC.share} Share as image</button><button class="btn ghost" data-wrplay="${esc(key)}">${IC.play} Play your top songs</button></div>
    </div>
    <div class="wr-grid">
      <div class="wr-card stagger" style="--i:1"><div class="wr-label">Your top song</div>${cover(top, "big")}<h3>${esc(top.title)}</h3><p class="muted">${esc(top.artist)} · ${plural(top.n, "play")}</p></div>
      <div class="wr-card stagger" style="--i:2"><div class="wr-label">Your top artist</div><div class="wr-artist">${esc((art.name || "?").slice(0, 1).toUpperCase())}</div><h3>${esc(art.name)}</h3><p class="muted">${Math.round(art.ms / 60000)} minutes together</p></div>
      <div class="wr-card stagger" style="--i:3"><div class="wr-label">Your listening vibe</div><div class="wr-vibe">${d.peak < 6 || d.peak >= 21 ? "🌙" : d.peak < 12 ? "🌅" : d.peak < 17 ? "☀️" : "🌆"}</div><h3>${vibeOf(d.peak)}</h3><p class="muted">You listen most around ${hourName(d.peak)}</p></div>
    </div>
    <div class="wr-lists">
      <div class="wr-list stagger" style="--i:4"><h3>Top songs</h3>${d.songs.slice(0, 5).map((s, i) => `<div class="wr-row" data-wrsong="${esc(s.id)}"><span class="wr-n">${i + 1}</span>${cover(s)}<div class="meta"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div><span class="muted">${plural(s.n, "play")}</span></div>`).join("")}</div>
      <div class="wr-list stagger" style="--i:5"><h3>Top artists</h3>${d.artists.slice(0, 5).map((a, i) => `<div class="wr-row"><span class="wr-n">${i + 1}</span><div class="wr-cover wr-av">${esc(a.name.slice(0, 1).toUpperCase())}</div><div class="meta"><b>${esc(a.name)}</b><span>${Math.round(a.ms / 60000)} min</span></div><span class="muted">${plural(a.n, "play")}</span></div>`).join("")}</div>
    </div></div>`;
  requestAnimationFrame(countUp);
  return h;
};
function countUp() {
  for (const el of $$("[data-count]")) {
    const to = +el.dataset.count, t0 = performance.now(), dur = 1400;
    const step = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e).toLocaleString("en"); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
$("#view").addEventListener("click", e => {
  const sh = e.target.closest("[data-wrshare]"); if (sh) return shareWrapped(sh.dataset.wrshare);
  const pl = e.target.closest("[data-wrplay]");
  if (pl) { const ids = wrapData(pl.dataset.wrplay).songs.slice(0, 25).map(s => s.id).filter(id => T(id)); if (ids.length) playContext(ids, 0, { type: "wrapped", id: "", name: "Your top songs" }); return; }
  const so = e.target.closest("[data-wrsong]"); if (so && T(so.dataset.wrsong)) playContext([so.dataset.wrsong], 0, null);
});
function loadImg(src) { return new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
async function shareWrapped(key) {
  const d = wrapData(key), W = 1080, H = 1350;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue("--accent").trim() || "#a970ff";
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, accent); grad.addColorStop(.55, "#2a1250"); grad.addColorStop(1, "#07040f");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) { g.globalAlpha = .18; g.fillStyle = ["#fff", accent, "#ff5c9a"][i]; g.beginPath(); g.arc([880, 160, 960][i], [180, 1150, 900][i], [260, 320, 180][i], 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1; g.fillStyle = "#fff";
  const font = (w, s) => `${w} ${s}px "Segoe UI", system-ui, sans-serif`;
  g.font = font(700, 38); g.globalAlpha = .85; g.fillText(`My ${monthName(key)} on Nagham`, 80, 130); g.globalAlpha = 1;
  g.font = font(900, 190); g.fillText(Math.round(d.ms / 60000).toLocaleString("en"), 72, 330);
  g.font = font(700, 44); g.fillText("minutes listened", 82, 395);
  g.font = font(800, 40); g.fillText("Top songs", 80, 520);
  let y = 560;
  for (const [i, s] of d.songs.slice(0, 5).entries()) {
    const img = await loadImg(s.cover);
    g.fillStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.roundRect(80, y, 110, 110, 18); g.fill();
    if (img) { g.save(); g.beginPath(); g.roundRect(80, y, 110, 110, 18); g.clip(); g.drawImage(img, 80, y, 110, 110); g.restore(); }
    g.fillStyle = "#fff"; g.font = font(900, 40); g.fillText(String(i + 1), 220, y + 52);
    g.font = font(800, 38); g.fillText(clip(g, s.title, 700), 270, y + 50);
    g.globalAlpha = .75; g.font = font(600, 30); g.fillText(clip(g, s.artist, 700), 270, y + 92); g.globalAlpha = 1;
    y += 136;
  }
  g.font = font(800, 34); g.globalAlpha = .9;
  g.fillText(`Top artist: ${clip(g, d.artists[0]?.name || "—", 760)}`, 80, H - 70);
  g.globalAlpha = .6; g.font = font(700, 30); g.textAlign = "right"; g.fillText("نغم · Nagham", W - 80, H - 70);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Wrapped image copied — paste it anywhere (Ctrl+V)"); }
  catch { toast("Saving the image…"); }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Nagham-Wrapped-${key}.png`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function clip(g, s, w) { s = String(s || ""); if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(s + "…").width > w) s = s.slice(0, -1); return s + "…"; }

/* ============================================================ mini player + remote control */
let rcLast = "", rcTimer = 0;
function publishRemote(force) {
  const t = T(P.current);
  const cs = getComputedStyle(document.documentElement);
  const st = {
    id: P.current || "", title: t?.title || "", artist: t?.artist || "", cover: t ? (coverOf(t.id) || "") : "",
    playing: !E.paused, t: Math.round((E.time || 0) * 10) / 10, d: Math.round((E.duration || t?.duration || 0) * 10) / 10,
    liked: !!(t && lib.liked.has(t.id)), at: Date.now(),
    accent: cs.getPropertyValue("--accent").trim(), bg: cs.getPropertyValue("--panel-solid").trim() || cs.getPropertyValue("--bg").trim(), text: cs.getPropertyValue("--text").trim(),
  };
  const sig = JSON.stringify({ ...st, t: 0, at: 0 });
  if (!force && sig === rcLast && Date.now() - rcTimer < 5000) return;
  rcLast = sig; rcTimer = Date.now();
  fetch("/api/remote/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(st) }).catch(() => {});
}
setInterval(() => publishRemote(), 1000);
(async function remoteLoop() {
  let seq = -1;
  for (;;) {
    try {
      const r = await (await fetch(`/api/remote/cmds?after=${seq}`)).json();
      if (seq >= 0) for (const c of r.cmds || []) runRemote(c);
      seq = r.seq;
    } catch { await new Promise(r => setTimeout(r, 2000)); }
  }
})();
function runRemote(c) {
  switch (c.cmd) {
    case "toggle": if (P.current) togglePlay(); break;
    case "play": if (E.paused && P.current) togglePlay(); break;
    case "pause": if (!E.paused) E.pause(); break;
    case "next": next(false); break;
    case "prev": prev(); break;
    case "like": if (P.current) toggleLike([P.current]); break;
    case "seek": E.time = c.val; break;
    case "show": break;
  }
  setTimeout(() => publishRemote(true), 250);
}
async function openMini() {
  let native = false;
  if (window.chrome?.webview) { try { native = !!(await api("/api/mini", { open: true })).native; } catch {} }
  if (!native) window.open("/mini.html", "nagham-mini", "width=400,height=150,left=" + (screen.availWidth - 420) + ",top=" + (screen.availHeight - 190));
  publishRemote(true);
}
$("#miniBtn").onclick = openMini;

/* ============================================================ hooks into the player */
const _renderFull = renderFull;
renderFull = function () {
  _renderFull();
  if (LYR.on && P.current && LYR.id !== P.current) loadLyrics(P.current);
};
const _playId = playId;
playId = function (...a) { const r = _playId(...a); if (LYR.on || $("#full").classList.contains("lyr")) loadLyrics(P.current); publishRemote(true); return r; };

/* ============================================================ settings: sound */
const _pbTab = SETTINGS_TABS.playback;
SETTINGS_TABS.playback = function () {
  const g = eqGains(), preset = settings.eq?.gains ? "custom" : (settings.eq?.preset || "flat");
  const cf = +settings.crossfade || 0;
  return `<div class="settings-sec"><h3>Sound</h3>
      <div class="set-row"><div class="lbl"><b>Equalizer</b><span>Works on your own songs and on songs from YouTube Music. Spotify's own player can't be changed, so while the equalizer is on, Spotify songs play through YouTube Music.</span></div></div>
        <div class="seg eq-presets" data-eqpreset>${Object.entries(EQ_PRESETS).map(([k, [l]]) => `<button data-v="${k}" class="${preset === k ? "on" : ""}">${l}</button>`).join("")}${preset === "custom" ? '<button class="on">Custom</button>' : ""}</div>
      <div class="eqbox">${EQ_FREQS.map((f, i) => `<label><span class="eq-val">${g[i] > 0 ? "+" : ""}${g[i]}</span><input type="range" min="-12" max="12" step="1" value="${g[i]}" data-eqband="${i}" style="--p:${(g[i] + 12) / 24 * 100}%"><small>${f >= 1000 ? f / 1000 + "k" : f}</small></label>`).join("")}</div>
      <div class="set-row"><div class="lbl"><b>Crossfade</b><span>The next song fades in while this one fades out (your own songs and free full songs)</span></div>
        <div class="seg" data-crossfade>${[[0, "Off"], [3, "3 s"], [6, "6 s"], [10, "10 s"]].map(([v, l]) => `<button data-v="${v}" class="${cf === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="set-row"><div class="lbl"><b>Radio when the list ends</b><span>Keeps the music going with songs similar to the last one</span></div>
        <label class="switch"><input type="checkbox" id="swRadio" ${settings.radio === true ? "checked" : ""}><i></i></label></div>
    </div>` + _pbTab.call(this);
};
$("#view").addEventListener("click", e => {
  const p = e.target.closest("[data-eqpreset] button[data-v]");
  if (p) { settings.eq = { preset: p.dataset.v }; saveUser(); eqApply(); render(true); return; }
  const c = e.target.closest("[data-crossfade] button");
  if (c) { settings.crossfade = +c.dataset.v; saveUser(); render(true); }
});
$("#view").addEventListener("input", e => {
  const b = e.target.closest("[data-eqband]"); if (!b) return;
  const g = [...eqGains()]; g[+b.dataset.eqband] = +b.value;
  b.style.setProperty("--p", (+b.value + 12) / 24 * 100 + "%");
  settings.eq = { gains: g }; eqApply();
  const v = b.parentElement.querySelector(".eq-val"); if (v) v.textContent = (g[+b.dataset.eqband] > 0 ? "+" : "") + g[+b.dataset.eqband];
  clearTimeout(b._t); b._t = setTimeout(() => { saveUser(); $$("[data-eqpreset] button").forEach(x => x.classList.toggle("on", !x.dataset.v)); }, 400);
});
$("#view").addEventListener("change", e => { if (e.target.id === "swRadio") { settings.radio = e.target.checked; saveUser(); } });

/* Wrapped in the "you" menu */
const _meClick = $("#meBtn").onclick;
$("#meBtn").onclick = e => {
  _meClick(e);
  const m = menuEl; if (!m) return;
  const b = document.createElement("button"); b.className = "mi"; b.innerHTML = `<span style="width:16px;text-align:center">✨</span><span class="grow">Your Wrapped</span>`;
  b.onclick = ev => { ev.stopPropagation(); closeMenu(); go("wrapped"); };
  m.insertBefore(b, m.firstChild);
};

/* start-up */
setTimeout(() => {
  eqApply();
  if (settings.lyricsOn) { LYR.on = true; $("#full").classList.add("lyr"); $("#fLyr").classList.add("on"); $("#lyrBtn").classList.add("on"); }
  renderSleep(); publishRemote(true);
}, 300);

/* ============================================================ new songs: ask where they go */
const NEWQ = { ids: [], open: false };
function takeNewTracks(tracks) {
  let fresh = [];
  for (const t of tracks || []) {
    if (!t?.id) continue;
    if (!lib.byId[t.id]) { lib.tracks.push(t); lib.byId[t.id] = t; }
    fresh.push(t.id);
  }
  if (!fresh.length) return;
  buildIndexes(); renderLib();
  const c = nav.stack[nav.idx]; if (c && /^(library|songs|search|home)$/.test(c.view)) render(true);
  if (settings.askNew === false) { toast(fresh.length === 1 ? `Added “${T(fresh[0])?.title}” to your library` : `Added ${fresh.length} new songs to your library`); return; }
  NEWQ.ids = [...new Set([...NEWQ.ids, ...fresh])];
  showWherePrompt();
}
function showWherePrompt() {
  const ids = NEWQ.ids.filter(id => T(id)); if (!ids.length) return;
  let bg = $("#whereBg");
  if (!bg) { bg = document.createElement("div"); bg.id = "whereBg"; bg.className = "modal-bg"; document.body.appendChild(bg); }
  const list = ids.slice(0, 4).map(id => `<div class="where-song">${trackArt(id, true)}<div class="meta"><b>${esc(T(id).title)}</b><span>${esc(T(id).artist)}</span></div></div>`).join("")
    + (ids.length > 4 ? `<div class="muted" style="font-size:13px;margin:4px 2px">…and ${ids.length - 4} more</div>` : "");
  bg.innerHTML = `<div class="modal where">
    <h3>${ids.length === 1 ? "New song" : `${ids.length} new songs`}</h3>
    <p class="muted">Where should ${ids.length === 1 ? "it" : "they"} go?</p>
    <div class="where-list">${list}</div>
    <div class="where-opts">
      <button class="where-opt" data-where="lib"><span class="wi">${IC.folder}</span><span><b>Just my library</b><small>${IOS ? "My songs" : "Songs on this PC"}</small></span></button>
      ${lib.playlists.map(p => `<button class="where-opt" data-where="${esc(p.id)}"><span class="wi">${playlistArt(p)}</span><span><b>${esc(p.name)}</b><small>${plural(p.tracks.length, "song")}</small></span></button>`).join("")}
      <button class="where-opt new" data-where="new"><span class="wi">${IC.plus}</span><span><b>New playlist…</b><small>Make one for ${ids.length === 1 ? "it" : "them"}</small></span></button>
    </div>
    <div class="where-newrow" hidden><input class="input" id="whereName" placeholder="Playlist name" maxlength="60"><button class="btn accent sm" data-where="create">Create</button></div>
    <label class="where-ask"><input type="checkbox" id="whereAsk"> Don't ask again — just add new songs to my library</label>
  </div>`;
  NEWQ.open = true;
}
document.addEventListener("click", e => {
  const b = e.target.closest("#whereBg [data-where]");
  if (!b) { if (e.target.id === "whereBg") closeWhere("lib"); return; }
  const w = b.dataset.where;
  if (w === "new") { $("#whereBg .where-newrow").hidden = false; $("#whereName").focus(); return; }
  if (w === "create") { const n = $("#whereName").value.trim(); if (!n) return $("#whereName").focus(); closeWhere({ create: n }); return; }
  closeWhere(w);
});
document.addEventListener("keydown", e => {
  if (!NEWQ.open) return;
  if (e.key === "Enter" && document.activeElement?.id === "whereName") $('#whereBg [data-where="create"]').click();
  if (e.key === "Escape") closeWhere("lib");
});
function closeWhere(where) {
  const ids = NEWQ.ids.filter(id => T(id));
  if ($("#whereAsk")?.checked) settings.askNew = false;
  $("#whereBg")?.remove(); NEWQ.open = false; NEWQ.ids = [];
  if (where && typeof where === "object") {
    const p = { id: uid(), name: where.create, tracks: [...ids], created: Date.now() };
    lib.playlists.push(p); toast(`Made “${p.name}” with ${plural(ids.length, "song")}`);
  } else if (where && where !== "lib") {
    const p = lib.playlists.find(x => x.id === where);
    if (p) { const before = p.tracks.length; p.tracks = [...new Set([...p.tracks, ...ids])]; toast(`Added ${plural(p.tracks.length - before, "song")} to “${p.name}”`); }
  } else toast(ids.length === 1 ? `“${T(ids[0])?.title}” is in your library` : `${ids.length} songs added to your library`);
  saveUser(); renderLib(); render(true);
}
(async function newSongsLoop() {
  let seq = -1;
  for (;;) {
    try {
      const r = await api(`/api/newsongs?after=${seq}`);
      if (seq >= 0 && r.tracks?.length) takeNewTracks(r.tracks);
      seq = r.seq;
    } catch {}
    await new Promise(res => setTimeout(res, 4000));
  }
})();
/* files dropped onto Nagham's window */
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|wma|aiff?|alac|webm)$/i;
let dropDepth = 0;
addEventListener("dragenter", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { dropDepth++; document.body.classList.add("dropping"); } });
addEventListener("dragleave", () => { if (--dropDepth <= 0) { dropDepth = 0; document.body.classList.remove("dropping"); } });
addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
addEventListener("drop", async e => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault(); dropDepth = 0; document.body.classList.remove("dropping");
  const files = [...e.dataTransfer.files].filter(f => AUDIO_EXT.test(f.name));
  if (!files.length) return toast("Drop song files (MP3, M4A, FLAC, WAV…)");
  const got = [];
  for (const [i, f] of files.entries()) {
    toast(`Adding ${i + 1} of ${files.length}: ${f.name}`);
    try {
      const r = await fetch("/api/import?name=" + encodeURIComponent(f.name), { method: "POST", body: f });
      if (!r.ok) throw new Error((await r.text()).trim());
      got.push((await r.json()).track);
    } catch (err) { toast(`Couldn't add ${f.name}: ${err.message}`); }
  }
  takeNewTracks(got);
});
/* setting */
const _libTab = SETTINGS_TABS.library;
SETTINGS_TABS.library = function () {
  return _libTab.call(this) + `<div class="settings-sec"><h3>New songs</h3>
    <div class="set-row"><div class="lbl"><b>Ask where new songs go</b><span>When a song shows up in one of your folders (for example the folder another app saves music into) or you drop a file onto Nagham, choose a playlist for it</span></div>
      <label class="switch"><input type="checkbox" id="swAskNew" ${settings.askNew !== false ? "checked" : ""}><i></i></label></div>
    <p class="muted" style="font-size:13px;margin:6px 0 0">Tip: add that app's download folder above with <b>Add a folder…</b> — new songs appear in Nagham by themselves.</p>
  </div>`;
};
$("#view").addEventListener("change", e => { if (e.target.id === "swAskNew") { settings.askNew = e.target.checked; saveUser(); } });
