"use strict";
/* Nagham – songs from around the world (Deezer + Apple previews, Audius full songs) */

const COUNTRIES = { sa: "Saudi Arabia", ae: "UAE", kw: "Kuwait", qa: "Qatar", bh: "Bahrain", om: "Oman", eg: "Egypt", jo: "Jordan", ma: "Morocco", iq: "Iraq", tr: "Türkiye", us: "USA", gb: "UK", fr: "France", de: "Germany", in: "India", jp: "Japan", kr: "South Korea", br: "Brazil" };
const oCache = {}; // key -> {data, at} | {loading:true} | {error}

/* load something once and re-render the page that needs it.
   Never leaves a page on a grey placeholder: slow loads time out with a "try again",
   a load that somehow never finished is started again, and any finished load
   refreshes a page that is still showing placeholders. */
function cacheLoad(k, fn, ttl, keepErr = 20000) {
  const c = oCache[k];
  if (c && c.loading && Date.now() - (c.started || 0) < 30000) return c;
  if (c && !c.loading && (c.error || Date.now() - c.at < ttl)) return c;
  oCache[k] = { loading: true, started: Date.now() };
  const forView = nav.stack[nav.idx];
  const mine = oCache[k];
  Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("This is taking too long — check your connection and try again.")), 25000))])
    .then(data => { if (oCache[k] === mine) oCache[k] = { data, at: Date.now() }; })
    .catch(err => { if (oCache[k] !== mine) return; oCache[k] = { error: err?.message || "offline", at: Date.now() }; setTimeout(() => { if (oCache[k]?.error) delete oCache[k]; }, keepErr); })
    .finally(() => {
      try {
        const cur = nav.stack[nav.idx];
        const same = cur && forView && cur.view === forView.view && String(cur.arg ?? "") === String(forView.arg ?? "");
        if (same || $("#view .skeleton")) render(true); else renderLib();
      } catch (e) { postLog("render after load " + k + ": " + (e.stack || e)); }
    });
  return oCache[k];
}
function oLoad(key, url, ttl = 20 * 60e3) {
  return cacheLoad(key, () => fetch(url).then(async r => { if (!r.ok) throw new Error((await r.text()) || r.statusText); return r.json(); }), ttl, 15000);
}
/* safety net: a page still on placeholders whose data has arrived gets drawn */
let skelWatch = { key: "", n: 0 };
setInterval(() => {
  if (!$("#view .skeleton") || document.hidden) return;
  const cur = nav.stack[nav.idx] || {}, key = nav.idx + "|" + cur.view + "|" + (cur.arg ?? "");
  if (skelWatch.key !== key) skelWatch = { key, n: 0 };
  const busy = Object.values(oCache).some(c => c?.loading && Date.now() - (c.started || 0) < 30000);
  if (!busy && skelWatch.n++ < 6) { try { render(true); } catch (e) { postLog("skeleton watchdog: " + (e.stack || e)); } }
}, 3000);

function skeletonRow(n = 6) { return `<div class="row-scroll">${Array.from({ length: n }, () => `<div class="tile"><div class="art skeleton"></div><div class="skeleton" style="height:14px;margin-top:12px;width:80%"></div><div class="skeleton" style="height:12px;margin-top:8px;width:55%"></div></div>`).join("")}</div>`; }
function offlineNote(msg) {
  return `<div class="notice">${IC.globe}<div><b style="color:var(--text)">Can't reach the online catalogue right now.</b><br>Check your internet connection. Your own music still works offline. <span style="opacity:.6">(${esc(msg || "")})</span></div></div>`;
}

/* tiles */
function songTile(id, listKey, i) {
  const t = T(id); if (!t) return "";
  return `<div class="tile" data-playlist-key="${listKey}" data-idx="${i}"><div class="art">${trackArt(id)}</div><button class="play-big" data-playlistplay="${listKey}" data-idx="${i}">${IC.play}</button>
    <div class="name"><span>${esc(t.title)}</span>${badge(t)}</div><div class="sub">${esc(t.artist)}</div></div>`;
}
function oAlbumTile(a) {
  return `<div class="tile" data-go="oalbum:${esc(a.id)}"><div class="art">${imgHTML(proxImg(a.cover), a.id, IC.disc)}</div><button class="play-big" data-playoalbum="${esc(a.id)}">${IC.play}</button><div class="name"><span>${esc(a.title)}</span></div><div class="sub">${esc(a.artist)}${a.release ? " • " + esc(a.release.slice(0, 4)) : ""}</div></div>`;
}
function oArtistTile(a) {
  return `<div class="tile" data-go="oartist:${esc(a.id)}"><div class="art circle">${imgHTML(proxImg(a.picture), a.id, IC.person)}</div><div class="name"><span>${esc(a.name)}</span></div><div class="sub">${isFollowing(a.id) ? '<b style="color:var(--accent)">Following</b> • ' : ""}Artist${a.fans ? " • " + Intl.NumberFormat("en", { notation: "compact" }).format(a.fans) + " fans" : ""}</div></div>`;
}

/* lists of online songs that tiles can play from */
const playLists = {};
function setList(key, ids, ctxInfo) { playLists[key] = { ids, ctx: ctxInfo }; return key; }
$("#view").addEventListener("click", e => {
  const pb = e.target.closest("[data-playlistplay]");
  const tile = pb || e.target.closest("[data-playlist-key]");
  if (tile) {
    e.stopPropagation();
    const L = playLists[tile.dataset.playlistplay || tile.dataset.playlistKey]; if (!L) return;
    const i = +tile.dataset.idx;
    if (L.ids[i] === P.current && pb) { togglePlay(); return; }
    playContext(L.ids, i, L.ctx);
    return;
  }
  const oa = e.target.closest("[data-playoalbum]");
  if (oa) { e.stopPropagation(); playOnlineAlbum(oa.dataset.playoalbum); }
}, true);

async function playOnlineAlbum(id) {
  try {
    const r = await api("/api/online/album?id=" + encodeURIComponent(id) + "&country=" + settings.country);
    const ids = registerOnline(r.tracks);
    if (!ids.length) return toast("This album has no playable songs");
    oCache["album:" + id] = { data: r, at: Date.now() };
    playContext(ids, 0, { type: "oalbum", id, name: r.album.title });
  } catch (err) { toast("Couldn't load album: " + err.message); }
}

/* ---------------- World music page ---------------- */
VIEWS_EXTRA.discover = () => {
  const c = oLoad("home:" + settings.country, "/api/online/home?country=" + settings.country);
  const country = COUNTRIES[settings.country] || settings.country.toUpperCase();
  let h = `<div class="pad fade-in">
    <h1 class="greet">Top songs & new releases</h1>`;
  if (c.loading) return h + `<h2 class="sec">Top songs worldwide</h2>${skeletonRow()}<h2 class="sec">New releases</h2>${skeletonRow()}</div>`;
  if (c.error) return h + offlineNote(c.error) + `<div class="row-gap" style="justify-content:flex-start"><button class="btn accent" data-retry="home:${settings.country}">Try again</button></div></div>`;
  const d = c.data || {};
  if (d.chart?.length) {
    const ids = registerOnline(d.chart);
    setList("world", ids, { type: "chart", id: "world", name: "Worldwide top 50" });
    h += `<h2 class="sec">Top songs worldwide</h2><div class="row-scroll">${ids.slice(0, 20).map((id, i) => songTile(id, "world", i)).join("")}</div>`;
  }
  if (d.releases?.length) h += `<h2 class="sec">New releases <span class="hint">Updated every day</span></h2><div class="row-scroll">${d.releases.map(oAlbumTile).join("")}</div>`;
  if (d.chart?.length) {
    const ids = registerOnline(d.chart);
    h += `<h2 class="sec">Worldwide top 50</h2>${trackTable(ids, { ctx: { type: "chart", id: "world", name: "Worldwide top 50" }, key: "world" })}`;
  }
  if (d.full?.length) {
    const ids = registerOnline(d.full);
    setList("full", ids, { type: "chart", id: "full", name: "Trending full songs" });
    h += `<h2 class="sec">Trending now</h2><div class="row-scroll">${ids.map((id, i) => songTile(id, "full", i)).join("")}</div>`;
  }
  if (!d.local?.length && !d.chart?.length && !d.releases?.length && !d.full?.length) h += offlineNote("no data");
  return h + "</div>";
};
$("#view").addEventListener("click", e => {
  const r = e.target.closest("[data-retry]"); if (!r) return;
  delete oCache[r.dataset.retry]; render(true);
});

/* ---------------- online album ---------------- */
VIEWS_EXTRA.oalbum = (id) => {
  const c = oLoad("album:" + id, "/api/online/album?id=" + encodeURIComponent(id) + "&country=" + settings.country, 60 * 60e3);
  if (c.loading) return `<div class="pad"><div class="skeleton" style="width:220px;height:220px"></div></div>`;
  if (c.error) return `<div class="pad">${offlineNote(c.error)}</div>`;
  const { album, tracks, artistId } = c.data;
  const ids = registerOnline(tracks);
  const artistLink = artistId ? `<a data-go="oartist:${esc(artistId)}">${esc(album.artist)}</a>` : `<b>${esc(album.artist)}</b>`;
  return hero({ kind: `Album ${IC.globe.replace("<svg", '<svg width="14" height="14"')}`, title: album.title, key: album.id, coverSrc: proxImg(album.cover), artHTML: imgHTML(proxImg(album.cover), album.id, IC.disc),
    stats: `${artistLink}${album.release ? " • " + esc(album.release.slice(0, 4)) : ""} • ${plural(ids.length, "song")}` })
    + `<div class="under-hero">${actions("oalbum:" + id, `<button class="icon-btn" data-shareids="oalbum" title="Share as playlist code">${IC.share}</button>`)}${trackTable(ids, { ctx: { type: "oalbum", id, name: album.title }, compact: true, noArt: true, albumNums: true, key: "oalbum" })}</div>`;
};

/* ---------------- online artist: popular songs, every song, every album / single ---------------- */
const OART = { id: "", tab: "popular" };
const RELTYPE = { album: "Album", single: "Single", ep: "EP", compile: "Compilation" };
function oReleaseTile(a) {
  return `<div class="tile" data-go="oalbum:${esc(a.id)}"><div class="art">${imgHTML(proxImg(a.cover), a.id, IC.disc)}</div><button class="play-big" data-playoalbum="${esc(a.id)}">${IC.play}</button><div class="name"><span>${esc(a.title)}</span></div><div class="sub">${a.artistId && a.artist ? esc(a.artist) + " • " : ""}${a.release ? esc(a.artistId ? a.release.slice(5).replace("-", "/") : a.release.slice(0, 4)) + " • " : ""}${RELTYPE[a.type] || "Album"}${a.tracks > 1 ? " • " + a.tracks + " songs" : ""}</div></div>`;
}
function artistSongsLoad(id) { return oLoad("artistsongs:" + id, "/api/online/artistsongs?id=" + encodeURIComponent(id), 2 * 60 * 60e3); }
VIEWS_EXTRA.oartist = (id) => {
  if (OART.id !== id) { OART.id = id; OART.tab = "popular"; }
  const c = oLoad("artist:" + id, "/api/online/artist?id=" + encodeURIComponent(id) + "&country=" + settings.country, 60 * 60e3);
  if (c.loading) return `<div class="pad"><div class="skeleton" style="width:220px;height:220px;border-radius:50%"></div></div>`;
  if (c.error) return `<div class="pad">${offlineNote(c.error)}</div>`;
  const { artist, tracks, albums = [] } = c.data;
  const ids = registerOnline(tracks);
  const pic = proxImg(artist.picture) || (ids[0] && coverOf(ids[0]));
  const full = albums.filter(a => a.type !== "single" && a.type !== "ep");
  const singles = albums.filter(a => a.type === "single" || a.type === "ep");
  const all = id.startsWith("dz:") ? artistSongsLoad(id) : null;
  const allN = all?.data?.tracks?.length;
  const tab = OART.tab;
  followRefresh({ id, name: artist.name, picture: artist.picture });
  const tabs = [["popular", "Popular"], ...(all ? [["songs", "All songs" + (allN ? ` <span class="cnt">${allN}</span>` : "")]] : []),
    ...(full.length ? [["albums", `Albums <span class="cnt">${full.length}</span>`]] : []), ...(singles.length ? [["singles", `Singles & EPs <span class="cnt">${singles.length}</span>`]] : [])];
  let body = "";
  if (tab === "songs" && all) {
    if (all.loading && !all.data) body = `<div class="art-gather"><div class="spin"></div>Gathering every song from all ${albums.length} albums and singles…</div>${skeletonRow(4)}`;
    else if (all.error && !all.data) body = offlineNote(all.error);
    else {
      const sids = registerOnline(all.data.tracks || []);
      body = `<div class="art-head">${actions("oartistall:" + id)}<span class="muted">${plural(sids.length, "song")} from ${all.data.albums || albums.length} albums and singles, each song once, newest first</span></div>`
        + trackTable(sids, { ctx: { type: "oartistall", id, name: artist.name + " — all songs" }, key: "oartistall" });
    }
  } else if (tab === "albums") body = `<div class="grid">${full.map(oReleaseTile).join("")}</div>`;
  else if (tab === "singles") body = `<div class="grid">${singles.map(oReleaseTile).join("")}</div>`;
  else {
    const latest = albums[0];
    body = `${actions("oartist:" + id)}`
      + (latest ? `<div class="art-latest" data-go="oalbum:${esc(latest.id)}"><div class="art">${imgHTML(proxImg(latest.cover), latest.id, IC.disc)}</div><div><div class="muted" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Latest release</div><div style="font-weight:800;font-size:18px;margin:2px 0">${esc(latest.title)}</div><div class="muted">${esc((latest.release || "").slice(0, 10))} • ${RELTYPE[latest.type] || "Album"}${latest.tracks > 1 ? " • " + latest.tracks + " songs" : ""}</div></div></div>` : "")
      + `<h2 class="sec">Popular</h2>${trackTable(ids, { ctx: { type: "oartist", id, name: artist.name }, key: "oartist" })}`
      + (full.length ? `<h2 class="sec">Albums ${full.length > 6 ? `<a data-oarttab="albums">Show all ${full.length}</a>` : ""}</h2><div class="row-scroll">${full.slice(0, 12).map(oReleaseTile).join("")}</div>` : "")
      + (singles.length ? `<h2 class="sec">Singles & EPs ${singles.length > 6 ? `<a data-oarttab="singles">Show all ${singles.length}</a>` : ""}</h2><div class="row-scroll">${singles.slice(0, 12).map(oReleaseTile).join("")}</div>` : "")
      + (all ? `<div style="margin-top:18px"><button class="btn" data-oarttab="songs">${IC.list || ""} See every song${allN ? ` (${allN})` : ""}</button></div>` : "");
  }
  return hero({ kind: `Artist ${IC.globe.replace("<svg", '<svg width="14" height="14"')}`, title: artist.name || "Artist", key: id, coverSrc: pic, circle: true, artHTML: imgHTML(pic, id, IC.person),
    stats: `${artist.fans ? Intl.NumberFormat("en").format(artist.fans) + " fans • " : ""}${albums.length ? plural(full.length, "album") + " • " + plural(singles.length, "single") : plural(ids.length, "popular song")}` })
    + `<div class="under-hero"><div class="chips art-tabs">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? "on" : ""}" data-oarttab="${k}">${l}</button>`).join("")}<span style="flex:1"></span>${followBtn({ id, name: artist.name, picture: artist.picture })}</div><div class="art-body">${body}</div></div>`;
};
$("#view").addEventListener("click", e => {
  const b = e.target.closest("[data-oarttab]"); if (!b) return;
  e.preventDefault(); OART.tab = b.dataset.oarttab; render(true);
  if (OART.tab !== "popular") $("#view .art-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" });
});

/* ---------------- following artists ---------------- */
function follows() { return Array.isArray(settings.follows) ? settings.follows : (settings.follows = []); }
function isFollowing(id) { return follows().some(f => f.id === id); }
function followBtn(a) {
  if (!a?.id) return "";
  const on = isFollowing(a.id);
  return `<button class="follow-btn ${on ? "on" : ""}" data-follow="${esc(a.id)}" data-fname="${esc(a.name || "")}" data-fpic="${esc(a.picture || "")}">${on ? "Following" : "Follow"}</button>`;
}
function toggleFollow(id, name, picture) {
  const list = follows(), i = list.findIndex(f => f.id === id);
  if (i >= 0) { list.splice(i, 1); toast(`Unfollowed ${name || "artist"}`); }
  else { list.unshift({ id, name, picture, at: Date.now() }); toast(`Following ${name || "artist"} — their new music shows on Home`); }
  delete oCache["fresh"];
  saveUser(); renderLib(); render(true);
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-follow]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  toggleFollow(b.dataset.follow, b.dataset.fname, b.dataset.fpic);
}, true);
// keep a followed artist's name and picture current
function followRefresh(a) {
  const f = follows().find(x => x.id === a.id); if (!f) return;
  if ((a.name && f.name !== a.name) || (a.picture && f.picture !== a.picture)) { f.name = a.name || f.name; f.picture = a.picture || f.picture; saveUser(); renderLib(); }
}
function freshHTML() {
  const list = follows().filter(f => f.id.startsWith("dz:")); if (!list.length) return "";
  const c = oLoad("fresh", "/api/online/fresh?ids=" + encodeURIComponent(list.map(f => f.id).join(",")), 3 * 60 * 60e3);
  let h = `<h2 class="sec">Artists you follow <a data-go="library:following">Show all</a></h2><div class="row-scroll">${follows().slice(0, 20).map(f => oArtistTile({ id: f.id, name: f.name, picture: f.picture })).join("")}</div>`;
  const names = Object.fromEntries(list.map(f => [f.id, f.name]));
  if (c.data?.releases?.length) h += `<h2 class="sec">New from artists you follow</h2><div class="row-scroll">${c.data.releases.map(a => oReleaseTile({ ...a, artist: names[a.artistId] || a.artist })).join("")}</div>`;
  return h;
}

/* searching a singer's name: their page shows first (top songs, latest albums, a way to every song) */
function topArtistHTML(q, artists, tracks) {
  const a = (artists || [])[0]; if (!a || !a.id?.startsWith("dz:")) return "";
  const n = s => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const qn = n(q), an = n(a.name);
  const byName = qn && an && (qn === an || (qn.length >= 3 && an.startsWith(qn)) || (an.length >= 3 && qn.startsWith(an) && qn.length - an.length <= 2));
  // a name typed in another alphabet ("فيروز" → Fairuz): the top songs found are theirs
  const bySongs = (tracks || []).slice(0, 3).filter(t => t.artistId === a.id).length >= 2 && q.trim().split(/\s+/).length <= 3;
  if (!byName && !bySongs) return "";
  const c = oLoad("artist:" + a.id, "/api/online/artist?id=" + encodeURIComponent(a.id) + "&country=" + settings.country, 60 * 60e3);
  const d = c.data;
  const ids = d ? registerOnline(d.tracks || []).slice(0, 5) : [];
  const albums = d?.albums || [];
  let h = `<div class="top-artist"><div class="ta-card" data-go="oartist:${esc(a.id)}"><div class="art circle">${imgHTML(proxImg(a.picture), a.id, IC.person)}</div>
    <div class="ta-name">${esc(a.name)}</div><div class="muted">Artist${a.fans ? " • " + Intl.NumberFormat("en", { notation: "compact" }).format(a.fans) + " fans" : ""}${albums.length ? " • " + plural(albums.length, "release") : ""}</div>
    <div class="ta-btns">${followBtn(a)}<button class="btn" data-go="oartist:${esc(a.id)}">Open artist</button>${d ? `<button class="btn ghost" data-oartgo="${esc(a.id)}">All songs</button>` : ""}</div></div>
    <div class="ta-songs"><h2 class="sec" style="margin-top:0">Top songs</h2>${d ? trackTable(ids, { ctx: { type: "oartist", id: a.id, name: a.name }, key: "taSongs", noHead: true }) : skeletonRow(3)}</div></div>`;
  if (albums.length) h += `<h2 class="sec">${esc(a.name)} — albums & singles <a data-go="oartist:${esc(a.id)}">Show all</a></h2><div class="row-scroll">${albums.slice(0, 20).map(oReleaseTile).join("")}</div>`;
  return h;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-oartgo]"); if (!b) return;
  e.stopPropagation(); OART.id = b.dataset.oartgo; OART.tab = "songs"; go("oartist", b.dataset.oartgo);
}, true);

/* online search results, used by the Search page */
function onlineSearchHTML(q, filter) {
  const c = oLoad("search:" + q.toLowerCase(), "/api/online/search?country=" + settings.country + "&q=" + encodeURIComponent(q), 10 * 60e3);
  if (c.loading) return `<h2 class="sec">From around the world</h2>${skeletonRow(5)}`;
  if (c.error) return offlineNote(c.error);
  const d = c.data || {};
  let h = "";
  const songs = registerOnline(d.tracks || []);
  const full = registerOnline(d.full || []);
  if (filter !== "full") {
    if (songs.length) h += `<h2 class="sec">Songs from around the world <span class="hint">${plural(songs.length, "result")}</span></h2>${trackTable(songs, { ctx: { type: "search", id: q, name: `“${q}”` }, key: "osearch" })}`;
    if (d.artists?.length) h += `<h2 class="sec">Artists</h2><div class="row-scroll">${d.artists.map(oArtistTile).join("")}</div>`;
    if (d.albums?.length) h += `<h2 class="sec">Albums</h2><div class="row-scroll">${d.albums.map(oAlbumTile).join("")}</div>`;
  }
  if (full.length) {
    setList("sfull", full, { type: "search", id: q + ":full", name: `Full songs: “${q}”` });
    h += `<h2 class="sec">Full songs <span class="hint">Complete tracks from Audius</span></h2><div class="row-scroll">${full.map((id, i) => songTile(id, "sfull", i)).join("")}</div>`;
  }
  if (!h) h = `<div class="empty" style="padding:30px"><p>Nothing found online for “${esc(q)}”.</p></div>`;
  return h;
}

/* resolve a song that isn't in our cache (used by share codes) */
async function fetchOnlineTrack(id) {
  if (lib.online[id]?.title) return lib.online[id];
  const t = await api("/api/online/track?country=" + settings.country + "&id=" + encodeURIComponent(id));
  registerOnline([t]); return t;
}
async function findOnline(title, artist) {
  const q = `${artist || ""} ${title}`.trim();
  const r = await api("/api/online/search?country=" + settings.country + "&q=" + encodeURIComponent(q));
  const all = [...(r.tracks || []), ...(r.full || [])];
  const norm = s => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const best = all.find(t => norm(t.title) === norm(title)) || all[0];
  if (best) registerOnline([best]);
  return best || null;
}
