"use strict";
/* Nagham – YouTube: song helpers and the official YouTube player (account linking was removed in 3.19.0) */

const YTM = { loaded: true, configured: false, connected: false }; // no YouTube account linking any more
const YTS = { paused: true, player: null, ready: null, timer: 0 };
const YT_LOGO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><path d="M10 16.5a2 2 0 1 1-1-1.73V7.5l7-1.5v8a2 2 0 1 1-1-1.73V8.3l-5 1.07z" fill="#fff"/></svg>';
const isYt = id => !!id && id.startsWith("yt:");

/* ---------------- songs ---------------- */
function cleanTitle(t) {
  return (t || "").replace(/\s*[\(\[](official\s*(music\s*)?(video|audio|visualizer|lyric video)|lyrics?|lyric video|audio|hd|4k|mv|video clip|clip officiel|فيديو كليب|حصريا[ًا]?)[^\)\]]*[\)\]]/gi, "")
    .replace(/\s*\|\s*official.*$/i, "").replace(/\s{2,}/g, " ").trim();
}
function ytTrack(item, durations) {
  const sn = item.snippet || {};
  const vid = item.id?.videoId || sn.resourceId?.videoId || (typeof item.id === "string" ? item.id : null) || item.contentDetails?.videoId;
  if (!vid || /^(private|deleted) video$/i.test(sn.title || "")) return null;
  let title = cleanTitle(sn.title), channel = (sn.videoOwnerChannelTitle || sn.channelTitle || "").replace(/\s*-\s*Topic$/i, "");
  let artist = channel;
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && !/ - Topic$/i.test(sn.videoOwnerChannelTitle || sn.channelTitle || "")) { artist = m[1].trim(); title = m[2].trim(); }
  const th = sn.thumbnails || {};
  const big = (th.maxres || th.standard || th.high || th.medium || th.default || {}).url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  const small = (th.medium || th.default || th.high || {}).url || big;
  return { id: "yt:" + vid, src: "yt", youtube: true, online: true, title: title || "Untitled", artist: artist || "YouTube", album: "", cover: big, coverSmall: small, duration: durations?.[vid] || 0 };
}

/* the linked-account pages are gone: these stay so older saved links don't break anything */
const YTF = {};
function ytLoad() { return { data: null }; }
async function ytEnsureData() { return { ids: [] }; }
function ytCtxTracks() { return null; }
async function ytPlayCtx() { toast("YouTube account playlists aren't in Nagham any more"); }
function ytPlaylistTile() { return ""; }
async function ytRefreshStatus() { return YTM; }
function ytAccountCard() { return ""; }

/* ---------------- playback: the official YouTube player (kept visible) ---------------- */
function ytEnsurePlayer() {
  if (YTS.ready) return YTS.ready;
  YTS.ready = new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => {
      YTS.player = new window.YT.Player("ytplayer", {
        width: "100%", height: "100%",
        playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, disablekb: 1, origin: location.origin },
        events: {
          onReady: () => { ytVolume(); resolve(YTS.player); },
          onStateChange: ev => {
            if (E.mode !== "youtube") return;
            if (ev.data === 1) {
              if (!YTS.started) { YTS.started = true; clearTimeout(P.watch); const t = T(P.current), d = ytDur(); if (t && d > 0 && Math.abs((t.duration || 0) - d) > 2) { t.duration = d; renderTime(); } }
              if (YTS.paused) { YTS.paused = false; onEnginePlay(); }
            }
            else if (ev.data === 2) { if (!YTS.paused) { YTS.paused = true; onEnginePause(); } }
            else if (ev.data === 0) { YTS.paused = true; next(true); }
          },
          onError: ev => {
            postLog(`youtube error ${ev.data} video=${T(P.current)?.ytNow} origin=${location.origin} ua=${navigator.userAgent.includes("WebView2") || !!window.chrome?.webview ? "webview2" : "edge"}`);
            if (E.mode !== "youtube") return;
            const t = T(P.current);
            if (t && (t.ytFailed || []).includes(t.ytNow)) return;
            if (t) { t.ytFailed = [...(t.ytFailed || []), t.ytNow]; if (t.youtube) t.noEmbedAll = true; }
            console.warn("youtube player error", ev.data);
            clearTimeout(P.watch);
            startEngine(P.current, 0); // tries the next YouTube video, then the 30-second clip
          },
        },
      });
    };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
    s.onerror = () => { YTS.ready = null; reject(new Error("Couldn't load the YouTube player")); };
    document.head.appendChild(s);
  });
  return YTS.ready;
}
async function ytPlay(videoId, startAt = 0) {
  showYtMini(true);
  const p = await ytEnsurePlayer();
  YTS.paused = true; YTS.started = false;
  p.loadVideoById({ videoId, startSeconds: startAt || 0 });
}
function ytStop() { try { YTS.player?.stopVideo(); } catch {} YTS.paused = true; showYtMini(false); }
function ytVolume() { const p = YTS.player; if (!p?.setVolume) return; p.setVolume(Math.round((settings.volume ?? .8) * (typeof VOLMUL === "number" ? VOLMUL : 1) * 100)); settings.muted ? p.mute() : p.unMute(); }
const ytTime = () => { try { return YTS.player?.getCurrentTime?.() || 0; } catch { return 0; } };
const ytDur = () => { try { return YTS.player?.getDuration?.() || 0; } catch { return 0; } };
setInterval(() => { if (E.mode === "youtube" && !YTS.paused) onEngineTime(); }, 500);
function showYtMini(on) {
  const ytm = extOn();
  $("#ytmini").classList.toggle("ytm", ytm);
  // YouTube Music plays hidden: its page is never shown (only the old embedded player has a box)
  $("#ytmini").classList.toggle("on", !!on && E.mode === "youtube" && !ytm);
  placeYtMini();
  try { renderPP(); } catch {}
}
/* tell Nagham's window where to draw the YouTube Music page (physical pixels).
   When the video box is hidden the page stays loaded, tucked into one pixel, and keeps playing. */
let ytmRectT = 0;
function syncYtmRect(now) {
  if (!extOn()) return;
  const send = () => {
    const a = $("#ytarea"), m = $("#ytmini");
    const on = m.classList.contains("on") && !document.querySelector(".modal-bg, #onboard.open, #tour.on, .menu.open");
    const r = a.getBoundingClientRect(), d = devicePixelRatio || 1;
    api("/api/ytm", { visible: on, hidden: true, rect: [Math.round(r.left * d), Math.round(r.top * d), Math.round(r.width * d), Math.round(r.height * d)] }).catch(() => {});
  };
  clearTimeout(ytmRectT);
  if (now) send(); else ytmRectT = setTimeout(send, 30);
}
addEventListener("resize", () => syncYtmRect());
new MutationObserver(() => syncYtmRect()).observe(document.body, { childList: true });
function placeYtMini() {
  const m = $("#ytmini"), full = $("#full").classList.contains("open");
  m.classList.toggle("in-full", full && m.classList.contains("on"));
  if (full && m.classList.contains("on")) {
    const z = parseFloat(document.body.style.zoom) || 1;
    const fit = () => {
      const r = $("#fArt").getBoundingClientRect();
      // the YouTube Music page takes the album art's place; a real video keeps 16:9
      const h = m.classList.contains("ytm") ? r.height : r.width * 9 / 16;
      Object.assign(m.style, { left: r.left / z + "px", top: (r.top + (r.height - h) / 2) / z + "px", width: r.width / z + "px", height: h / z + "px", right: "auto", bottom: "auto" });
      syncYtmRect(true);
    };
    fit(); setTimeout(fit, 480); // again once the full-screen animation has finished
    return;
  }
  applyMiniGeom();
  syncYtmRect();
}
/* move / resize the in-app video box (remembered) – never smaller than YouTube's 200px minimum */
const MINI_SIZES = [356, 480, 640];
function applyMiniGeom() {
  const m = $("#ytmini"); if (m.classList.contains("in-full")) return;
  const g = settings.ytMini || {}, z = parseFloat(document.body.style.zoom) || 1;
  const vw = innerWidth / z, vh = innerHeight / z;
  const w = clamp(g.w || 356, 356, Math.max(356, vw - 20)), h = Math.round(w * 9 / 16) + 30;
  m.style.width = w + "px"; m.style.height = h + (m.classList.contains("ytm") ? 14 : 0) + "px";
  if (g.x != null) { m.style.left = clamp(g.x, 0, Math.max(0, vw - w)) + "px"; m.style.top = clamp(g.y, 0, Math.max(0, vh - h)) + "px"; m.style.right = "auto"; m.style.bottom = "auto"; }
  else { m.style.left = m.style.top = ""; m.style.right = ""; m.style.bottom = ""; }
}
function saveMini(patch) { settings.ytMini = { ...(settings.ytMini || {}), ...patch }; saveUser(); applyMiniGeom(); }
(() => {
  const m = $("#ytmini"), bar = $(".ytbar", m), handle = $(".ythandle", m);
  const zoom = () => parseFloat(document.body.style.zoom) || 1;
  let drag = null;
  const start = (e, kind) => {
    if (kind === "move" && e.target.closest("button")) return;
    e.preventDefault();
    const r = m.getBoundingClientRect(), z = zoom();
    drag = { kind, px: e.clientX, py: e.clientY, x: r.left / z, y: r.top / z, w: r.width / z };
    m.classList.add("dragging"); e.target.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!drag) return;
    const z = zoom(), dx = (e.clientX - drag.px) / z, dy = (e.clientY - drag.py) / z;
    if (drag.kind === "move") { m.style.left = drag.x + dx + "px"; m.style.top = drag.y + dy + "px"; m.style.right = m.style.bottom = "auto"; syncYtmRect(); }
    else { const w = clamp(drag.w + Math.max(dx, dy * 16 / 9), 356, innerWidth / z - drag.x - 4); m.style.left = drag.x + "px"; m.style.top = drag.y + "px"; m.style.right = m.style.bottom = "auto"; m.style.width = w + "px"; m.style.height = Math.round(w * 9 / 16) + 30 + (m.classList.contains("ytm") ? 14 : 0) + "px"; syncYtmRect(); }
  };
  const end = () => {
    if (!drag) return;
    m.classList.remove("dragging");
    const r = m.getBoundingClientRect(), z = zoom();
    saveMini({ x: Math.round(r.left / z), y: Math.round(r.top / z), w: Math.round(r.width / z) });
    drag = null;
  };
  bar.addEventListener("pointerdown", e => start(e, "move"));
  handle.addEventListener("pointerdown", e => start(e, "size"));
  for (const el of [bar, handle]) { el.addEventListener("pointermove", move); el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end); }
  bar.addEventListener("dblclick", e => { if (!e.target.closest("button")) { settings.ytMini = {}; saveUser(); applyMiniGeom(); toast("Video box back in its corner"); } });
  $("#ytSize").onclick = () => { const cur = (settings.ytMini || {}).w || 356; const i = MINI_SIZES.findIndex(s => s > cur + 4); saveMini({ w: MINI_SIZES[i < 0 ? 0 : i] }); };
})();
addEventListener("resize", placeYtMini);
$("#ytExpand").onclick = () => toggleFull();
$("#ytHide").onclick = () => { if (extOn()) showYtVideo(false); else toggleFull(false); };

async function playYouTubeLink(vid, out, done) {
  const info = await api("/api/online/ytinfo?id=" + encodeURIComponent(vid));
  const t = ytTrack({ id: vid, snippet: { title: info.title, channelTitle: info.author, thumbnails: { high: { url: info.thumb || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` } } } });
  const id = registerOnline([t])[0];
  out.innerHTML = `<div class="share-card"><div class="art">${trackArt(id, true)}</div><div style="min-width:0;flex:1"><b>${esc(t.title)}</b><span class="muted">${esc(t.artist)}</span></div>
    <button class="btn sm ghost" id="cLike">${lib.liked.has(id) ? "Liked" : "Save to Liked"}</button><button class="btn sm accent" id="cPlay">${IC.play}Play</button></div>`;
  $("#cPlay", out).onclick = () => { playContext([id], 0, { type: "shared", id, name: "From YouTube" }); done(true); };
  $("#cLike", out).onclick = e => { if (!lib.liked.has(id)) toggleLike([id]); e.target.textContent = "Liked"; };
}
