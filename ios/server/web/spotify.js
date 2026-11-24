"use strict";
/* Nagham – Spotify (Web API via OAuth PKCE, Web Playback SDK for Premium) */

const SP = { loaded: false, configured: false, connected: false, clientId: "", user: null, premium: false, error: "", pending: false,
  redirectUri: "http://127.0.0.1:8888/callback", deviceId: null, player: null, sdkLoading: false, sdkError: "", waiting: false };
const SPP = { paused: true, pos: 0, dur: 0, at: 0, uri: null, playingUri: null, lastPos: 0, ended: false };
const SP_LOGO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><path d="M10 16.5a2 2 0 1 1-1-1.73V7.5l7-1.5v8a2 2 0 1 1-1-1.73V8.3l-5 1.07z" fill="#0b2a17"/></svg>';
const spCanStream = () => SP.connected && SP.premium && !!SP.deviceId;
const isSp = id => !!id && id.startsWith("sp:");

/* ---------------- API ---------------- */
async function spApi(path, opts = {}) {
  const r = await fetch("/api/spotify/v1" + path, { method: opts.method || "GET", headers: opts.body ? { "Content-Type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) { const msg = (await r.text()).trim(); await spRefreshStatus(); throw new Error(msg || "Your Spotify session has expired. Please connect again."); }
  if (!r.ok) throw new Error((await r.text()).trim() || "Spotify error " + r.status);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : {};
}
async function spRefreshStatus() {
  try {
    const s = await api("/api/spotify/status");
    const wasConnected = SP.connected;
    Object.assign(SP, { loaded: true, configured: s.configured, connected: s.connected, clientId: s.clientId || "", error: s.error || "", pending: s.pending, redirectUri: s.redirectUri || SP.redirectUri });
    SP.user = s.user || null;
    SP.premium = SP.user?.product === "premium";
    if (!SP.connected) { SP.deviceId = null; if (wasConnected) { for (const k in oCache) if (k.startsWith("sp:")) delete oCache[k]; } }
    if (SP.connected && SP.premium) initSdk();
    renderSpButton();
  } catch { SP.loaded = true; }
  return SP;
}

/* ---------------- normalising ---------------- */
function bestImg(images, small) {
  if (!images?.length) return null;
  const s = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return small ? (s.find(i => (i.width || 300) >= 120) || s[s.length - 1]).url : s[s.length - 1].url;
}
function spTrack(t, album) {
  if (!t || !t.id || t.type === "episode") return null;
  const al = album || t.album || {};
  return {
    id: "sp:" + t.id, src: "sp", uri: t.uri || "spotify:track:" + t.id, spotify: true, online: true,
    title: t.name, artist: (t.artists || []).map(a => a.name).join(", "), artistId: t.artists?.[0]?.id ? "spa:" + t.artists[0].id : "",
    album: al.name || "", albumId: al.id ? "spal:" + al.id : "", cover: bestImg(al.images), coverSmall: bestImg(al.images, true),
    duration: (t.duration_ms || 0) / 1000, fullDuration: (t.duration_ms || 0) / 1000, explicit: !!t.explicit,
  };
}
const spTracks = (list, album) => registerOnline((list || []).map(x => spTrack(x?.track || x?.item || x, album)).filter(Boolean));
function spPlaylistTile(p) {
  if (!p) return "";
  const total = p.tracks?.total ?? p.items?.total;
  return `<div class="tile" data-go="spplaylist:${esc(p.id)}"><div class="art">${imgHTML(proxImg(bestImg(p.images)), p.id)}</div><button class="play-big" data-playctx="spplaylist:${esc(p.id)}">${IC.play}</button>
    <div class="name"><span>${esc(p.name)}</span></div><div class="sub">${esc(p.owner?.display_name || "Spotify")}${total != null ? " • " + plural(total, "song") : ""}</div></div>`;
}
function spAlbumTile(a) {
  if (!a) return "";
  return `<div class="tile" data-go="spalbum:${esc(a.id)}"><div class="art">${imgHTML(proxImg(bestImg(a.images)), a.id, IC.disc)}</div><button class="play-big" data-playctx="spalbum:${esc(a.id)}">${IC.play}</button>
    <div class="name"><span>${esc(a.name)}</span></div><div class="sub">${esc((a.artists || []).map(x => x.name).join(", "))}${a.release_date ? " • " + esc(a.release_date.slice(0, 4)) : ""}</div></div>`;
}
function spArtistTile(a) {
  if (!a) return "";
  return `<div class="tile" data-go="spartist:${esc(a.id)}"><div class="art circle">${imgHTML(proxImg(bestImg(a.images)), a.id, IC.person)}</div><button class="play-big" data-playctx="spartist:${esc(a.id)}">${IC.play}</button>
    <div class="name"><span>${esc(a.name)}</span></div><div class="sub">Artist${a.followers?.total ? " • " + Intl.NumberFormat("en", { notation: "compact" }).format(a.followers.total) + " followers" : ""}</div></div>`;
}

/* ---------------- data loaders (shared cache with online.js) ---------------- */
const SPF = {
  async myplaylists() { const r = await spApi("/me/playlists?limit=50"); return (r.items || []).filter(Boolean); },
  async playlist(id) {
    const pl = await spApi("/playlists/" + encodeURIComponent(id));
    const page = pl.tracks || pl.items || {};
    let items = page.items || [], next = page.next, guard = 0;
    while (next && items.length < 500 && guard++ < 5) {
      const path = next.replace(/^https?:\/\/[^/]+\/v1/, "");
      const r = await spApi(path).catch(() => null); if (!r) break;
      items = items.concat(r.items || []); next = r.next;
    }
    return { pl, ids: spTracks(items) };
  },
  async album(id) { const a = await spApi("/albums/" + encodeURIComponent(id)); return { a, ids: spTracks(a.tracks?.items || [], a) }; },
  async artist(id) {
    const [a, top, albums] = await Promise.all([
      spApi("/artists/" + encodeURIComponent(id)),
      spApi(`/artists/${encodeURIComponent(id)}/top-tracks?market=from_token`).catch(() => ({ tracks: [] })),
      spApi(`/artists/${encodeURIComponent(id)}/albums?include_groups=album,single&limit=20`).catch(() => ({ items: [] })),
    ]);
    return { a, ids: spTracks(top.tracks || []), albums: albums.items || [] };
  },
  async liked() {
    let r = await spApi("/me/tracks?limit=50"), items = r.items || [], guard = 0;
    while (r.next && items.length < 300 && guard++ < 6) { r = await spApi(r.next.replace(/^https?:\/\/[^/]+\/v1/, "")).catch(() => ({})); items = items.concat(r.items || []); }
    return { ids: spTracks(items), total: r.total ?? items.length };
  },
  async home() {
    const [pls, top, recent] = await Promise.all([
      SPF.myplaylists().catch(() => []),
      spApi("/me/top/tracks?limit=20&time_range=short_term").catch(() => ({ items: [] })),
      spApi("/me/player/recently-played?limit=20").catch(() => ({ items: [] })),
    ]);
    const seen = new Set();
    const rec = spTracks((recent.items || []).map(x => x.track)).filter(id => !seen.has(id) && seen.add(id));
    oCache["sp:myplaylists"] = { data: pls, at: Date.now() };
    return { pls, top: spTracks(top.items || []), recent: rec };
  },
  async search(q) {
    const enc = encodeURIComponent(q);
    let r;
    try { r = await spApi(`/search?q=${enc}&type=track,artist,album,playlist&limit=20&market=from_token`); }
    catch { r = await spApi(`/search?q=${enc}&type=track,artist,album,playlist&limit=10`); }
    return { ids: spTracks(r.tracks?.items || []), artists: (r.artists?.items || []).filter(Boolean), albums: (r.albums?.items || []).filter(Boolean), playlists: (r.playlists?.items || []).filter(Boolean) };
  },
};
function spLoad(key, fn, ttl = 10 * 60e3) { return cacheLoad("sp:" + key, fn, ttl); }
async function spEnsure(key, fn) {
  const k = "sp:" + key;
  if (oCache[k]?.data) return oCache[k].data;
  const data = await fn(); oCache[k] = { data, at: Date.now() }; return data;
}
function spErrorNote(msg) {
  return `<div class="notice" style="border:1px solid color-mix(in srgb,#ff5c7a 40%,transparent)">${IC.info}<div><b style="color:var(--text)">Spotify: ${esc(msg)}</b></div></div>`;
}

/* ---------------- pages ---------------- */
function spHeaderStats(extra) { return extra || ""; }

VIEWS_EXTRA.spotify = () => {
  if (!SP.loaded) { spRefreshStatus().then(() => render(true)); return `<div class="pad"><div class="skeleton" style="height:200px"></div></div>`; }
  if (!SP.connected) return spConnectPage();
  const c = spLoad("home", SPF.home);
  const u = SP.user || {};
  const avatar = bestImg(u.images, true);
  let h = `<div class="pad fade-in">
    <div class="sp-profile">
      <div class="sp-avatar">${avatar ? `<img src="${esc(proxImg(avatar))}" alt="">` : esc((u.display_name || "?").slice(0, 1).toUpperCase())}</div>
      <div style="min-width:0;flex:1"><div class="kind" style="color:#1ed760">${SP_LOGO.replace("<svg", '<svg width="16" height="16"')} Connected to Spotify</div>
        <h1 class="greet" style="margin:6px 0 4px">${esc(u.display_name || u.id || "Spotify user")}</h1>
        <div class="muted" style="font-size:14px">${SP.premium ? (SP.deviceId ? "Premium • full songs play right here in Nagham" : SP.sdkError ? esc(SP.sdkError) : "Premium • getting the player ready…") : "Free account • songs play in full through YouTube (Premium plays them right here)"}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-spgo="liked">${IC.heart} Saved songs</button><button class="btn ghost sm" data-splogout>Disconnect</button></div>
    </div>`;
  if (SP.error) h += spErrorNote(SP.error);
  if (c.loading) return h + `<h2 class="sec">Your playlists</h2>${skeletonRow()}</div>`;
  if (c.error) return h + spErrorNote(c.error) + `<button class="btn accent sm" data-spretry="home">Try again</button></div>`;
  const d = c.data;
  if (d.recent.length) { setList("sprecent", d.recent, { type: "sprecent", id: "", name: "Recently played on Spotify" }); h += `<h2 class="sec">Recently played</h2><div class="row-scroll">${d.recent.map((id, i) => songTile(id, "sprecent", i)).join("")}</div>`; }
  h += `<h2 class="sec">Your playlists <span class="hint">${plural(d.pls.length, "playlist")}</span></h2>`;
  h += d.pls.length ? `<div class="grid">${d.pls.map(spPlaylistTile).join("")}</div>` : `<p class="muted">No playlists on this account yet.</p>`;
  if (d.top.length) h += `<h2 class="sec">Your top songs lately</h2>${trackTable(d.top, { ctx: { type: "sptop", id: "", name: "Your top songs" }, key: "sptop" })}`;
  return h + "</div>";
};

document.addEventListener("click", e => { if (e.target.closest("[data-spopenlink]")) { const v = ($("#spPlLink")?.value || "").trim(); if (!v) return $("#spPlLink")?.focus(); window.colOpenLink?.(v); } });
document.addEventListener("keydown", e => { if (e.target.id === "spPlLink" && e.key === "Enter") { const v = e.target.value.trim(); if (v) window.colOpenLink?.(v); } });
(() => { const st = document.createElement("style"); st.textContent = `.sp-two{display:grid;grid-template-columns:1fr;gap:14px;margin-top:16px}.sp-box{margin:0!important}.sp-box-h{display:flex;gap:12px;align-items:flex-start;margin-bottom:6px}
.sp-box-n{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#1ed760;color:#0b2a17;font-weight:900;flex:none}.sp-box-link{border:1px solid color-mix(in srgb,#1ed760 45%,transparent)}`; document.head.appendChild(st); })();
function spConnectPage() { return `<div class="pad fade-in" style="max-width:860px">${spSetupCard()}</div>`; }
function spSetupCard() {
  const s = SP;
  const step = (n, title, body) => `<div class="sp-step stagger" style="--i:${n}"><div class="sp-num">${n}</div><div style="min-width:0;flex:1"><b>${title}</b><div class="muted" style="font-size:13.5px;margin-top:4px;line-height:1.55">${body}</div></div></div>`;
  return `
    <div class="sp-hero">
      <div class="sp-logo-big">${SP_LOGO}</div>
      <div><h1 class="greet" style="margin:0 0 6px;font-size:26px">Link Spotify</h1>
      <p class="muted" style="margin:0">Search Spotify, see album art and open your playlists inside Nagham. With Premium, songs play in full right here.</p></div>
    </div>
    ${s.error ? `<div class="sp-error"><b>Couldn't connect</b><span>${esc(s.error)}</span></div>` : ""}
    ${s.waiting || s.pending ? `<div class="sp-wait"><div class="spin" style="width:22px;height:22px"></div><div style="flex:1"><b>Waiting for you to log in to Spotify…</b><div class="muted" style="font-size:13px;margin-top:3px">Finish in the Spotify window. If Spotify says <i>INVALID_CLIENT: Invalid redirect URI</i>, check step 2.</div></div>
      <button class="btn ghost sm" data-splogin="browser">Use my browser</button><button class="btn ghost sm" data-spcancel>Cancel</button></div>` : ""}
    <div class="sp-two">
    <div class="settings-sec sp-box sp-box-link">
      <div class="sp-box-h"><span class="sp-box-n">A</span><div><b>Download a playlist — no account needed</b><div class="muted" style="font-size:13.5px;margin-top:3px">Paste a link to any Spotify playlist or album (also YouTube Music, Deezer, Apple Music). Nagham lists its songs and downloads them all as a Nagham playlist.</div></div></div>
      <div class="field"><input class="input" id="spPlLink" placeholder="https://open.spotify.com/playlist/…" spellcheck="false" autocomplete="off"><button class="btn sm accent" data-spopenlink>Open</button></div>
      <div class="muted" style="font-size:12.5px;margin-top:8px">Without linking, Spotify shows up to 100 songs of a playlist, and only public ones (in Spotify: ⋯ → Share → Copy link).</div>
    </div>
    <div class="settings-sec sp-box">
      <div class="sp-box-h"><span class="sp-box-n">B</span><div><b>Link your Spotify account</b><div class="muted" style="font-size:13.5px;margin-top:3px">All your playlists and saved songs inside Nagham. Spotify only allows this through a free developer app — 4 short steps, once.</div></div></div>
      ${step(1, "Create a free Spotify app", `Open <a href="https://developer.spotify.com/dashboard" target="_blank" style="color:var(--accent)">developer.spotify.com/dashboard</a>, log in and click <b>Create app</b>. Any name works (for example “Nagham”).`)}
      ${step(2, "Add this Redirect URI", `<div class="code-box" style="margin:8px 0 4px"><code>${esc(s.redirectUri)}</code><button class="btn sm ghost" data-copy="${esc(s.redirectUri)}">${IC.copy}Copy</button></div>Paste it exactly as shown, then tick <b>Web API</b> and <b>Web Playback SDK</b> and save.`)}
      ${step(3, "Paste your Client ID", `Find it on your app's <b>Settings</b> page. Nagham never asks for the Client Secret — it uses secure PKCE login instead.
        <div class="field"><input class="input" id="spClientId" placeholder="32-character Client ID" value="${esc(s.clientId)}" spellcheck="false" maxlength="40"><button class="btn sm ${s.configured ? "ghost" : "accent"}" data-spsave>${s.configured ? "Update" : "Save"}</button></div>`)}
      ${step(4, "Log in", `<button class="btn accent sp-connect" data-splogin ${s.configured ? "" : "disabled"}>${SP_LOGO.replace("<svg", '<svg width="18" height="18"')}Connect with Spotify</button>
        <div style="margin-top:8px">New Spotify apps start in development mode: add each listener's Spotify email under <b>User Management</b> in your app, or they'll see an error.</div>`)}
    </div></div>`;
}

VIEWS_EXTRA.spplaylist = (id) => {
  const c = spLoad("pl:" + id, () => SPF.playlist(id));
  if (c.loading) return `<div class="pad"><div class="skeleton" style="width:220px;height:220px"></div></div>`;
  if (c.error) return `<div class="pad">${spErrorNote(c.error)}</div>`;
  const { pl, ids } = c.data;
  const img = proxImg(bestImg(pl.images));
  const desc = (pl.description || "").replace(/<[^>]+>/g, "");
  return hero({ kind: "Playlist", title: pl.name, key: pl.id, coverSrc: img, artHTML: imgHTML(img, pl.id),
    stats: `${desc ? `<div style="opacity:.8;margin-bottom:6px">${esc(desc)}</div>` : ""}${spHeaderStats(esc(pl.owner?.display_name || ""))} • ${plural(ids.length, "song")}, ${fmtLong(totalDur(ids))}` })
    + `<div class="under-hero">${actions("spplaylist:" + id, `<button class="icon-btn" data-shareids="sppl" title="Share as playlist code">${IC.share}</button><button class="icon-btn" data-spsave-pl="${esc(id)}" title="Copy into a Nagham playlist">${IC.plus}</button><button class="icon-btn" data-lplmenu="spplaylist|${esc(id)}" title="More options">${IC.dots.replace('width="17" height="17"', "")}</button>`)}${trackTable(ids, { ctx: { type: "spplaylist", id, name: pl.name }, key: "sppl", sortKey: "sppl:" + id })}</div>`;
};
VIEWS_EXTRA.spalbum = (id) => {
  const c = spLoad("al:" + id, () => SPF.album(id));
  if (c.loading) return `<div class="pad"><div class="skeleton" style="width:220px;height:220px"></div></div>`;
  if (c.error) return `<div class="pad">${spErrorNote(c.error)}</div>`;
  const { a, ids } = c.data;
  const img = proxImg(bestImg(a.images));
  const ar = a.artists?.[0];
  return hero({ kind: "Album", title: a.name, key: a.id, coverSrc: img, artHTML: imgHTML(img, a.id, IC.disc),
    stats: `${ar ? `<a data-go="spartist:${esc(ar.id)}">${esc(ar.name)}</a> • ` : ""}${esc((a.release_date || "").slice(0, 4))} • ${plural(ids.length, "song")}` })
    + `<div class="under-hero">${actions("spalbum:" + id, `<button class="icon-btn" data-shareids="spal" title="Share as playlist code">${IC.share}</button>`)}${trackTable(ids, { ctx: { type: "spalbum", id, name: a.name }, key: "spal", compact: true, noArt: true })}</div>`;
};
VIEWS_EXTRA.spartist = (id) => {
  const c = spLoad("ar:" + id, () => SPF.artist(id));
  if (c.loading) return `<div class="pad"><div class="skeleton" style="width:220px;height:220px;border-radius:50%"></div></div>`;
  if (c.error) return `<div class="pad">${spErrorNote(c.error)}</div>`;
  const { a, ids, albums } = c.data;
  const img = proxImg(bestImg(a.images));
  return hero({ kind: "Artist", title: a.name, key: a.id, coverSrc: img, circle: true, artHTML: imgHTML(img, a.id, IC.person),
    stats: `${a.followers?.total ? Intl.NumberFormat("en").format(a.followers.total) + " followers • " : ""}${(a.genres || []).slice(0, 3).map(esc).join(", ")}` })
    + `<div class="under-hero">${actions("spartist:" + id)}<h2 class="sec" style="margin:0 28px 12px">Popular</h2>${trackTable(ids, { ctx: { type: "spartist", id, name: a.name }, key: "spar" })}
    ${albums.length ? `<div style="padding:0 28px 28px"><h2 class="sec">Albums & singles</h2><div class="grid">${albums.map(spAlbumTile).join("")}</div></div>` : ""}</div>`;
};
VIEWS_EXTRA.spliked = () => {
  const c = spLoad("liked", SPF.liked);
  if (c.loading) return `<div class="pad"><div class="skeleton" style="width:220px;height:220px"></div></div>`;
  if (c.error) return `<div class="pad">${spErrorNote(c.error)}</div>`;
  const { ids, total } = c.data;
  return hero({ kind: "Playlist", title: "Saved songs", artHTML: likedArt(), stats: `${plural(total, "song")}` })
    + `<div class="under-hero">${actions("spliked:")}${trackTable(ids, { ctx: { type: "spliked", id: "", name: "Saved songs" }, key: "splk" })}</div>`;
};

function spSearchHTML(q, filter) {
  if (!SP.connected) return "";
  const c = spLoad("search:" + q.toLowerCase(), () => SPF.search(q), 10 * 60e3);
  const head = `<h2 class="sec"><span style="display:flex;gap:10px;align-items:center"><span style="color:#1ed760;width:24px">${SP_LOGO}</span>Spotify</span></h2>`;
  if (c.loading) return head + skeletonRow(5);
  if (c.error) return head + spErrorNote(c.error);
  const d = c.data;
  let h = head;
  if (d.ids.length) h += trackTable(filter === "spotify" ? d.ids : d.ids.slice(0, 8), { ctx: { type: "search", id: q + ":sp", name: `“${q}” on Spotify` }, key: "spsearch", noHead: true });
  if (d.artists.length) h += `<h2 class="sec" style="font-size:18px">Artists</h2><div class="row-scroll">${d.artists.map(spArtistTile).join("")}</div>`;
  if (d.albums.length) h += `<h2 class="sec" style="font-size:18px">Albums</h2><div class="row-scroll">${d.albums.map(spAlbumTile).join("")}</div>`;
  if (d.playlists.length) h += `<h2 class="sec" style="font-size:18px">Playlists</h2><div class="row-scroll">${d.playlists.map(spPlaylistTile).join("")}</div>`;
  if (h === head) h += `<p class="muted">No Spotify results for “${esc(q)}”.</p>`;
  return h;
}

/* context helpers used by app.js */
function spCtxTracks(type, id) {
  const m = { spplaylist: "pl:" + id, spalbum: "al:" + id, spartist: "ar:" + id, spliked: "liked" }[type];
  if (type === "sptop") return oCache["sp:home"]?.data?.top || [];
  if (type === "sprecent") return oCache["sp:home"]?.data?.recent || [];
  return m ? (oCache["sp:" + m]?.data?.ids || []) : null;
}
async function spPlayCtx(type, id, shuffled) {
  try {
    const data = type === "spplaylist" ? await spEnsure("pl:" + id, () => SPF.playlist(id))
      : type === "spalbum" ? await spEnsure("al:" + id, () => SPF.album(id))
      : type === "spartist" ? await spEnsure("ar:" + id, () => SPF.artist(id))
      : await spEnsure("liked", SPF.liked);
    const ids = data.ids; if (!ids.length) return toast("Nothing to play here");
    const name = data.pl?.name || data.a?.name || "Liked on Spotify";
    playContext(ids, shuffled ? Math.floor(Math.random() * ids.length) : 0, { type, id, name });
  } catch (e) { toast(e.message); }
}

/* ---------------- connect / login flow ---------------- */
let spPollT = null, spPopup = null;
async function spStartLogin(browser) {
  try {
    const r = await api("/api/spotify/login", { browser: !!browser });
    SP.error = ""; SP.waiting = true;
    if (!browser) {
      spPopup = window.open(r.url, "nagham-spotify", "width=520,height=780");
      if (!spPopup) await api("/api/spotify/login", { browser: true }); // popup blocked: use the system browser
    }
    render(true); spPoll(Date.now());
  } catch (e) { SP.error = e.message; SP.waiting = false; render(true); }
}
function spPoll(started) {
  clearTimeout(spPollT);
  spPollT = setTimeout(async () => {
    await spRefreshStatus();
    if (SP.connected) {
      SP.waiting = false; spPopup?.close?.();
      toast(`Connected to Spotify as ${SP.user?.display_name || SP.user?.id || "you"}`);
      renderLib(); render(true); return;
    }
    if (SP.error) { SP.waiting = false; render(true); return; }
    if (Date.now() - started > 10 * 60e3) { SP.waiting = false; SP.error = "The login took too long. Click Connect to try again."; render(true); return; }
    spPoll(started);
  }, 1500);
}
$("#view").addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("[data-spsave]")) {
    const v = $("#spClientId").value.trim();
    try { await api("/api/spotify/config", { clientId: v }); await spRefreshStatus(); toast("Client ID saved"); render(true); }
    catch (err) { SP.error = err.message; render(true); }
    return;
  }
  const lg = t.closest("[data-splogin]"); if (lg) { spStartLogin(lg.dataset.splogin === "browser"); return; }
  if (t.closest("[data-spcancel]")) { clearTimeout(spPollT); SP.waiting = false; spPopup?.close?.(); render(true); return; }
  if (t.closest("[data-splogout]")) { spDisconnect(); return; }
  const cp = t.closest("[data-copy]"); if (cp) { copyText(cp.dataset.copy, "Copied"); return; }
  const g = t.closest("[data-spgo]"); if (g) { go("sp" + g.dataset.spgo); return; }
  const rt = t.closest("[data-spretry]"); if (rt) { delete oCache["sp:" + rt.dataset.spretry]; render(true); return; }
  const sv = t.closest("[data-spsave-pl]");
  if (sv) {
    const d = oCache["sp:pl:" + sv.dataset.spsavePl]?.data; if (!d) return;
    const p = { id: uid(), name: d.pl.name, tracks: [...d.ids], created: Date.now() };
    lib.playlists.push(p); saveUser(); renderLib(); toast(`Copied “${p.name}” to Your Library`);
  }
});
$("#view").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "spClientId") $("[data-spsave]")?.click(); });
async function spDisconnect() {
  if (!await confirm_("Disconnect Spotify?", "Nagham will forget your Spotify login. Your Nagham playlists stay.", "Disconnect")) return;
  await api("/api/spotify/logout", {}).catch(() => {});
  try { SP.player?.disconnect(); } catch {}
  SP.player = null; SP.deviceId = null; SP.sdkLoading = false;
  if (E.mode === "spotify") { E.mode = "audio"; SPP.paused = true; onEnginePause(); }
  await spRefreshStatus(); renderLib(); render(true); toast("Spotify disconnected");
}

/* top-bar account button */
function renderSpButton() {
  const b = $("#spBtn"); if (!b) return;
  if (SP.connected) {
    const av = bestImg(SP.user?.images, true);
    b.className = "pill sp-pill on-sp";
    b.innerHTML = av ? `<img src="${esc(proxImg(av))}" alt="">` : `<span class="sp-ini">${esc((SP.user?.display_name || "S").slice(0, 1).toUpperCase())}</span>`;
    b.innerHTML += `<span class="lbl">${esc(SP.user?.display_name || "Spotify")}</span>`;
    b.title = "Spotify account";
  } else {
    b.className = "pill sp-pill";
    b.innerHTML = `<span class="sp-ico">${SP_LOGO}</span><span class="lbl">Connect Spotify</span>`;
    b.title = "Connect your Spotify account";
  }
}
if ($("#spBtn")) $("#spBtn").onclick = e => {
  if (!SP.connected) { go("spotify"); return; }
  const r = e.currentTarget.getBoundingClientRect();
  menu(r.right - 220, r.bottom + 6, [
    { label: "Open Spotify page", icon: SP_LOGO, act: () => go("spotify") },
    { label: "Liked on Spotify", icon: IC.heart, act: () => go("spliked") },
    "-",
    { label: "Disconnect", icon: IC.trash, act: spDisconnect },
  ]);
};

/* ---------------- Web Playback SDK (Premium) ---------------- */
function initSdk() {
  if (SP.player || SP.sdkLoading) return;
  SP.sdkLoading = true; SP.sdkError = "";
  window.onSpotifyWebPlaybackSDKReady = () => {
    const player = new Spotify.Player({
      name: "Nagham",
      getOAuthToken: cb => fetch("/api/spotify/token").then(r => r.ok ? r.json() : Promise.reject()).then(d => cb(d.accessToken)).catch(() => spRefreshStatus()),
      volume: settings.muted ? 0 : settings.volume,
    });
    SP.player = player;
    player.addListener("ready", ({ device_id }) => { SP.deviceId = device_id; SP.sdkError = ""; refreshSpViews(); });
    player.addListener("not_ready", () => { SP.deviceId = null; refreshSpViews(); });
    player.addListener("initialization_error", ({ message }) => { SP.sdkError = "This computer can't play Spotify in Nagham (" + message + "). Songs open in YouTube Music instead."; SP.player = null; refreshSpViews(); });
    player.addListener("authentication_error", () => { SP.deviceId = null; spRefreshStatus(); });
    player.addListener("account_error", () => { SP.premium = false; SP.deviceId = null; SP.sdkError = "Full playback needs Spotify Premium."; refreshSpViews(); toast("Full Spotify playback needs Premium — songs open in YouTube Music instead"); });
    player.addListener("playback_error", ({ message }) => { console.warn("spotify playback", message); });
    player.addListener("player_state_changed", spOnState);
    player.connect();
  };
  const s = document.createElement("script");
  s.src = "https://sdk.scdn.co/spotify-player.js"; s.async = true;
  s.onerror = () => { SP.sdkLoading = false; SP.sdkError = "Couldn't load the Spotify player. Songs open in YouTube Music instead."; refreshSpViews(); };
  document.head.appendChild(s);
}
function refreshSpViews() {
  const v = nav.stack[nav.idx]?.view;
  if (v && (v.startsWith("sp") || v === "search")) render(true);
  renderNP();
}
function spOnState(state) {
  if (!state) { if (E.mode === "spotify" && !SPP.paused) { SPP.paused = true; onEnginePause(); } return; }
  const tr = state.track_window?.current_track;
  const wasPaused = SPP.paused;
  SPP.paused = state.paused; SPP.pos = state.position / 1000; SPP.dur = state.duration / 1000; SPP.at = performance.now(); SPP.uri = tr?.uri;
  if (E.mode !== "spotify") return;
  const finished = state.paused && state.position === 0 && !SPP.ended &&
    ((state.track_window?.previous_tracks || []).some(t => t.uri === SPP.playingUri) || SPP.lastPos > SPP.dur - 3);
  if (finished) { SPP.ended = true; next(true); return; }
  if (wasPaused !== SPP.paused) SPP.paused ? onEnginePause() : onEnginePlay();
  onEngineTime();
}
function spPos() { return SPP.paused ? SPP.pos : Math.min(SPP.dur || Infinity, SPP.pos + (performance.now() - SPP.at) / 1000); }
setInterval(() => { if (E.mode === "spotify" && !SPP.paused) { SPP.lastPos = spPos(); onEngineTime(); } }, 500);
async function spPlayUri(uri, startAt = 0) {
  SPP.playingUri = uri; SPP.ended = false; SPP.lastPos = 0; SPP.pos = startAt; SPP.dur = 0; SPP.at = performance.now();
  try { SP.player?.activateElement?.(); } catch {}
  await spApi(`/me/player/play?device_id=${encodeURIComponent(SP.deviceId)}`, { method: "PUT", body: { uris: [uri], position_ms: Math.round(startAt * 1000) } });
}
const spSeek = v => { SP.player?.seek(Math.round(v * 1000)); SPP.pos = v; SPP.at = performance.now(); };
const spResume = () => SP.player?.resume();
const spPauseSdk = () => SP.player?.pause();
function spSetVolume(v) { try { SP.player?.setVolume(v); } catch {} }

/* songs that can't stream in full: find the same song as a preview */
async function spFallback(id) {
  const t = T(id); if (!t) return null;
  if (t.fallback && T(t.fallback)) return t.fallback;
  const best = await findOnline(t.title, (t.artist || "").split(",")[0]).catch(() => null);
  t.fallback = best?.id || null;
  return t.fallback;
}
async function spGetTrack(id) {
  const t = await spApi("/tracks/" + encodeURIComponent(id.replace(/^sp:/, "")));
  return registerOnline([spTrack(t)])[0];
}
