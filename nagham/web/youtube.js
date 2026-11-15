"use strict";
/* Nagham – YouTube Music (YouTube Data API v3 + the official YouTube player) */

const YTM = { loaded: false, configured: false, connected: false, clientId: "", channel: null, error: "", pending: false, waiting: false, redirectUri: "http://127.0.0.1:8888/ytcallback" };
const YTS = { paused: true, player: null, ready: null, timer: 0 };
const YT_LOGO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><path d="M10 16.5a2 2 0 1 1-1-1.73V7.5l7-1.5v8a2 2 0 1 1-1-1.73V8.3l-5 1.07z" fill="#fff"/></svg>';
const isYt = id => !!id && id.startsWith("yt:");

async function ytApi(path) {
  const r = await fetch("/api/youtube/v3" + path);
  if (r.status === 401) { const m = (await r.text()).trim(); await ytRefreshStatus(); throw new Error(m || "Your YouTube Music link has expired. Please link it again."); }
  if (!r.ok) throw new Error((await r.text()).trim() || "YouTube error " + r.status);
  return r.json();
}
async function ytRefreshStatus() {
  try {
    const s = await api("/api/youtube/status");
    const was = YTM.connected;
    Object.assign(YTM, { loaded: true, configured: s.configured, connected: s.connected, clientId: s.clientId || "", channel: s.channel || null, error: s.error || "", pending: s.pending, redirectUri: s.redirectUri || YTM.redirectUri });
    if (was && !YTM.connected) for (const k in oCache) if (k.startsWith("yt:")) delete oCache[k];
  } catch { YTM.loaded = true; }
  return YTM;
}

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
function isoDur(s) { const m = (s || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if (!m) return 0; return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0); }
async function ytDurations(vids) {
  const out = {};
  for (let i = 0; i < vids.length; i += 50) {
    const r = await ytApi(`/videos?part=contentDetails&id=${vids.slice(i, i + 50).join(",")}`).catch(() => ({ items: [] }));
    for (const v of r.items || []) out[v.id] = isoDur(v.contentDetails?.duration);
  }
  return out;
}
async function ytTracks(items) {
  const vids = items.map(it => it.id?.videoId || it.snippet?.resourceId?.videoId || it.contentDetails?.videoId).filter(Boolean);
  const d = await ytDurations(vids);
  return registerOnline(items.map(it => ytTrack(it, d)).filter(Boolean));
}

const YTF = {
  async myplaylists() { const r = await ytApi("/playlists?part=snippet,contentDetails&mine=true&maxResults=50"); return r.items || []; },
  async playlist(id) {
    const meta = await ytApi(`/playlists?part=snippet,contentDetails&id=${encodeURIComponent(id)}`).catch(() => ({ items: [] }));
    let items = [], page = "", guard = 0;
    do {
      const r = await ytApi(`/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(id)}${page ? "&pageToken=" + page : ""}`);
      items = items.concat(r.items || []); page = r.nextPageToken;
    } while (page && items.length < 300 && guard++ < 6);
    return { pl: meta.items?.[0] || { id, snippet: { title: "Playlist" } }, ids: await ytTracks(items) };
  },
  async liked() {
    let r;
    try { r = await ytApi("/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=LM"); }
    catch { r = await ytApi("/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=LL"); }
    return { ids: await ytTracks(r.items || []) };
  },
  async search(q) {
    const r = await ytApi(`/search?part=snippet&type=video&videoCategoryId=10&videoEmbeddable=true&videoSyndicated=true&maxResults=15&q=${encodeURIComponent(q)}`);
    return { ids: await ytTracks(r.items || []) };
  },
};
function ytLoad(key, fn, ttl = 10 * 60e3) { return cacheLoad("yt:" + key, fn, ttl); }
async function ytEnsureData(key, fn) { const k = "yt:" + key; if (oCache[k]?.data) return oCache[k].data; const d = await fn(); oCache[k] = { data: d, at: Date.now() }; return d; }
function ytCtxTracks(type, id) {
  if (type === "ytplaylist") return oCache["yt:pl:" + id]?.data?.ids || null;
  if (type === "ytliked") return oCache["yt:liked"]?.data?.ids || null;
  return null;
}
async function ytPlayCtx(type, id, shuffled) {
  try {
    const d = type === "ytplaylist" ? await ytEnsureData("pl:" + id, () => YTF.playlist(id)) : await ytEnsureData("liked", YTF.liked);
    if (!d.ids.length) return toast("Nothing to play here");
    playContext(d.ids, shuffled ? Math.floor(Math.random() * d.ids.length) : 0, { type, id, name: d.pl?.snippet?.title || "Liked music" });
  } catch (e) { toast(e.message); }
}
function ytPlaylistTile(p) {
  const th = p.snippet?.thumbnails || {};
  const img = proxImg((th.high || th.medium || th.default || {}).url);
  return `<div class="tile" data-go="ytplaylist:${esc(p.id)}"><div class="art">${imgHTML(img, p.id)}</div><button class="play-big" data-playctx="ytplaylist:${esc(p.id)}">${IC.play}</button>
    <div class="name"><span>${esc(p.snippet?.title || "Playlist")}</span></div><div class="sub">${p.contentDetails?.itemCount != null ? plural(p.contentDetails.itemCount, "song") : "Playlist"}</div></div>`;
}

/* ---------------- pages ---------------- */
VIEWS_EXTRA.ytplaylist = (id) => {
  const c = ytLoad("pl:" + id, () => YTF.playlist(id));
  if (c.loading) return `<div class="pad"><div class="skeleton" style="width:220px;height:220px"></div></div>`;
  if (c.error) return `<div class="pad">${spErrorNote(c.error).replace("Spotify: ", "")}</div>`;
  const { pl, ids } = c.data;
  const th = pl.snippet?.thumbnails || {};
  const img = proxImg((th.maxres || th.high || th.medium || {}).url);
  return hero({ kind: "Playlist", title: pl.snippet?.title || "Playlist", key: id, coverSrc: img, artHTML: imgHTML(img, id), stats: `${plural(ids.length, "song")}${ids.length ? ", " + fmtLong(totalDur(ids)) : ""}` })
    + `<div class="under-hero">${actions("ytplaylist:" + id, `<button class="icon-btn" data-shareids="ytpl" title="Share as playlist code">${IC.share}</button><button class="icon-btn" data-lplmenu="ytplaylist|${esc(id)}" title="More options">${IC.dots.replace('width="17" height="17"', "")}</button>`)}${trackTable(ids, { ctx: { type: "ytplaylist", id, name: pl.snippet?.title }, key: "ytpl", sortKey: "ytpl:" + id })}</div>`;
};
VIEWS_EXTRA.ytliked = () => {
  const c = ytLoad("liked", YTF.liked);
  if (c.loading) return `<div class="pad"><div class="skeleton" style="width:220px;height:220px"></div></div>`;
  if (c.error) return `<div class="pad">${spErrorNote(c.error).replace("Spotify: ", "")}</div>`;
  return hero({ kind: "Playlist", title: "Liked music", artHTML: `<div class="art-ph" style="background:linear-gradient(135deg,#ff4e45,#8a1c17)">${YT_LOGO}</div>`, color: "#c4302b", stats: plural(c.data.ids.length, "song") })
    + `<div class="under-hero">${actions("ytliked:")}${trackTable(c.data.ids, { ctx: { type: "ytliked", id: "", name: "Liked music" }, key: "ytlk" })}</div>`;
};

/* ---------------- linking ---------------- */
function ytAccountCard() {
  const y = YTM;
  if (y.connected) {
    const sn = y.channel?.snippet || {};
    return `<div class="acct-row"><span class="acct-logo yt">${YT_LOGO}</span><div class="lbl" style="flex:1"><b>YouTube Music — ${esc(sn.title || "linked")}</b><span>Full songs from YouTube play in Nagham, and your playlists are in Your Library.</span></div><button class="btn ghost sm" data-ytsharekeys title="Let a friend link without setting up Google Cloud">Share keys</button><button class="btn ghost sm" data-ytlogout>Unlink</button></div>`;
  }
  const step = (n, title, body) => `<div class="sp-step"><div class="sp-num">${n}</div><div style="min-width:0;flex:1"><b>${title}</b><div class="muted" style="font-size:13.5px;margin-top:4px;line-height:1.55">${body}</div></div></div>`;
  return `<details class="acct" ${y.waiting || y.error ? "open" : ""}><summary><span class="acct-logo yt">${YT_LOGO}</span><div class="lbl" style="flex:1"><b>YouTube Music</b><span>Play full songs from YouTube and bring in your playlists</span></div><span class="btn ghost sm">Link</span></summary>
    <div class="acct-body">
      ${y.error ? `<div class="sp-error"><b>Couldn't link</b><span>${esc(y.error)}</span></div>` : ""}
      ${y.waiting || y.pending ? `<div class="sp-wait" style="background:color-mix(in srgb,#ff4e45 12%,transparent);border-color:color-mix(in srgb,#ff4e45 35%,transparent)"><div class="spin" style="width:22px;height:22px"></div><div style="flex:1"><b>Waiting for you to sign in with Google…</b><div class="muted" style="font-size:13px;margin-top:3px">Finish in the Google window. If it says the app isn't verified, click <i>Continue</i> (it's your own app).</div></div><button class="btn ghost sm" data-ytlogin="browser">Use my browser</button><button class="btn ghost sm" data-ytcancel>Cancel</button></div>` : ""}
      <div class="notice">${IC.info}<div>Got a <b>key code</b> from a friend who already set this up? Paste it with <b>Enter code</b> (Ctrl+V) and skip to step 5 — just ask them to add your email as a test user.</div></div>
      ${step(1, "Create a Google Cloud project", `<a class="btn sm ghost" href="https://console.cloud.google.com/projectcreate" target="_blank">Open: new project ↗</a> &nbsp;Any name works, e.g. “Nagham”.`)}
      ${step(2, "Turn on the YouTube Data API", `<a class="btn sm ghost" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank">Open: YouTube Data API v3 ↗</a> &nbsp;then click <b>Enable</b>.`)}
      ${step(3, "Consent screen + add yourself", `<a class="btn sm ghost" href="https://console.cloud.google.com/auth/overview" target="_blank">Open: consent screen ↗</a> &nbsp;choose <b>External</b>, then <a class="btn sm ghost" href="https://console.cloud.google.com/auth/audience" target="_blank">Open: test users ↗</a> &nbsp;and add your Gmail. <b>Skipping this gives “access_denied”.</b>`)}
      ${step(4, "Create a Desktop client", `<a class="btn sm ghost" href="https://console.cloud.google.com/auth/clients/create" target="_blank">Open: create client ↗</a> &nbsp;pick <b>Desktop app</b> → <b>Create</b> → <b>Download JSON</b>. They're saved only on this PC — never inside Nagham itself.
        <div style="margin:10px 0 4px"><button class="btn sm accent" data-ytjson>${IC.folder.replace("<svg", '<svg width="16" height="16"')}Choose the downloaded file (client_secret_….json)</button><input type="file" id="ytJsonFile" accept=".json,application/json" hidden></div>
        <div class="muted" style="font-size:12.5px">…or paste the Client ID and secret yourself (you can also paste the whole JSON into the first box):</div>
        <div class="field"><input class="input" id="ytClientId" placeholder="Client ID (…apps.googleusercontent.com)" value="${esc(y.clientId)}" spellcheck="false"></div>
        <div class="field"><input class="input" id="ytClientSecret" type="password" placeholder="Client secret" spellcheck="false"><button class="btn sm ${y.configured ? "ghost" : "accent"}" data-ytsave>${y.configured ? "Update" : "Save"}</button></div>`)}
      ${step(5, "Sign in", `<button class="btn yt-connect" data-ytlogin ${y.configured ? "" : "disabled"}>${YT_LOGO.replace("<svg", '<svg width="18" height="18"')}Link YouTube Music</button>`)}
    </div></details>`;
}
let ytPollT = null, ytPopup = null;
async function ytStartLogin(browser) {
  try {
    const r = await api("/api/youtube/login", { browser: !!browser });
    YTM.error = ""; YTM.waiting = true;
    if (!browser) { ytPopup = window.open(r.url, "nagham-youtube", "width=520,height=720"); if (!ytPopup) await api("/api/youtube/login", { browser: true }); }
    render(true); ytPoll(Date.now());
  } catch (e) { YTM.error = e.message; YTM.waiting = false; render(true); }
}
function ytPoll(started) {
  clearTimeout(ytPollT);
  ytPollT = setTimeout(async () => {
    await ytRefreshStatus();
    if (YTM.connected) { YTM.waiting = false; ytPopup?.close?.(); toast("YouTube Music linked"); renderLib(); render(true); return; }
    if (YTM.error) { YTM.waiting = false; render(true); return; }
    if (Date.now() - started > 10 * 60e3) { YTM.waiting = false; YTM.error = "The sign-in took too long. Click Link to try again."; render(true); return; }
    ytPoll(started);
  }, 1500);
}
/* the JSON file Google lets you download contains both values */
async function ytImportJson(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error("That file isn't the JSON from Google Cloud."); }
  const c = j.installed || j.web || j;
  if (!c.client_id || !c.client_secret) throw new Error("That file doesn't contain a Client ID and secret.");
  if (j.web) throw new Error("This client is a “Web application”. Create one with type “Desktop app” instead.");
  await api("/api/youtube/config", { clientId: c.client_id, clientSecret: c.client_secret });
  await ytRefreshStatus(); YTM.error = ""; toast("Google keys added — now click Link YouTube Music"); render(true);
}
$("#view").addEventListener("change", async e => {
  if (e.target.id !== "ytJsonFile") return;
  const f = e.target.files[0]; if (!f) return;
  try { await ytImportJson(await f.text()); } catch (err) { YTM.error = err.message; render(true); }
});
$("#view").addEventListener("paste", e => {
  if (e.target.id !== "ytClientId") return;
  const txt = e.clipboardData?.getData("text") || "";
  if (txt.trim().startsWith("{")) { e.preventDefault(); ytImportJson(txt).catch(err => { YTM.error = err.message; render(true); }); }
});
$("#view").addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("[data-ytsharekeys]")) { shareYtKeys(); return; }
  if (t.closest("[data-ytjson]")) { e.preventDefault(); $("#ytJsonFile").click(); return; }
  if (t.closest("[data-ytsave]")) {
    try { await api("/api/youtube/config", { clientId: $("#ytClientId").value.trim(), clientSecret: $("#ytClientSecret").value.trim() }); await ytRefreshStatus(); toast("Saved"); render(true); }
    catch (err) { YTM.error = err.message; render(true); }
    return;
  }
  const lg = t.closest("[data-ytlogin]"); if (lg) { e.preventDefault(); ytStartLogin(lg.dataset.ytlogin === "browser"); return; }
  if (t.closest("[data-ytcancel]")) { e.preventDefault(); clearTimeout(ytPollT); YTM.waiting = false; ytPopup?.close?.(); render(true); return; }
  if (t.closest("[data-ytlogout]")) {
    if (!await confirm_("Unlink YouTube Music?", "Nagham will forget your YouTube sign-in.", "Unlink")) return;
    await api("/api/youtube/logout", {}).catch(() => {}); await ytRefreshStatus(); renderLib(); render(true); toast("YouTube Music unlinked");
  }
});

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
function ytVolume() { const p = YTS.player; if (!p?.setVolume) return; p.setVolume(Math.round((settings.volume ?? .8) * 100)); settings.muted ? p.mute() : p.unMute(); }
const ytTime = () => { try { return YTS.player?.getCurrentTime?.() || 0; } catch { return 0; } };
const ytDur = () => { try { return YTS.player?.getDuration?.() || 0; } catch { return 0; } };
setInterval(() => { if (E.mode === "youtube" && !YTS.paused) onEngineTime(); }, 500);
function showYtMini(on) {
  const ytm = extOn();
  $("#ytmini").classList.toggle("ytm", ytm);
  $("#ytmini").classList.toggle("on", !!on && (E.mode === "youtube" || ytm));
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

/* friends can reuse your Google keys (you add their email as a test user) */
async function shareYtKeys() {
  try {
    const k = await api("/api/youtube/keys");
    const code = "NGM1.k." + await squeeze({ i: k.clientId, s: k.clientSecret });
    shareDialog("Share YouTube keys", "Your friend pastes this in Nagham → Enter code, then clicks Link.", code, "",
      `Before they link: open <a href="https://console.cloud.google.com/auth/audience" target="_blank" style="color:var(--accent)">Google Cloud → Audience</a> and add <b>their Gmail</b> under Test users (up to 100 people). Only share with people you trust.`);
  } catch (e) { toast(e.message); }
}
async function playYouTubeLink(vid, out, done) {
  const info = await api("/api/online/ytinfo?id=" + encodeURIComponent(vid));
  const t = ytTrack({ id: vid, snippet: { title: info.title, channelTitle: info.author, thumbnails: { high: { url: info.thumb || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` } } } });
  const id = registerOnline([t])[0];
  out.innerHTML = `<div class="share-card"><div class="art">${trackArt(id, true)}</div><div style="min-width:0;flex:1"><b>${esc(t.title)}</b><span class="muted">${esc(t.artist)}</span></div>
    <button class="btn sm ghost" id="cLike">${lib.liked.has(id) ? "Liked" : "Save to Liked"}</button><button class="btn sm accent" id="cPlay">${IC.play}Play</button></div>`;
  $("#cPlay", out).onclick = () => { playContext([id], 0, { type: "shared", id, name: "From YouTube" }); done(true); };
  $("#cLike", out).onclick = e => { if (!lib.liked.has(id)) toggleLike([id]); e.target.textContent = "Liked"; };
}
