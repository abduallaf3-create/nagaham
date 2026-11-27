"use strict";
/* Nagham – navigation, pages, track lists, playback */

let nav = { stack: [], idx: -1 };
let tables = {};               // key -> {ids, ctx, playlistId}
let sel = { key: null, ids: new Set(), last: null };

/* ------------------------------------------------------------ navigation */
function go(view, arg, replace) {
  const entry = { view, arg };
  if (replace && nav.idx >= 0) nav.stack[nav.idx] = entry;
  else { nav.stack = nav.stack.slice(0, nav.idx + 1); nav.stack.push(entry); nav.idx++; }
  render();
}
function history_back() { if (nav.idx > 0) { nav.idx--; render(); } }
function render(keepScroll) {
  const { view, arg } = nav.stack[nav.idx] || { view: "home" };
  const v = $("#view");
  const st = v.scrollTop;
  if (draft && view !== "themeEdit") { draft = null; applyTheme(currentTheme()); }
  tables = {}; sel = { key: null, ids: new Set(), last: null };
  $("#back").disabled = nav.idx <= 0;
  $("#fwd").disabled = nav.idx >= nav.stack.length - 1;
  const navKey = { album: "library", artist: "library", songs: "library", albums: "library", artists: "library", liked: "library", playlist: "library", themes: "settings", themeEdit: "settings", oalbum: "search", oartist: "search", oartistall: "search", discover: "home", spplaylist: "library", spalbum: "search", spartist: "search", spliked: "library", spotify: "settings", ytplaylist: "library", ytliked: "library", friend: "friends" }[view] ?? view;
  $$("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === navKey));
  const alias = { songs: ["library", "songs"], albums: ["library", "albums"], artists: ["library", "artists"], themes: ["settings", "appearance"] }[view];
  if (alias) { nav.stack[nav.idx] = { view: alias[0], arg: alias[1] }; return render(keepScroll); }
  const fn = VIEWS[view] || VIEWS_EXTRA[view] || VIEWS.home;
  v.innerHTML = fn(arg);
  v.scrollTop = keepScroll ? st : 0;
  onScroll();
  if (view !== "search" && document.activeElement === $("#q")) $("#q").blur();
  if ($("#editor")) syncEditor();
  if (!keepScroll) stagger(v);
  renderLib();
  markPlaying();
  const hero = $(".hero", v);
  if (hero && hero.dataset.cover) palette(hero.dataset.cover).then(p => { if (p) hero.style.setProperty("--hero", heroColor(p.main, activeTheme?.mode)); });
}
function stagger(root) {
  let i = 0;
  for (const el of $$(".tile, .qt, .tr:not(.head), .theme-card, .settings-sec, .sp-step", root)) {
    if (i > 24) break;
    el.style.setProperty("--i", i++); el.classList.add("stagger");
  }
}
$("#back").onclick = history_back;
$("#fwd").onclick = () => { if (nav.idx < nav.stack.length - 1) { nav.idx++; render(); } };
$$("[data-nav]").forEach(a => a.addEventListener("click", () => {
  if (a.dataset.nav === "search") { if (nav.stack[nav.idx]?.view !== "search") go("search", $("#q").value); $("#q").focus(); }
  else go(a.dataset.nav);
}));
function onScroll() { $("#topbar").classList.toggle("solid", $("#view").scrollTop > 40); }
$("#view").addEventListener("scroll", () => { onScroll(); if (Date.now() - menuAt > 300) closeMenu(); });

/* ------------------------------------------------------------ track table */
const SORTERS = {
  title: (a, b) => a.title.localeCompare(b.title),
  artist: (a, b) => a.artist.localeCompare(b.artist) || (a.album || "").localeCompare(b.album || "") || ((a.trackNo || 0) - (b.trackNo || 0)),
  album: (a, b) => (a.album || "").localeCompare(b.album || "") || ((a.trackNo || 0) - (b.trackNo || 0)),
  duration: (a, b) => (a.duration || 0) - (b.duration || 0),
};
function sortedFor(key, ids) {
  const s = key && settings.sort[key];
  return s && SORTERS[s.by] ? [...ids].sort((x, y) => SORTERS[s.by](T(x), T(y)) * (s.dir || 1)) : ids;
}
function artistLink(id) {
  const t = T(id);
  if (t.spotify && t.artistId) return `<a data-go="spartist:${esc(t.artistId.slice(4))}">${esc(t.artist)}</a>`;
  if (t.online) return t.artistId && /^(dz|au):/.test(t.artistId) ? `<a data-go="oartist:${esc(t.artistId)}">${esc(t.artist)}</a>` : `<a data-searchfor="${esc(t.artist)}">${esc(t.artist)}</a>`;
  return `<a data-artist="${lib.trackArtist[id]}">${esc(t.artist)}</a>`;
}
function albumLink(id) {
  const t = T(id);
  if (t.spotify && t.albumId) return `<a data-go="spalbum:${esc(t.albumId.slice(5))}">${esc(t.album)}</a>`;
  if (t.online) return t.albumId && /^(dz|it):/.test(t.albumId) ? `<a data-go="oalbum:${esc(t.albumId)}">${esc(t.album)}</a>` : esc(t.album || "");
  return `<a data-album="${lib.trackAlbum[id]}">${esc(t.album)}</a>`;
}
function trackTable(ids, o = {}) {
  const key = o.key || "main";
  ids = sortedFor(o.sortKey, ids.filter(id => T(id)));
  tables[key] = { ids, ctx: o.ctx, playlistId: o.playlistId };
  if (!ids.length) return o.emptyHTML || `<div class="empty" style="padding:40px"><p>No songs here yet.</p></div>`;
  const head = o.noHead ? "" : `<div class="tr head"><span style="text-align:right" data-sort="">#</span><span data-sort="title">Title</span>${o.compact ? "" : '<span class="album" data-sort="album">Album</span>'}<span class="heart"></span><span class="dur" data-sort="duration" style="display:flex;justify-content:flex-end">${IC.clock}</span><span></span></div>`;
  const rows = ids.map((id, i) => {
    const t = T(id);
    const liked = lib.liked.has(id);
    return `<div class="tr" draggable="true" data-t="${key}" data-i="${i}" data-id="${esc(id)}">
      <div class="num"><span class="n">${o.albumNums && t.trackNo ? t.trackNo : i + 1}</span><span class="pi">${IC.play}</span></div>
      <div class="tt">${o.noArt ? "" : `<div class="art">${trackArt(id, true)}</div>`}<div style="min-width:0"><div class="title"><span>${esc(t.title)}</span>${badge(t)}${isPrivate(id) ? `<span class="privmark" title="Hidden from friends">${IC.lock}</span>` : ""}</div><div class="artist">${artistLink(id)}</div></div></div>
      ${o.compact ? "" : `<div class="album">${albumLink(id)}</div>`}
      <button class="icon-btn heart ${liked ? "on" : ""}" data-like="${esc(id)}" title="${liked ? "Remove from Liked Songs" : "Save to Liked Songs"}">${liked ? IC.heartOn : IC.heart}</button>
      <div class="dur">${fmt(t.online && t.fullDuration > t.duration ? t.fullDuration : t.duration)}</div>
      <button class="icon-btn more" data-more title="More options">${IC.dots}</button>
    </div>`;
  }).join("");
  return `<div class="tracks ${o.compact ? "compact" : ""}" data-sortkey="${o.sortKey || ""}">${head}${rows}</div>`;
}
const tableOf = row => tables[row.dataset.t];
function playFromRow(row) { const tb = tableOf(row); if (tb) playContext(tb.ids, +row.dataset.i, tb.ctx); }

function markPlaying() {
  const cur = P.current;
  $$(".tr[data-id]").forEach(r => {
    const on = r.dataset.id === cur;
    r.classList.toggle("playing", on);
    const n = $(".n", r);
    if (on && !n.dataset.orig) { n.dataset.orig = n.textContent; n.innerHTML = '<span class="eq"><i></i><i></i><i></i></span>'; }
    if (!on && n.dataset.orig) { n.textContent = n.dataset.orig; delete n.dataset.orig; }
    $(".pi", r).innerHTML = on && !E.paused ? IC.pause : IC.play;
  });
  document.body.classList.toggle("paused", E.paused);
  const ck = P.ctxInfo ? P.ctxInfo.type + ":" + (P.ctxInfo.id || "") : null;
  $$("[data-playctx]").forEach(b => { b.innerHTML = b.dataset.playctx === ck && !E.paused ? IC.pause : IC.play; });
  $$("[data-playlistplay]").forEach(b => { const L = playLists[b.dataset.playlistplay]; b.innerHTML = L && L.ids[+b.dataset.idx] === cur && !E.paused ? IC.pause : IC.play; });
  $$(".lib-item[data-ctx]").forEach(el => el.classList.toggle("playing", el.dataset.ctx === ck));
}

/* delegated clicks inside pages */
const view = $("#view");
view.addEventListener("click", e => {
  const t = e.target;
  const like = t.closest("[data-like]"); if (like) { toggleLike([like.dataset.like]); return; }
  const more = t.closest("[data-more]");
  if (more) { const row = more.closest(".tr"); if (!sel.ids.has(row.dataset.id) || sel.key !== row.dataset.t) selectOnly(row); const r = more.getBoundingClientRect(); trackMenu(r.left - 190, r.bottom); return; }
  const ar = t.closest("[data-artist]"); if (ar) { go("artist", ar.dataset.artist); return; }
  const al = t.closest("[data-album]"); if (al) { go("album", al.dataset.album); return; }
  const sf = t.closest("[data-searchfor]"); if (sf) { $("#q").value = sf.dataset.searchfor; go("search", sf.dataset.searchfor); return; }
  const pc = t.closest("[data-playctx]"); if (pc) { e.stopPropagation(); playCtxKey(pc.dataset.playctx); return; }
  const sp = t.closest("[data-shuffleplay]"); if (sp) { setShuffle(true); playCtxKey(sp.dataset.shuffleplay, true); return; }
  const sh = t.closest("[data-shareids]"); if (sh) { const tb = tables[sh.dataset.shareids]; if (tb) sharePlaylist(tb.ctx?.name || "Playlist", tb.ids); return; }
  const rn = t.closest("[data-rename]"); if (rn) { renamePlaylist(rn.dataset.rename); return; }
  const pm = t.closest("[data-plmenu]"); if (pm) { const r = pm.getBoundingClientRect(); playlistMenu(pm.dataset.plmenu, r.left, r.bottom); return; }
  const fa = t.closest("[data-folder]"); if (fa) { folderAction(fa.dataset.folder, fa.dataset.path); return; }
  const chip = t.closest("[data-chip]"); if (chip) { searchFilter = chip.dataset.chip; render(true); return; }
  const g = t.closest("[data-go]");
  if (g) { const i = g.dataset.go.indexOf(":"); i < 0 ? go(g.dataset.go) : go(g.dataset.go.slice(0, i), g.dataset.go.slice(i + 1)); return; }
  const sort = t.closest("[data-sort]");
  if (sort) {
    const key = sort.closest(".tracks").dataset.sortkey; if (!key) return;
    const by = sort.dataset.sort; const cur = settings.sort[key];
    if (!by) delete settings.sort[key]; else settings.sort[key] = { by, dir: cur && cur.by === by ? -(cur.dir || 1) : 1 };
    saveUser(); render(true); return;
  }
  const row = t.closest(".tr[data-i]");
  if (row && t.closest(".num")) { if (row.dataset.id === P.current) togglePlay(); else playFromRow(row); return; }
  if (row) {
    const tb = tableOf(row), i = +row.dataset.i;
    if (sel.key !== row.dataset.t) sel = { key: row.dataset.t, ids: new Set(), last: null };
    if (e.ctrlKey || e.metaKey) { const id = row.dataset.id; sel.ids.has(id) ? sel.ids.delete(id) : sel.ids.add(id); sel.last = i; }
    else if (e.shiftKey && sel.last != null) { const [a, b] = [Math.min(sel.last, i), Math.max(sel.last, i)]; sel.ids.clear(); for (let k = a; k <= b; k++) sel.ids.add(tb.ids[k]); }
    else selectOnly(row);
    paintSel();
  }
});
view.addEventListener("dblclick", e => { const row = e.target.closest(".tr[data-i]"); if (row && !e.target.closest("button,a")) playFromRow(row); });
view.addEventListener("contextmenu", e => {
  const row = e.target.closest(".tr[data-i]"); if (!row) return;
  e.preventDefault();
  if (!sel.ids.has(row.dataset.id) || sel.key !== row.dataset.t) selectOnly(row);
  trackMenu(e.clientX, e.clientY);
});
function selectOnly(row) { sel = { key: row.dataset.t, ids: new Set([row.dataset.id]), last: +row.dataset.i }; paintSel(); }
function paintSel() { $$(".tr[data-id]").forEach(r => r.classList.toggle("sel", r.dataset.t === sel.key && sel.ids.has(r.dataset.id))); }
function selectedIds() { const tb = tables[sel.key]; return tb ? tb.ids.filter(id => sel.ids.has(id)) : []; }
view.addEventListener("dragstart", e => {
  const row = e.target.closest(".tr[data-id]"); if (!row) return;
  if (!sel.ids.has(row.dataset.id) || sel.key !== row.dataset.t) selectOnly(row);
  const ids = selectedIds();
  e.dataTransfer.setData("text/nagham-tracks", JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "copy";
  const g = document.createElement("div"); g.className = "drag-ghost";
  g.textContent = ids.length > 1 ? plural(ids.length, "song") : T(ids[0]).title;
  document.body.appendChild(g); e.dataTransfer.setDragImage(g, 0, 0); setTimeout(() => g.remove());
});

/* ------------------------------------------------------------ page pieces */
function hero({ kind, title, stats, artHTML, coverSrc, circle, color, editable, key }) {
  const [a] = phColors(key || title);
  return `<div class="hero fade-in" data-cover="${esc(coverSrc || "")}" style="--hero:${color || a}">
    <div class="art ${circle ? "circle" : ""}">${artHTML}</div>
    <div style="min-width:0"><div class="kind">${kind}</div><h1 ${editable ? `class="editable" data-rename="${editable}" title="Click to rename"` : ""}>${esc(title)}</h1><div class="stats">${stats}</div></div>
  </div>`;
}
function totalDur(ids) { return ids.reduce((s, id) => s + (T(id)?.duration || 0), 0); }
function actions(ctxKey, extra = "") {
  return `<div class="actions"><button class="play-big" data-playctx="${esc(ctxKey)}" title="Play">${IC.play}</button>
    <button class="icon-btn" data-shuffleplay="${esc(ctxKey)}" title="Shuffle play">${IC.shuffle}</button>${extra}</div>`;
}
function ctxTracks(type, id) {
  if (type === "liked") return [...lib.liked].filter(x => T(x)).reverse();
  if (type === "playlist") return (lib.playlists.find(p => p.id === id)?.tracks || []).filter(x => T(x));
  if (type === "album") return lib.albumById[id]?.tracks || [];
  if (type === "artist") return lib.artistById[id]?.tracks || [];
  if (type === "songs") return lib.tracks.map(t => t.id);
  if (type === "oalbum") return registerOnline(oCache["album:" + id]?.data?.tracks || []);
  if (type === "oartist") return registerOnline(oCache["artist:" + id]?.data?.tracks || []);
  if (type === "oartistall") return registerOnline(oCache["artistsongs:" + id]?.data?.tracks || []);
  if (type === "recent") return (settings.history || []).filter(x => T(x));
  return [];
}
const SORTKEY = { liked: "liked", album: "album", artist: "artist", songs: "songs" };
function ctxName(type, id) {
  return { liked: "Liked Songs", songs: (IOS ? "My songs" : "On this PC"), recent: "Recently played" }[type]
    || (type === "playlist" && lib.playlists.find(p => p.id === id)?.name)
    || (type === "album" && lib.albumById[id]?.name) || (type === "artist" && lib.artistById[id]?.name)
    || (type === "oalbum" && oCache["album:" + id]?.data?.album?.title) || (type === "oartist" && oCache["artist:" + id]?.data?.artist?.name)
    || (type === "oartistall" && (oCache["artist:" + id]?.data?.artist?.name || "Artist") + " — all songs")
    || (type === "spplaylist" && oCache["sp:pl:" + id]?.data?.pl?.name) || (type === "spalbum" && oCache["sp:al:" + id]?.data?.a?.name)
    || (type === "spartist" && oCache["sp:ar:" + id]?.data?.a?.name) || (type === "spliked" && "Saved songs")
    || (type === "ytplaylist" && oCache["yt:pl:" + id]?.data?.pl?.snippet?.title) || (type === "ytliked" && "Liked music") || "";
}
function playCtxKey(key, shuffled) {
  const i = key.indexOf(":"), type = key.slice(0, i), id = key.slice(i + 1);
  if (!shuffled && P.ctxInfo && P.ctxInfo.type === type && (P.ctxInfo.id || "") === id && P.current) { togglePlay(); return; }
  if (type === "oalbum" && !oCache["album:" + id]?.data) { playOnlineAlbum(id); return; }
  if (type === "oartist" && !oCache["artist:" + id]?.data) { go("oartist", id); return; }
  if (type === "oartistall" && !oCache["artistsongs:" + id]?.data) { OART.id = id; OART.tab = "songs"; go("oartist", id); return; }
  const ids = sortedFor(type === "playlist" ? "pl:" + id : SORTKEY[type], ctxTracks(type, id));
  if (!ids.length) return toast("Nothing to play here yet");
  playContext(ids, shuffled ? Math.floor(Math.random() * ids.length) : 0, { type, id, name: ctxName(type, id) });
}

function emptyLibrary(compact) {
  if (lib.scanning) return `<div class="empty"><div class="spin" style="margin:0 auto;width:32px;height:32px"></div><h2>Scanning your music…</h2><p>${plural(lib.scanned, "song")} found so far</p></div>`;
  return `<div class="empty" ${compact ? 'style="padding:30px"' : ""}><div class="big">${IC.folder}</div><h2>Add the music on your PC</h2>
    <p>Nagham plays your MP3, FLAC, M4A, WAV, OGG and Opus files.<br>Pick the folder where you keep your music.</p>
    <div class="row-gap">${lib.canPick ? `<button class="btn accent" data-folder="pick">Choose a folder</button>` : ""}<button class="btn ghost" data-go="settings">Type a folder path</button><button class="btn ghost" data-go="discover">${IC.globe}Explore world music</button></div></div>`;
}
function albumTile(a) {
  return `<div class="tile" data-go="album:${a.id}"><div class="art">${imgHTML(a.cover ? "/cover/" + a.cover : null, a.id, IC.disc)}</div><button class="play-big" data-playctx="album:${a.id}">${IC.play}</button><div class="name"><span>${esc(a.name)}</span></div><div class="sub">${esc(a.artist)}</div></div>`;
}
function artistTile(a) {
  return `<div class="tile" data-go="artist:${a.id}"><div class="art circle">${imgHTML(a.cover ? "/cover/" + a.cover : null, a.id, IC.person)}</div><button class="play-big" data-playctx="artist:${a.id}">${IC.play}</button><div class="name"><span>${esc(a.name)}</span></div><div class="sub">Artist • ${plural(a.tracks.length, "song")}</div></div>`;
}
function ctxArt(type, id, cover) {
  if (cover && (type === "oalbum" || type === "oartist") && !oCache[(type === "oalbum" ? "album:" : "artist:") + id]?.data) return imgHTML(cover, id, IC.disc);
  if (type === "liked") return likedArt();
  if (type === "playlist") { const p = lib.playlists.find(p => p.id === id); return p ? playlistArt(p) : phHTML(id); }
  if (type === "album") { const a = lib.albumById[id]; return imgHTML(a?.cover ? "/cover/" + a.cover : null, id, IC.disc); }
  if (type === "artist") { const a = lib.artistById[id]; return imgHTML(a?.cover ? "/cover/" + a.cover : null, id, IC.person); }
  if (type === "oalbum") { const a = oCache["album:" + id]?.data?.album; return imgHTML(proxImg(a?.cover), id, IC.disc); }
  if (type === "oartist") { const a = oCache["artist:" + id]?.data?.artist; return imgHTML(proxImg(a?.picture) || cover, id, IC.person); }
  return phHTML(id);
}

/* ------------------------------------------------------------ pages */
let searchFilter = "all";
const VIEWS = {
  home() {
    const h = new Date().getHours();
    const greet = (h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening") + (settings.userName ? ", " + esc(settings.userName) : "");
    const quick = [{ type: "liked", id: "" }];
    for (const r of settings.recent || []) if (quick.length < 8 && (ctxTracks(r.type, r.id).length || r.type === "oalbum" || r.type === "oartist") && (ctxName(r.type, r.id) || r.name) && !quick.some(q => q.type === r.type && q.id === r.id)) quick.push(r);
    for (const p of lib.playlists) if (quick.length < 8 && !quick.some(q => q.type === "playlist" && q.id === p.id)) quick.push({ type: "playlist", id: p.id });
    for (const a of [...lib.albums].sort((x, y) => y.added - x.added)) if (quick.length < 8 && !quick.some(q => q.type === "album" && q.id === a.id)) quick.push({ type: "album", id: a.id });
    const goKey = q => q.type === "liked" ? "liked" : q.type + ":" + q.id;
    let out = `<div class="pad fade-in">
      <h1 class="greet">${greet}</h1>
      <div class="quick">${quick.map(q => `<div class="qt" data-go="${esc(goKey(q))}"><div class="art">${ctxArt(q.type, q.id, q.cover)}</div><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:58px">${esc(ctxName(q.type, q.id) || q.name)}</span><button class="play-big" data-playctx="${esc(q.type + ":" + q.id)}">${IC.play}</button></div>`).join("")}</div>`;
    const recent = ctxTracks("recent").slice(0, 20);
    if (recent.length) { setList("recent", recent, { type: "recent", id: "", name: "Recently played" }); out += `<h2 class="sec">Recently played</h2><div class="row-scroll">${recent.map((id, i) => songTile(id, "recent", i)).join("")}</div>`; }
    if (typeof recsHomeHTML === "function") out += recsHomeHTML();
    out += freshHTML();
    if (typeof fyHomeHTML === "function") out += fyHomeHTML();
    const linked = linkedPlaylistTiles();
    if (linked) out += `<h2 class="sec">Your playlists <a data-go="library:playlists">Show all</a></h2><div class="row-scroll">${linked}</div>`;
    // world music (loads in the background)
    const c = oLoad("home:" + settings.country, "/api/online/home?country=" + settings.country);
    const country = COUNTRIES[settings.country] || settings.country.toUpperCase();
    if (c.loading) out += `<h2 class="sec">Top songs worldwide</h2>${skeletonRow()}`;
    else if (c.data) {
      const d = c.data;
      // the chart is the worldwide one for everybody (not one country's)
      if (d.chart?.length) { const ids = registerOnline(d.chart); setList("world", ids, { type: "chart", id: "world", name: "Worldwide top 50" }); out += `<h2 class="sec">Top songs worldwide <a data-go="discover">Show all</a> <a data-dllist="world">⤓ Download</a></h2><div class="row-scroll">${ids.slice(0, 15).map((id, i) => songTile(id, "world", i)).join("")}</div>`; }
      if (d.releases?.length) out += `<h2 class="sec">New releases <a data-go="discover">Show all</a></h2><div class="row-scroll">${d.releases.slice(0, 15).map(oAlbumTile).join("")}</div>`;
    }
    if (lib.tracks.length) {
      out += `<h2 class="sec">Recently added to your PC <a data-go="albums">Show all</a></h2><div class="row-scroll">${[...lib.albums].sort((a, b) => b.added - a.added).slice(0, 15).map(albumTile).join("")}</div>`;
      out += `<h2 class="sec">Your artists <a data-go="artists">Show all</a></h2><div class="row-scroll">${[...lib.artists].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 15).map(artistTile).join("")}</div>`;
    } else out += `<h2 class="sec">Music on your PC</h2>${emptyLibrary(true)}`;
    return out + "</div>";
  },
  songs() {
    if (!lib.tracks.length) return `<div class="pad">${emptyLibrary()}</div>`;
    const ids = lib.tracks.map(t => t.id);
    return hero({ kind: "Your library", title: (IOS ? "My songs" : "On this PC"), key: "songs", artHTML: phHTML("songs"), stats: `${plural(ids.length, "song")}, ${fmtLong(totalDur(ids))}` })
      + `<div class="under-hero">${actions("songs:")}${trackTable(ids, { ctx: { type: "songs", id: "", name: (IOS ? "My songs" : "On this PC") }, sortKey: "songs" })}</div>`;
  },
  albums() {
    if (!lib.tracks.length) return `<div class="pad">${emptyLibrary()}</div>`;
    return `<div class="pad fade-in"><h1 class="greet">Albums <span class="muted" style="font-size:16px">${lib.albums.length}</span></h1><div class="grid">${lib.albums.map(albumTile).join("")}</div></div>`;
  },
  artists() {
    if (!lib.tracks.length) return `<div class="pad">${emptyLibrary()}</div>`;
    return `<div class="pad fade-in"><h1 class="greet">Artists <span class="muted" style="font-size:16px">${lib.artists.length}</span></h1><div class="grid">${lib.artists.map(artistTile).join("")}</div></div>`;
  },
  album(id) {
    const a = lib.albumById[id];
    if (!a) return `<div class="pad empty"><h2>Album not found</h2></div>`;
    const al = a.artist === "Various artists" ? "Various artists" : `<a data-artist="${lib.trackArtist[a.tracks[0]]}">${esc(a.artist)}</a>`;
    return hero({ kind: "Album", title: a.name, key: a.id, coverSrc: a.cover && "/cover/" + a.cover, artHTML: imgHTML(a.cover && "/cover/" + a.cover, a.id, IC.disc), stats: `${al} • ${plural(a.tracks.length, "song")}, ${fmtLong(totalDur(a.tracks))}` })
      + `<div class="under-hero">${actions("album:" + a.id, `<button class="icon-btn" data-shareids="main" title="Share as playlist code">${IC.share}</button>`)}${trackTable(a.tracks, { ctx: { type: "album", id: a.id, name: a.name }, compact: true, noArt: true, albumNums: true, sortKey: "album" })}</div>`;
  },
  artist(id) {
    const a = lib.artistById[id];
    if (!a) return `<div class="pad empty"><h2>Artist not found</h2></div>`;
    const albums = lib.albums.filter(al => al.tracks.some(t => lib.trackArtist[t] === id));
    return hero({ kind: "Artist", title: a.name, key: a.id, coverSrc: a.cover && "/cover/" + a.cover, circle: true, artHTML: imgHTML(a.cover && "/cover/" + a.cover, a.id, IC.person), stats: `${plural(a.tracks.length, "song")} • ${plural(albums.length, "album")} • <a data-searchfor="${esc(a.name)}">Find more online</a>` })
      + `<div class="under-hero">${actions("artist:" + a.id)}${trackTable(a.tracks, { ctx: { type: "artist", id: a.id, name: a.name }, sortKey: "artist" })}
      <div style="padding:0 28px 28px"><h2 class="sec">Albums</h2><div class="grid">${albums.map(albumTile).join("")}</div></div></div>`;
  },
  liked() {
    const ids = ctxTracks("liked");
    return hero({ kind: "Playlist", title: "Liked Songs", artHTML: likedArt(), stats: plural(ids.length, "song") })
      + `<div class="under-hero">${actions("liked:", `<button class="icon-btn" data-shareids="main" title="Share as playlist code">${IC.share}</button>`)}${trackTable(ids, { ctx: { type: "liked", id: "", name: "Liked Songs" }, sortKey: "liked",
        emptyHTML: `<div class="empty"><div class="big">${IC.heart.replace('width="17" height="17"', "")}</div><h2>Songs you like will appear here</h2><p>Save songs by tapping the heart icon.</p></div>` })}</div>`;
  },
  playlist(id) {
    const p = lib.playlists.find(p => p.id === id);
    if (!p) return `<div class="pad empty"><h2>Playlist not found</h2></div>`;
    const ids = p.tracks.filter(x => T(x));
    const firstCover = ids.map(x => coverOf(x)).find(Boolean);
    return hero({ kind: "Playlist", title: p.name, key: p.id, artHTML: playlistArt(p), coverSrc: firstCover, editable: p.id, stats: `${plural(ids.length, "song")}${ids.length ? ", " + fmtLong(totalDur(ids)) : ""}` })
      + `<div class="under-hero">${actions("playlist:" + p.id, `<button class="icon-btn" data-plshare="${p.id}" title="Share playlist code">${IC.share}</button><button class="icon-btn" data-plmenu="${p.id}" title="More options">${IC.dots.replace('width="17" height="17"', "")}</button>`)}${trackTable(ids, { ctx: { type: "playlist", id: p.id, name: p.name }, playlistId: p.id, sortKey: "pl:" + p.id,
        emptyHTML: `<div class="empty"><h2>Let's find something for your playlist</h2><p>Right-click any song and choose <b>Add to playlist</b>, or drag songs onto the playlist in the sidebar.</p><div class="row-gap"><button class="btn" data-go="discover">Explore world music</button><button class="btn ghost" data-go="songs">Songs on this PC</button></div></div>` })}</div>`;
  },
  search(q) {
    q = (q || "").trim();
    if (!q) {
      return `<div class="pad fade-in"><h1 class="greet">Search</h1><p class="muted" style="margin-top:-8px">Find any song, artist or album.</p>
        ${lib.artists.length ? `<h2 class="sec">Your artists</h2><div class="grid">${lib.artists.slice(0, 30).map(artistTile).join("")}</div>` : ""}</div>`;
    }
    const ql = q.toLowerCase();
    const words = ql.split(/\s+/);
    const match = s => { s = s.toLowerCase(); return words.every(w => s.includes(w)); };
    const lsongs = lib.tracks.filter(t => match(`${t.title} ${t.artist} ${t.album}`)).map(t => t.id);
    const lalbums = lib.albums.filter(a => match(`${a.name} ${a.artist}`)).slice(0, 12);
    const lartists = lib.artists.filter(a => match(a.name)).slice(0, 12);
    const sp = null, ys = null; // (linked Spotify / YouTube search was removed)
    const on = oLoad("search:" + ql, "/api/online/search?country=" + settings.country + "&q=" + encodeURIComponent(q), 10 * 60e3);
    const f = searchFilter;
    const chips = [["all", "All"], ["songs", "Songs"], ["artists", "Artists"], ["albums", "Albums"], ["pc", (IOS ? "My songs" : "On this PC")]];
    let h = `<div class="pad fade-in"><div class="chips">${chips.map(([k, l]) => `<button class="chip ${f === k ? "on" : ""}" data-chip="${k}">${l}</button>`).join("")}</div>`;
    // merge results from every source into one list
    const key = id => { const t = T(id); return t ? norm(t.title) + "|" + norm((t.artist || "").split(",")[0]) : id; };
    const seen = new Set(), songs = [];
    for (const id of [...(ys?.data?.ids || []), ...(sp?.data?.ids || []), ...registerOnline(on.data?.tracks || [])]) { const k = key(id); if (!seen.has(k)) { seen.add(k); songs.push(id); } }
    const more = registerOnline(on.data?.full || []).filter(id => !seen.has(key(id)));
    const artists = [...(sp?.data?.artists || []).map(spArtistTile), ...(on.data?.artists || []).map(oArtistTile)];
    const albums = [...(sp?.data?.albums || []).map(spAlbumTile), ...(on.data?.albums || []).map(oAlbumTile)];
    const playlists = (sp?.data?.playlists || []).map(spPlaylistTile);
    const loading = (on.loading && (!sp || sp.loading) && (!ys || ys.loading)) && !songs.length;
    if (f === "pc" || (f === "all" && (lsongs.length || lalbums.length || lartists.length))) {
      if (lsongs.length || lalbums.length || lartists.length) {
        h += `<h2 class="sec">On this PC <span class="hint">${plural(lsongs.length, "song")}</span></h2>${trackTable(lsongs.slice(0, f === "pc" ? 500 : 5), { ctx: { type: "search", id: q + ":pc", name: `“${q}” on this PC` }, key: "lsearch", noHead: true })}`;
        if (f === "pc" && (lartists.length || lalbums.length)) h += `<div class="row-scroll">${lartists.map(artistTile).join("")}${lalbums.map(albumTile).join("")}</div>`;
      } else h += `<div class="empty" style="padding:30px"><p>No songs on this PC match “${esc(q)}”.</p></div>`;
    }
    if (f !== "pc") {
      if ((f === "all" || f === "artists") && on.data?.artists?.length) h += topArtistHTML(q, on.data.artists, on.data.tracks);
      if (loading) h += `<h2 class="sec">Songs</h2>${skeletonRow(5)}`;
      else {
        if ((f === "all" || f === "songs") && songs.length) {
          setList("ssongs", songs, { type: "search", id: q, name: `“${q}”` });
          h += `<h2 class="sec">Songs <span class="hint">${plural(songs.length, "result")}</span></h2>${trackTable(f === "songs" ? songs : songs.slice(0, 10), { ctx: { type: "search", id: q, name: `“${q}”` }, key: "osearch", noHead: f !== "songs" })}`;
        }
        if ((f === "all" || f === "artists") && artists.length) h += `<h2 class="sec">Artists</h2><div class="${f === "artists" ? "grid" : "row-scroll"}">${artists.join("")}</div>`;
        if ((f === "all" || f === "albums") && albums.length) h += `<h2 class="sec">Albums</h2><div class="${f === "albums" ? "grid" : "row-scroll"}">${albums.join("")}</div>`;
        if (f === "all" && playlists.length) h += `<h2 class="sec">Playlists</h2><div class="row-scroll">${playlists.join("")}</div>`;
        if ((f === "all" || f === "songs") && more.length) { setList("smore", more, { type: "search", id: q + ":more", name: `More: “${q}”` }); h += `<h2 class="sec">More songs</h2><div class="row-scroll">${more.map((id, i) => songTile(id, "smore", i)).join("")}</div>`; }
        if (!songs.length && !artists.length && !albums.length && !more.length) {
          if (on.error && (!sp || sp.error)) h += offlineNote(on.error);
          else if (!on.loading && (!sp || !sp.loading)) h += `<div class="empty" style="padding:30px"><p>Nothing found for “${esc(q)}”. Try different words.</p></div>`;
        }
      }
    }
    return h + "</div>";
  },
  settings(tab) {
    const tabs = IOS
      ? [["profile", "Profile", IC.person], ["appearance", "Appearance & Themes", IC.palette], ["library", "My music", IC.folder], ["playback", "Playback", IC.play], ["about", "About", IC.info]]
      : [["profile", "Profile", IC.person], ["appearance", "Appearance & Themes", IC.palette], ["library", "Music on this PC", IC.folder], ["accounts", "Discord", IC.share], ["playback", "Playback & window", IC.play], ["shortcuts", "Shortcuts", IC.dots], ["about", "About", IC.info]];
    tab = tabs.some(t => t[0] === tab) ? tab : "profile";
    const body = SETTINGS_TABS[tab]();
    return `<div class="pad fade-in"><h1 class="greet">Settings</h1>
      <div class="set-layout"><nav class="set-tabs">${tabs.map(([k, l, ic]) => `<button class="set-tab ${k === tab ? "on" : ""}" data-go="settings:${k}">${ic.replace("<svg", '<svg width="18" height="18"')}<span>${l}</span></button>`).join("")}</nav>
      <div class="set-body">${body}</div></div></div>`;
  },
  library(tab) {
    tab = ["playlists", "songs", "albums", "artists", "following"].includes(tab) ? tab : "playlists";
    const chips = [["playlists", "Playlists"], ["songs", IOS ? "My songs" : "Songs on this PC"], ["albums", "Albums"], ["artists", "Artists"], ["following", "Following"]];
    let h = `<div class="pad fade-in"><h1 class="greet">Your Library</h1><div class="chips">${chips.map(([k, l]) => `<button class="chip ${tab === k ? "on" : ""}" data-go="library:${k}">${l}</button>`).join("")}</div>`;
    if (tab === "playlists") {
      const tiles = [`<div class="tile" data-go="liked"><div class="art">${likedArt()}</div><button class="play-big" data-playctx="liked:">${IC.play}</button><div class="name"><span>Liked Songs</span></div><div class="sub">${plural([...lib.liked].filter(x => T(x)).length, "song")}</div></div>`];
      for (const p of lib.playlists) tiles.push(`<div class="tile" data-go="playlist:${p.id}"><div class="art">${playlistArt(p)}</div><button class="play-big" data-playctx="playlist:${p.id}">${IC.play}</button><div class="name"><span>${esc(p.name)}</span></div><div class="sub">${plural(p.tracks.filter(x => T(x)).length, "song")}</div></div>`);
      const linked = linkedPlaylistTiles();
      h += `<div class="grid">${tiles.join("")}<div class="tile new-tile" data-newpl><div class="art"><div class="art-ph" style="background:var(--input);color:var(--accent)">${IC.plus}</div></div><div class="name"><span>New playlist</span></div><div class="sub">Mix any songs</div></div></div>`;
      if (linked) h += `<h2 class="sec">From your linked accounts</h2><div class="grid">${linked}</div>`;
      return h + "</div>";
    }
    if (tab === "following") return h + (follows().length ? `<div class="grid">${follows().map(f => oArtistTile({ id: f.id, name: f.name, picture: f.picture })).join("")}</div>`
      : `<div class="empty" style="padding:30px"><h2>No artists yet</h2><p>Search for a singer and press <b>Follow</b> — they show up here and their new albums and singles show on Home.</p></div>`) + "</div>";
    if (!lib.tracks.length) return h + emptyLibrary() + "</div>";
    if (tab === "songs") { const ids = lib.tracks.map(t => t.id); return h + `<div class="actions" style="padding:0 0 10px">${actions("songs:").replace('<div class="actions">', "").replace(/<\/div>$/, "")}<span class="muted">${plural(ids.length, "song")}, ${fmtLong(totalDur(ids))}</span></div>${trackTable(ids, { ctx: { type: "songs", id: "", name: (IOS ? "My songs" : "On this PC") }, sortKey: "songs" })}</div>`; }
    if (tab === "albums") return h + `<div class="grid">${lib.albums.map(albumTile).join("")}</div></div>`;
    return h + `<div class="grid">${lib.artists.map(artistTile).join("")}</div></div>`;
  },
};
view.addEventListener("click", e => { if (e.target.closest("[data-hidepromo]")) { settings.hideSpPromo = true; saveUser(); render(true); } });
view.addEventListener("click", e => {
  const wm = e.target.closest("[data-winmode] button"); if (!wm) return;
  settings.windowMode = wm.dataset.v; saveUser(); render(true);
  toast(wm.dataset.v === "classic" ? "Classic window from next start" : "Themed window from next start");
});
view.addEventListener("change", e => {
  if (e.target.id === "countrySel") { settings.country = e.target.value; saveUser(); toast(`Charts now for ${COUNTRIES[settings.country]}`); }
});
view.addEventListener("click", e => { const s = e.target.closest("[data-plshare]"); if (s) { const p = lib.playlists.find(p => p.id === s.dataset.plshare); if (p) sharePlaylist(p.name, p.tracks); } });

async function folderAction(action, path) {
  try {
    if (action === "add") { path = $("#pathIn").value.trim(); if (!path) return $("#pathIn").focus(); }
    const r = await api("/api/folders", { action, path });
    if (r.cancelled) return;
    toast(action === "remove" ? "Folder removed" : action === "rescan" ? "Rescanning your music…" : "Folder added — scanning…");
    pollScan(true);
  } catch (e) { toast(e.message); }
}

/* ------------------------------------------------------------ sidebar library */
function renderLib() {
  const cur = nav.stack[nav.idx] || {};
  const item = (key, goTo, artHTML, name, sub, active, plId) => `<div class="lib-item ${active ? "active" : ""}" data-ctx="${esc(key)}" data-go="${esc(goTo)}" ${plId ? `data-pl="${plId}"` : ""}><div class="art">${artHTML}</div><div class="meta"><div class="name">${esc(name)}</div><div class="sub">${sub}</div></div></div>`;
  let h = item("liked:", "liked", likedArt(), "Liked Songs", `Playlist • ${plural([...lib.liked].filter(x => T(x)).length, "song")}`, cur.view === "liked");
  for (const p of lib.playlists) h += item("playlist:" + p.id, "playlist:" + p.id, playlistArt(p), p.name, `Playlist • ${plural(p.tracks.filter(x => T(x)).length, "song")}`, cur.view === "playlist" && cur.arg === p.id, p.id);
  if (follows().length) {
    h += `<div class="lib-sub">Artists you follow</div>`;
    for (const f of follows()) h += item("oartist:" + f.id, "oartist:" + f.id, `<div class="circle-art">${imgHTML(proxImg(f.picture), f.id, IC.person)}</div>`, f.name, "Artist", cur.view === "oartist" && cur.arg === f.id);
  }
  if (!lib.playlists.length) h += `<div style="background:var(--input);border-radius:14px;padding:16px 18px;margin:8px 0"><div style="font-weight:700">Create your first playlist</div><div class="muted" style="font-size:14px;margin:6px 0 14px">Mix songs from your PC and from around the world.</div><button class="btn sm accent" onclick="newPlaylist()">Create playlist</button></div>`;
  $("#libList").innerHTML = h;
}
const libList = $("#libList");
libList.addEventListener("click", e => { const it = e.target.closest("[data-go]"); if (!it) return; const g = it.dataset.go, i = g.indexOf(":"); i < 0 ? go(g) : go(g.slice(0, i), g.slice(i + 1)); });
libList.addEventListener("dblclick", e => { const it = e.target.closest("[data-ctx]"); if (it) playCtxKey(it.dataset.ctx); });
libList.addEventListener("contextmenu", e => { const it = e.target.closest("[data-pl]"); if (!it) return; e.preventDefault(); playlistMenu(it.dataset.pl, e.clientX, e.clientY); });
libList.addEventListener("dragover", e => { const it = e.target.closest("[data-pl],[data-ctx='liked:']"); if (!it || !e.dataTransfer.types.includes("text/nagham-tracks")) return; e.preventDefault(); $$(".lib-item.drop").forEach(x => x.classList.remove("drop")); it.classList.add("drop"); });
libList.addEventListener("dragleave", e => { const it = e.target.closest(".lib-item"); if (it && !it.contains(e.relatedTarget)) it.classList.remove("drop"); });
libList.addEventListener("drop", e => {
  $$(".lib-item.drop").forEach(x => x.classList.remove("drop"));
  const it = e.target.closest("[data-pl],[data-ctx='liked:']"); if (!it) return;
  e.preventDefault();
  const ids = JSON.parse(e.dataTransfer.getData("text/nagham-tracks") || "[]");
  if (it.dataset.pl) addToPlaylist(it.dataset.pl, ids); else { ids.forEach(id => lib.liked.add(id)); afterLikeChange("Added to Liked Songs"); }
});

/* ------------------------------------------------------------ playlists & likes */
function addToPlaylist(pid, ids) {
  const p = lib.playlists.find(p => p.id === pid); if (!p) return;
  const fresh = ids.filter(id => !p.tracks.includes(id));
  p.tracks.push(...fresh); saveUser(); renderLib();
  const cur = nav.stack[nav.idx]; if (cur?.view === "playlist" && cur.arg === pid) render(true);
  toast(fresh.length ? `Added to ${p.name}` : `Already in ${p.name}`);
}
function removeFromPlaylist(pid, ids) {
  const p = lib.playlists.find(p => p.id === pid); if (!p) return;
  p.tracks = p.tracks.filter(id => !ids.includes(id)); saveUser(); render(true); toast(`Removed from ${p.name}`);
}
function toggleLike(ids) {
  const allLiked = ids.every(id => lib.liked.has(id));
  if (allLiked) ids.forEach(id => lib.liked.delete(id));
  else lib.liked = new Set([...[...lib.liked].filter(x => !ids.includes(x)), ...ids]);
  afterLikeChange(allLiked ? "Removed from Liked Songs" : "Added to Liked Songs");
}
function afterLikeChange(msg) { saveUser(); render(true); renderNP(); renderFull(); toast(msg); }
async function newPlaylist(ids) {
  const name = await prompt_("Create playlist", `My Playlist #${lib.playlists.length + 1}`, "Create");
  if (name == null) return;
  const p = { id: uid(), name: name.trim() || `My Playlist #${lib.playlists.length + 1}`, tracks: ids ? [...new Set(ids)] : [], created: Date.now() };
  lib.playlists.push(p); saveUser(); go("playlist", p.id);
  if (ids?.length) toast(`Added to ${p.name}`);
}
window.newPlaylist = newPlaylist;
$("#newPl").onclick = () => newPlaylist();
async function renamePlaylist(pid) {
  const p = lib.playlists.find(p => p.id === pid); if (!p) return;
  const name = await prompt_("Rename playlist", p.name, "Save");
  if (name == null || !name.trim()) return;
  p.name = name.trim(); saveUser(); render(true);
}
async function deletePlaylist(pid) {
  const p = lib.playlists.find(p => p.id === pid); if (!p) return;
  if (!await confirm_(`Delete “${p.name}”?`, "This deletes the playlist from Your Library. Your music files are not touched.", "Delete")) return;
  lib.playlists = lib.playlists.filter(x => x.id !== pid);
  settings.recent = settings.recent.filter(r => !(r.type === "playlist" && r.id === pid));
  saveUser();
  const cur = nav.stack[nav.idx];
  if (cur?.view === "playlist" && cur.arg === pid) go("home", null, true); else renderLib();
  toast("Removed from Your Library");
}
function playlistMenu(pid, x, y) {
  const p = lib.playlists.find(p => p.id === pid); if (!p) return;
  menu(x, y, [
    { label: "Play", icon: IC.play, act: () => playCtxKey("playlist:" + pid) },
    { label: "Add to queue", icon: IC.queue, act: () => addUpNext(ctxTracks("playlist", pid)) },
    { label: "Share playlist code", icon: IC.share, act: () => sharePlaylist(p.name, p.tracks) },
    "-",
    { label: "Rename", icon: IC.edit, act: () => renamePlaylist(pid) },
    { label: "Delete", icon: IC.trash, act: () => deletePlaylist(pid) },
  ]);
}
function trackMenu(x, y) {
  const ids = selectedIds(); if (!ids.length) return;
  const one = ids.length === 1 ? T(ids[0]) : null;
  const allLiked = ids.every(id => lib.liked.has(id));
  const tb = tables[sel.key];
  const items = [
    { label: "Add to queue", icon: IC.queue, act: () => addUpNext(ids) },
    { label: "Play next", icon: IC.arrow, act: () => addUpNext(ids, true) },
    "-",
    { label: "Add to playlist", icon: IC.plus, sub: () => [
      { label: "New playlist", icon: IC.plus, act: () => newPlaylist(ids) }, "-",
      ...lib.playlists.map(p => ({ label: p.name, act: () => addToPlaylist(p.id, ids) })),
    ] },
  ];
  if (tb?.playlistId) items.push({ label: "Remove from this playlist", icon: IC.trash, act: () => removeFromPlaylist(tb.playlistId, ids) });
  items.push({ label: allLiked ? "Remove from Liked Songs" : "Save to Liked Songs", icon: allLiked ? IC.heartOn : IC.heart, act: () => toggleLike(ids) });
  const allPriv = ids.every(isPrivate);
  items.push({ label: allPriv ? "Visible to friends again" : "Make private (hide from friends)", icon: IC.lock || IC.eye || IC.person, act: () => setPrivate(ids, !allPriv) });
  items.push({ label: one ? "Share song code" : "Share as playlist code", icon: IC.share, act: () => one ? shareSong(ids[0]) : sharePlaylist("Songs from a friend", ids) });
  if (one) {
    items.push("-");
    if (one.spotify) {
      if (one.artistId) items.push({ label: "Go to artist", icon: IC.person, act: () => goArtistOf(one) });
      if (one.albumId) items.push({ label: "Go to album", icon: IC.disc, act: () => goAlbumOf(one) });
    } else if (one.online) {
      if (one.artistId && /^(dz|au):/.test(one.artistId)) items.push({ label: "Go to artist", icon: IC.person, act: () => go("oartist", one.artistId) });
      if (one.albumId && /^(dz|it):/.test(one.albumId)) items.push({ label: "Go to album", icon: IC.disc, act: () => go("oalbum", one.albumId) });
    } else {
      items.push({ label: "Go to artist", icon: IC.person, act: () => go("artist", lib.trackArtist[one.id]) }, { label: "Go to album", icon: IC.disc, act: () => go("album", lib.trackAlbum[one.id]) },
        { label: "Copy file path", icon: IC.folder, act: () => copyText(one.path, "File path copied") });
    }
  }
  menu(x, y, items);
}

/* ------------------------------------------------------------ playback engine */
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function buildOrder(startIdx) {
  const n = P.ctx.length;
  if (settings.shuffle) { const rest = shuffleArr([...Array(n).keys()].filter(i => i !== startIdx)); P.order = startIdx >= 0 ? [startIdx, ...rest] : rest; P.opos = 0; }
  else { P.order = [...Array(n).keys()]; P.opos = Math.max(0, startIdx); }
}
function playContext(ids, startIdx, ctxInfo) {
  P.ctx = [...ids]; P.ctxInfo = ctxInfo || null;
  buildOrder(startIdx);
  if (ctxInfo && ["album", "artist", "playlist", "liked", "oalbum", "oartist", "oartistall", "spplaylist", "spalbum", "spartist", "ytplaylist"].includes(ctxInfo.type)) {
    settings.recent = [{ type: ctxInfo.type, id: ctxInfo.id, name: ctxInfo.name, cover: coverOf(ids[startIdx], true) }, ...(settings.recent || []).filter(r => !(r.type === ctxInfo.type && r.id === ctxInfo.id))].slice(0, 12);
  }
  playId(P.ctx[P.order[P.opos]]);
}
function playId(id, fromUpNext, autoplay = true, startAt = 0) {
  const t = T(id); if (!t) return;
  P.current = id; P.fromUpNext = !!fromUpNext; P.wantPlay = autoplay;
  P.loaded = null;
  if (autoplay) {
    startEngine(id, startAt);
    settings.history = [id, ...(settings.history || []).filter(x => x !== id)].slice(0, 50);
  } else if (!isSp(id)) { E.mode = "audio"; audio.src = audioURL(id); if (startAt) audio.currentTime = startAt; P.loaded = id; }
  settings.lastId = id; settings.lastPos = startAt || 0;
  saveUser(); renderNP(); markPlaying(); renderQueue(); renderFull(); updateMediaSession(); refreshDynamic();
  updateTitle();
}
/* YouTube videos to try for this song (full length), best first */
let ytQuotaWarned = false;
async function ytCandidates(id) {
  const t = T(id); if (!t) return [];
  const own = isYt(id) ? [id.slice(3)] : [];
  if (!YTM.connected || settings.ytFull === false) return own;
  if (own.length && !(t.ytFailed || []).includes(own[0])) return own; // its own video first
  if (!t.ytAlt) {
    try {
      const r = await Promise.race([
        api(`/api/match?title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist || "")}&dur=${Math.round(t.fullDuration || (t.youtube ? 0 : t.duration) || 0)}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 9000)),
      ]);
      t.ytAlt = r.ids || [];
    } catch (e) {
      t.ytAlt = [];
      if (/limit/i.test(e.message) && !ytQuotaWarned) { ytQuotaWarned = true; toast("YouTube's daily search limit is used up — new songs open in the YouTube Music window until tomorrow"); }
    }
  }
  return [...new Set([...own, ...t.ytAlt])];
}
/* start playing a song on the right engine */
async function startEngine(id, startAt = 0) {
  const t = T(id); if (!t) return;
  const gen = P.gen = (P.gen || 0) + 1;
  const stale = () => gen !== P.gen || P.current !== id;
  P.loaded = id; P.wantPlay = true;
  clearTimeout(P.watch); YP.cur = null;
  const local = !t.online;
  if (E.mode === "external") { E.mode = "audio"; showYtMini(false); stopYtm(); } // not awaited: the next song must not wait for the old page
  // sound effects (equalizer / singer volume) can't reach Spotify's own player: with one switched on, the song plays through YouTube Music
  let spHere = isSp(id) && spCanStream();
  if (spHere && typeof fxWanted === "function" && fxWanted()) {
    if (EXT.native === null) await ytmDetect();
    if (stale()) return;
    if (EXT.native) spHere = false;
  }
  // Nagham's own player: yt-dlp finds the song's audio, Nagham keeps it in a cache while it plays —
  // no YouTube Music page (no ads, much lighter). If a song can't play this way, YouTube Music below is the backup.
  if (!local && !spHere && t.src !== "au" && ypOn()) {
    const vid = await ypVideo(id);
    if (stale()) return;
    if (vid) {
      if (E.mode === "youtube") { ytStop(); }
      if (E.mode === "external") { try { stopYtm(); } catch {} }
      E.mode = "audio"; showYtMini(false);
      t.ypNow = vid; YP.cur = { id, vid, gen };
      postLog(`own player #${gen} ${t.title} → ${vid}`);
      audio.src = "/api/yt/audio/" + vid;
      if (startAt) audio.currentTime = startAt;
      audio.play().catch(err => { if (err.name !== "AbortError") console.warn(err); });
      ypWatch(id, vid, gen);
      ypPrepNext();
      return;
    }
  }
  if (!local && !spHere) {
    if (EXT.native === null) await ytmDetect();
    const vids = (await ytCandidates(id)).filter(v => !(t.ytFailed || []).includes(v));
    if (stale()) return;
    // inside Nagham's own window YouTube blocks embedded players (error 150), so songs go
    // straight to the hidden YouTube Music player instead of trying (and failing) first
    if (vids.length && !EXT.native) {
      audio.pause(); audio.removeAttribute("src");
      if (E.mode === "spotify") { try { spPauseSdk(); } catch {} SPP.paused = true; }
      E.mode = "youtube"; t.ytNow = vids[0];
      try { await ytPlay(vids[0], startAt); if (stale()) return; ytWatch(id, vids[0]); return; }
      catch (err) { console.warn(err); t.ytFailed = [...(t.ytFailed || []), vids[0]]; }
    }
  }
  if (stale()) return;
  if (E.mode === "youtube") { ytStop(); E.mode = "audio"; }
  showYtMini(false); // never leave a dead video box on screen
  if (spHere) {
    audio.pause(); audio.removeAttribute("src");
    E.mode = "spotify";
    try { await spPlayUri(t.uri, startAt); return; }
    catch (err) { console.warn(err); toast("Spotify player: " + err.message); }
  }
  if (E.mode === "spotify") { try { spPauseSdk(); } catch {} E.mode = "audio"; SPP.paused = true; }
  // no 30-second clips: songs that can't play in full here open in YouTube Music
  const fullHere = local || (t.src === "au");
  if (!fullHere) { await playElsewhere(id, startAt, gen); return; }
  const src = id;
  audio.src = audioURL(src);
  if (startAt) audio.currentTime = startAt;
  audio.play().catch(err => { if (err.name !== "AbortError") console.warn(err); });
  audioWatch(id, src, startAt);
}
/* iPhone: while YouTube Music plays hidden, this page keeps a silent sound running so iOS doesn't freeze it
   in the background (it has to start the next song when one ends) */
const IOSKEEP = { ctx: null, on: false };
function iosKeepAlive(on) {
  if (!IOS || IOSKEEP.on === on) return;
  IOSKEEP.on = on;
  try {
    if (on) {
      if (!IOSKEEP.ctx) {
        const C = window.AudioContext || window.webkitAudioContext; IOSKEEP.ctx = new C();
        const o = IOSKEEP.ctx.createOscillator(), g = IOSKEEP.ctx.createGain();
        g.gain.value = 0.00001; o.frequency.value = 30; o.connect(g); g.connect(IOSKEEP.ctx.destination); o.start();
      }
      IOSKEEP.ctx.resume();
    } else IOSKEEP.ctx?.suspend();
  } catch (e) { console.warn(e); }
}
setInterval(() => { if (IOS) iosKeepAlive(!!(P.current && P.wantPlay && (E.mode === "external" || E.mode === "youtube"))); }, 1500);
/* ---- Nagham's own player for YouTube songs (yt-dlp + a cache) ---- */
const YP = { cur: null, fails: 0, offUntil: 0 };
function ypOn() { return settings.ytdlpPlay !== false && Date.now() > YP.offUntil; }
async function ypVideo(id) {
  const t = T(id); if (!t) return null;
  const bad = t.ypFailed || [];
  if (isYt(id)) return bad.includes(id.slice(3)) ? null : id.slice(3);
  if (!t.ypIds) {
    try {
      const r = await Promise.race([
        api(`/api/yt/find?title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist || "")}&dur=${Math.round(t.fullDuration || t.duration || 0)}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 30000)),
      ]);
      t.ypIds = r.ids || [];
    } catch { t.ypIds = []; }
  }
  return [...t.ypIds, ...(t.ytAlt || [])].find(v => !bad.includes(v)) || null;
}
// a song didn't play this way: its next video, then the YouTube Music player
function ypFail(id, vid, why) {
  const t = T(id); if (!t || P.current !== id) return;
  const at = Math.max(0, audio.currentTime || 0);
  postLog(`own player failed ${t.title} (${vid}): ${why}`);
  t.ypFailed = [...(t.ypFailed || []), vid];
  YP.cur = null;
  if (++YP.fails >= 3) { YP.offUntil = Date.now() + 10 * 60 * 1000; YP.fails = 0; postLog("own player: several songs failed in a row — YouTube Music for 10 minutes"); }
  audio.pause(); audio.removeAttribute("src");
  P.loaded = null;
  startEngine(id, at > 2 ? at : 0);
}
function ypWatch(id, vid, gen) {
  clearTimeout(P.watch);
  P.watch = setTimeout(() => {
    if (P.current !== id || P.gen !== gen || E.mode !== "audio" || !YP.cur || YP.cur.vid !== vid) return;
    if (audio.paused && !P.wantPlay) return;
    if (audio.readyState >= 3 && !audio.paused) return;
    if (audio.readyState >= 1) { ypWatch(id, vid, gen); return; } // started arriving: give it more time
    ypFail(id, vid, "took too long to start");
  }, 30000);
}
// get the next song ready while this one plays, so skipping is instant
function ypPrepNext() {
  const ids = [];
  if (P.upNext?.length) ids.push(P.upNext[0]);
  else if (P.order?.length && P.opos + 1 < P.order.length) ids.push(P.ctx[P.order[P.opos + 1]]);
  for (const nid of ids) {
    const t = T(nid); if (!t || !t.online || t.src === "au") continue;
    // a few seconds later, so the song that's starting gets the whole connection first
    if (isYt(nid)) setTimeout(() => api("/api/yt/prep?id=" + nid.slice(3)).catch(() => {}), 2000);
    else setTimeout(() => { if (T(nid) && !T(nid).ypIds) api(`/api/yt/find?prep=1&title=${encodeURIComponent(T(nid).title)}&artist=${encodeURIComponent(T(nid).artist || "")}&dur=${Math.round(T(nid).fullDuration || T(nid).duration || 0)}`).then(r => { T(nid).ypIds = r.ids || []; }).catch(() => {}); }, 2000);
  }
}
audio.addEventListener("playing", () => { if (YP.cur && P.current === YP.cur.id) YP.fails = 0; });
// seeking while the song is still arriving: a spot that isn't seekable yet loads again from the cache once it can
function ypSeek(v, tries = 0) {
  const c = YP.cur; if (!c || P.current !== c.id || E.mode !== "audio") return false;
  const sk = audio.seekable;
  for (let i = 0; i < sk.length; i++) if (v >= sk.start(i) && v <= sk.end(i) + 0.5) return false; // it can jump there itself
  const paused = audio.paused && !P.wantPlay;
  audio.src = "/api/yt/audio/" + c.vid + "?r=" + Date.now();
  audio.addEventListener("loadedmetadata", () => {
    try { audio.currentTime = v; } catch {}
    if (!paused) audio.play().catch(() => {});
    // still arriving and that spot isn't here yet: try again in a moment
    if (tries < 15) setTimeout(() => { if (YP.cur === c && audio.currentTime < v - 3) ypSeek(v, tries + 1); }, 2000);
  }, { once: true });
  return true;
}

/* the refresh button: start the current song again from where it is, with a clean player */
let reloading = false;
async function reloadSong(auto) {
  if (!P.current || reloading) return;
  reloading = true;
  const id = P.current, at = Math.max(0, E.time || 0);
  document.body.classList.add("reloading");
  postLog(`reload song ${T(id)?.title} at ${at.toFixed(0)}s (${auto ? "automatic" : "button"}), mode=${E.mode}`);
  toast(auto ? "The song didn't start — reloading it…" : "Reloading the song…");
  try {
    clearTimeout(P.watch);
    audio.pause(); audio.removeAttribute("src");
    try { ytStop?.(); } catch {}
    if (EXT.embedded || E.mode === "external") { EXT.embedded = false; EXT.playing = false; EXT.st = null; ytmQ = Promise.resolve(); await ytmApi({ url: "", visible: false, hidden: false }); await new Promise(r => setTimeout(r, 350)); }
    if (P.current !== id) return;
    if (T(id)?.ytFailed) T(id).ytFailed = [];
    P.loaded = null; P.wantPlay = true;
    await startEngine(id, at > 3 ? at : 0);
    renderPP(); renderNP(); markPlaying();
  } finally { setTimeout(() => { reloading = false; document.body.classList.remove("reloading"); }, 1200); }
}
$("#topReload").onclick = $("#fReload").onclick = () => reloadSong(false);
/* size & place of the YouTube Music window (Settings → Playback) */
function ytmFeatures() {
  const [w, h] = { s: [440, 680], m: [900, 700], l: [1180, 780] }[settings.ytmSize || "l"];
  const aw = screen.availWidth, ah = screen.availHeight, ax = screen.availLeft || 0, ay = screen.availTop || 0;
  const pos = settings.ytmPos || "right";
  const left = Math.round(pos === "left" ? ax + 16 : pos === "center" ? ax + (aw - w) / 2 : ax + aw - w - 16);
  const top = Math.round(pos === "center" ? ay + (ah - h) / 2 : ay + Math.max(0, ah - h - 40));
  return `width=${w},height=${h},left=${left},top=${top}`;
}
function reopenYtm() {
  if (!EXT.url) return toast("Nothing is playing in YouTube Music right now");
  try { EXT.win?.close(); } catch {}
  setTimeout(() => { EXT.win = window.open(EXT.url, "nagham-ytmusic", ytmFeatures()); }, 250);
}
/* is this Nagham's own window (YouTube Music can play hidden inside it)? */
async function ytmDetect() {
  if (EXT.native !== null) return EXT.native;
  if (!window.chrome?.webview && !IOS && !window.NAGHAM_MAC) return (EXT.native = false);
  try { const r = await api("/api/ytm", {}); EXT.native = !!r?.native; } catch { EXT.native = false; }
  return EXT.native;
}
function stopYtm() {
  if (!EXT.embedded) return Promise.resolve();
  EXT.embedded = false; EXT.playing = false; EXT.st = null;
  return ytmApi({ url: "", visible: false, hidden: false });
}
/* the full song from YouTube Music: hidden inside Nagham (own window), or in a YouTube Music window */
async function playElsewhere(id, startAt = 0, gen) {
  const t = T(id); if (!t) return;
  audio.pause(); audio.removeAttribute("src");
  if (settings.elsewhere === "skip") { toast(`“${t.title}” can't play in full here — skipping`); setTimeout(() => next(true), 600); return; }
  const vid = isYt(id) ? id.slice(3) : (t.ytAlt || []).find(v => !(t.ytFailed || []).includes(v));
  const url = vid ? "https://music.youtube.com/watch?v=" + vid
    : "https://music.youtube.com/search?q=" + encodeURIComponent(`${(t.artist || "").split(",")[0]} ${t.title}`.trim());
  E.mode = "external"; EXT.id = id; EXT.url = url;
  EXT.embedded = false;
  if (await ytmDetect()) {
    // fast skipping: only the song you stop on is opened (YouTube Music isn't asked to load every song you pass)
    await new Promise(r => setTimeout(r, 280));
    if (gen && gen !== P.gen) return;
    Object.assign(EXT, { embedded: true, playing: true, st: null, stAt: 0, vid: vid || null, sawPlay: false, endFired: false, startAt: startAt || 0, seekTo: startAt || 0,
      startedAt: Date.now(), nudgeAt: Date.now(), helpShown: false, lastT: 0, lastD: 0, cmdAt: 0, volAt: 0, gen: P.gen, tag: String(P.gen), tagSeen: false, autoReloaded: false });
    postLog(`ytm load #${P.gen} ${t.title} → ${url}`);
    // a fresh "n=" makes the same song load again (repeat one / play again)
    await ytmApi({ url: url + "&nagham=" + P.gen, hidden: true, visible: false, vol: Math.max(0, Math.min(1, effVol())) });
    ytmWatchLoad(P.gen, url);
    showYtMini(false); syncYtmRect(true);
    renderPP(); renderNP(); renderTime(true); markPlaying(); discordUpdate(true);
    return;
  }
  let w = null;
  try { w = window.open(url, "nagham-ytmusic", ytmFeatures()); } catch {}
  if (!w) await api("/api/openurl", { url }).catch(() => {});
  EXT.win = w;
  renderPP(); renderNP(); markPlaying(); discordUpdate(true);
  if (!settings.extTipShown) { settings.extTipShown = true; saveUser(); toast("YouTube doesn't let this song play inside other apps — it's playing in full in the YouTube Music window"); }
  else toast("Playing in the YouTube Music window");
}
/* if the page never switched to the new song (a lost message), send it again – at most twice */
function ytmWatchLoad(gen, url, tries = 0) {
  setTimeout(() => {
    if (gen !== P.gen || !extOn() || EXT.sawPlay || tries >= 3) return;
    const st = EXT.st;
    if (EXT.tagSeen || (st && st.ng && String(st.ng).startsWith(String(gen)))) return; // the new page is there
    postLog(`ytm page didn't change to the new song, sending it again (${tries + 1})`);
    ytmApi({ url: url + "&nagham=" + gen + "r" + (tries + 1), hidden: true, visible: false, vol: Math.max(0, Math.min(1, effVol())) });
    ytmWatchLoad(gen, url, tries + 1);
  }, tries ? 4500 : 4000);
}
/* what the hidden YouTube Music player is doing → Nagham's player bar */
function onYtmState(s) {
  if (!s || s.err || !extOn() || EXT.gen !== P.gen) return;
  if (s.act === "next") { next(); return; }
  if (s.act === "prev") { prev(); return; }
  // every load carries a tag (nagham=<n>): a report from an older page (previous song) is ignored for good
  const ours = !!s.ng && (String(s.ng) === EXT.tag || String(s.ng).startsWith(EXT.tag + "r"));
  if (ours && !EXT.tagSeen) { EXT.tagSeen = true; postLog(`ytm page for #${EXT.tag} is up (${s.vid || s.path})`); }
  if (s.ng && !ours) return;
  if (!EXT.vid && s.path === "/watch" && s.vid && !s.p) EXT.vid = s.vid; // started from a search
  if (EXT.vid && s.vid && s.vid !== EXT.vid && !EXT.sawPlay) return;    // still the previous page
  if (s.path !== "/watch" && !EXT.sawPlay) { if (!EXT.st) EXT.st = { ...s, ok: false }; checkYtmStuck(); return; }
  const now = Date.now();
  const playing = s.ok && !s.p && s.rs >= 2;
  // YouTube Music jumped to another song by itself (its own skip / autoplay) while hidden: follow along in Nagham
  if (EXT.sawPlay && EXT.vid && s.vid && s.vid !== EXT.vid && !$("#ytmini").classList.contains("on") && !EXT.endFired) {
    EXT.endFired = true; postLog(`ytm moved on by itself ${EXT.vid} → ${s.vid} at ${EXT.lastT?.toFixed?.(0)}/${EXT.lastD?.toFixed?.(0)}`);
    ytmCmd(YTM_PAUSE); next(true); return;
  }
  // end of the song: our own flag, or YouTube Music moved on to its next song
  const movedOn = EXT.sawPlay && EXT.vid && s.vid && s.vid !== EXT.vid && EXT.lastD > 0 && EXT.lastT > EXT.lastD - 4;
  if ((s.e || movedOn) && EXT.sawPlay && !EXT.endFired) {
    EXT.endFired = true; EXT.playing = false;
    ytmCmd(YTM_PAUSE);
    next(true); return;
  }
  if (now - (EXT.seekAt || 0) < 900) s.t = extTime(); // a seek is on its way
  EXT.st = s; EXT.stAt = now;
  if (!s.ad && s.d > 1 && s.vid === (EXT.vid || s.vid)) { EXT.lastT = s.t; EXT.lastD = s.d; }
  if (playing && !s.ad && !EXT.sawPlay) {
    EXT.sawPlay = true;
    ytmVolume();
    try { ytmFxSend(true); } catch {}
    if (EXT.startAt > 1) extSeek(EXT.startAt);
    EXT.startAt = 0;
    renderNP();
  }
  // play / pause pressed inside YouTube Music itself (video shown)
  if (EXT.sawPlay && now - (EXT.cmdAt || 0) > 1500 && s.ok) {
    const was = EXT.playing; EXT.playing = !s.p;
    if (was !== EXT.playing) onEnginePause();
  }
  // the page loaded but didn't start by itself: press play for it
  if (!EXT.sawPlay && EXT.playing && s.ok && s.p && now - EXT.nudgeAt > 2500) { EXT.nudgeAt = now; ytmCmd(YTM_PLAY); }
  // keep the volume in step
  const want = effVol();
  if (EXT.sawPlay && s.ok && s.vol >= 0 && Math.abs(s.vol - want) > .02 && now - (EXT.volAt || 0) > 1500) ytmVolume();
  checkYtmStuck();
  onEngineTime();
}
/* nothing playing after a while (sign-in, cookies, an unavailable video…): show the page */
function checkYtmStuck() {
  if (!EXT.sawPlay && EXT.playing && !EXT.autoReloaded && !reloading && Date.now() - EXT.startedAt > 12000) { EXT.autoReloaded = true; reloadSong(true); return; }
  if (EXT.sawPlay || !EXT.playing || EXT.helpShown || Date.now() - EXT.startedAt < 15000) return;
  EXT.helpShown = true;
  const st = EXT.st || {};
  postLog(`ytm didn't start: url=${EXT.url} path=${st.path} ok=${st.ok} paused=${st.p} rs=${st.rs} vid=${st.vid}`);
  toast("This song didn't start on YouTube Music — playing the next one");
  next(true);
}
function ytmVolume() {
  if (!extOn()) return;
  EXT.volAt = Date.now();
  const v = effVol();
  ytmCmd(`(() => { const v = document.querySelector('video'); if (v) { v.muted = false; v.volume = ${v.toFixed(3)}; } })()`);
}
let ytmPolling = false;
setInterval(async () => {
  if (!extOn() || ytmPolling) return;
  ytmPolling = true;
  try { const r = await api("/api/ytm/state"); if (r?.state && r.act) r.state.act = r.act; onYtmState(r?.state); } catch {} finally { ytmPolling = false; }
}, 500);
setInterval(() => { if (extOn() && EXT.playing && EXT.sawPlay) renderTime(); }, 500);
setInterval(() => { if (extOn() && EXT.playing && !EXT.sawPlay) checkYtmStuck(); }, 2000);
/* show / hide the YouTube Music page (the music keeps playing either way) */
function showYtVideo(on, temp) {
  if (!temp) { settings.ytmShow = !!on; saveUser(); }
  showYtMini(!!on);
  syncYtmRect(true);
  renderPP();
}
/* a song that never starts (or stops loading) is retried once, then skipped */
function audioWatch(id, src, startAt, retried) {
  clearTimeout(P.watch);
  P.watch = setTimeout(() => {
    if (P.current !== id || E.mode !== "audio" || audio.paused && !P.wantPlay) return;
    if (audio.readyState >= 3 && !audio.paused) return;
    if (!retried) {
      const at = audio.currentTime || startAt || 0;
      audio.src = audioURL(src) + (audioURL(src).includes("?") ? "&" : "?") + "r=" + Date.now();
      audio.currentTime = at; audio.play().catch(() => {});
      audioWatch(id, src, at, true);
    } else { toast(`“${T(id)?.title}” isn't loading — skipping`); next(true); }
  }, retried ? 12000 : 9000);
}
audio.addEventListener("stalled", () => { if (E.mode === "audio" && P.current && !audio.paused && !(YP.cur && YP.cur.id === P.current)) audioWatch(P.current, P.loaded && T(P.current)?.fallback || P.current, audio.currentTime); });
audio.addEventListener("playing", () => clearTimeout(P.watch));
/* YouTube video that never starts: nudge it, then try the next one */
function ytWatch(id, vid) {
  clearTimeout(P.watch);
  YTS.started = false;
  P.watch = setTimeout(() => {
    if (P.current !== id || E.mode !== "youtube" || YTS.started) return;
    try { YTS.player?.playVideo(); } catch {}
    P.watch = setTimeout(() => {
      if (P.current !== id || E.mode !== "youtube" || YTS.started) return;
      let st = "?"; try { st = YTS.player?.getPlayerState?.(); } catch {}
      postLog(`youtube never started video=${vid} state=${st} origin=${location.origin}`);
      const t = T(id); if ((t.ytFailed || []).includes(vid)) return; t.ytFailed = [...(t.ytFailed || []), vid];
      startEngine(id, 0);
    }, 7000);
  }, 9000);
}
function next(auto) {
  if (auto && typeof sleepAtSongEnd === "function" && sleepAtSongEnd()) return;
  if (settings.repeat === "one" && auto) { if (E.mode === "spotify" || E.mode === "external") startEngine(P.current, 0); else if (E.mode === "youtube") { E.time = 0; E.play(); } else { audio.currentTime = 0; audio.play(); } return; }
  if (P.upNext.length) { playId(P.upNext.shift(), true); return; }
  if (!P.order.length) return;
  if (P.opos + 1 < P.order.length) P.opos++;
  else if (settings.repeat === "all" || !auto) { if (settings.shuffle) buildOrder(-1); else P.opos = 0; }
  else { if (auto && typeof startRadio === "function" && startRadio()) return; E.pause(); if (E.mode === "audio") audio.currentTime = 0; markPlaying(); renderPP(); return; }
  playId(P.ctx[P.order[P.opos]]);
}
function prev() {
  if (E.time > 3 || !P.order.length) { E.time = 0; return; }
  if (P.fromUpNext) { playId(P.ctx[P.order[P.opos]]); return; }
  if (P.opos > 0) P.opos--; else if (settings.repeat === "all") P.opos = P.order.length - 1; else { E.time = 0; return; }
  playId(P.ctx[P.order[P.opos]]);
}
function togglePlay() {
  if (!P.current) {
    const ids = lib.tracks.length ? lib.tracks.map(t => t.id) : (playLists.local?.ids || playLists.world?.ids || []);
    if (ids.length) playContext(ids, 0, { type: lib.tracks.length ? "songs" : "chart", id: "", name: lib.tracks.length ? (IOS ? "My songs" : "On this PC") : "Top songs" });
    return;
  }
  if (P.loaded !== P.current) { startEngine(P.current, settings.lastPos || 0); return; }
  E.paused ? E.play() : E.pause();
}
function addUpNext(ids, front) {
  if (front) P.upNext.unshift(...ids); else P.upNext.push(...ids);
  if (!P.current) playId(P.upNext.shift(), true);
  renderQueue(); toast(front ? "Playing next" : "Added to queue");
}
function setShuffle(on) {
  settings.shuffle = on;
  if (P.ctx.length) {
    const curIdx = P.order[P.opos];
    if (on) buildOrder(P.fromUpNext ? -1 : curIdx); else { P.order = [...Array(P.ctx.length).keys()]; P.opos = curIdx ?? 0; }
  }
  renderModes(); saveUser(); renderQueue();
}
function cycleRepeat() {
  settings.repeat = settings.repeat === "off" ? "all" : settings.repeat === "all" ? "one" : "off";
  renderModes(); saveUser();
  toast({ off: "Repeat off", all: "Repeat all", one: "Repeat one" }[settings.repeat]);
}
function renderModes() {
  for (const b of [$("#repeat"), $("#fRepeat")]) {
    b.innerHTML = IC.repeat + (settings.repeat === "one" ? '<span class="one">1</span>' : "");
    b.classList.toggle("on", settings.repeat !== "off");
  }
  for (const b of [$("#shuffle"), $("#fShuffle")]) { b.innerHTML = IC.shuffle; b.classList.toggle("on", !!settings.shuffle); }
}

function onEnginePlay() { P.wantPlay = true; if (E.mode !== "youtube") showYtMini(false); renderPP(); markPlaying(); discordUpdate(true); }
function onEnginePause() { renderPP(); markPlaying(); saveUser(); discordUpdate(true); }
audio.addEventListener("ended", () => next(true));
audio.addEventListener("play", onEnginePlay);
audio.addEventListener("pause", onEnginePause);
audio.addEventListener("error", () => {
  if (!P.current || !P.wantPlay || E.mode !== "audio" || !audio.getAttribute("src")) return;
  if (YP.cur && YP.cur.id === P.current && audio.getAttribute("src").startsWith("/api/yt/audio/")) { ypFail(P.current, YP.cur.vid, "the player couldn't read it"); return; }
  const t = T(P.current);
  toast(t?.online ? `“${t.title}” isn't available right now — skipping` : `Can't play “${t?.title}” — skipping`);
  setTimeout(() => next(true), 900);
});
audio.addEventListener("loadedmetadata", () => {
  const t = T(P.current);
  if (t?.spotify) { renderTime(); return; }
  if (t && isFinite(audio.duration) && Math.abs((t.duration || 0) - audio.duration) > 1.5) {
    t.duration = audio.duration;
    if (!t.online) api("/api/durations", { [t.id]: audio.duration }).catch(() => {});
  }
  renderTime();
});
let lastSave = 0;
function onEngineTime() {
  renderTime();
  if (Date.now() - lastSave > 5000) { lastSave = Date.now(); settings.lastPos = E.time; saveUser(); }
  const d = E.duration;
  if ("mediaSession" in navigator && isFinite(d) && d > 0) try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(E.time, d), playbackRate: 1 }); } catch {}
}
audio.addEventListener("timeupdate", () => { if (E.mode === "audio") onEngineTime(); });

/* ------------------------------------------------------------ player bar */
const seek = $("#seek"), fSeek = $("#fSeek"), vol = $("#vol");
let seeking = false;
function setP(el) { el.style.setProperty("--p", (el.value - el.min) / (el.max - el.min) * 100 + "%"); }
let rtAt = 0;
function renderTime(force) {
  // the time and the bar: at most twice a second, and not at all while Nagham can't be seen
  if (!force && (document.hidden || Date.now() - rtAt < 450)) return;
  rtAt = Date.now();
  const d = E.duration || T(P.current)?.duration || 0;
  const cur = fmt(E.time || 0).replace("–:––", "0:00");
  $("#dur").textContent = $("#fDur").textContent = fmt(d);
  if (!seeking) {
    $("#cur").textContent = $("#fCur").textContent = cur;
    const full = $("#full").classList.contains("open");
    for (const s of full ? [seek, fSeek] : [seek]) { s.value = d ? E.time / d * 1000 : 0; setP(s); }
  }
}
for (const s of [seek, fSeek]) {
  s.addEventListener("input", () => { seeking = true; const d = E.duration || 0; $("#cur").textContent = $("#fCur").textContent = fmt(s.value / 1000 * d); setP(s); });
  s.addEventListener("change", () => { const d = E.duration; if (d) E.time = s.value / 1000 * d; seeking = false; setTimeout(() => discordUpdate(true), 300); });
}
function renderPP() {
  const paused = E.paused;
  for (const b of [$("#pp"), $("#fPP")]) { b.innerHTML = paused ? IC.play : IC.pause; b.title = paused ? "Play (Space)" : "Pause (Space)"; }
  document.body.classList.toggle("paused", paused);
  $("#full").classList.toggle("paused", paused);
  for (const vb of [$("#vidBtn"), $("#fVid")]) { const can = false; /* the YouTube Music page is never shown */ vb.hidden = !can; vb.classList.toggle("on", can && $("#ytmini").classList.contains("on")); vb.title = vb.classList.contains("on") ? "Hide the YouTube Music video (the song keeps playing)" : "Show the YouTube Music video"; }
  updateTitle();
}
$("#vidBtn").onclick = $("#fVid").onclick = () => showYtVideo(!$("#ytmini").classList.contains("on"));
function updateTitle() {
  const t = T(P.current);
  document.title = t ? `${E.paused ? "❚❚" : "♪"}  ${t.title} — ${t.artist}  ·  Nagham` : "Nagham";
  if (winState.title !== document.title) { winState.title = document.title; windowSync(); }
}
/* VOLMUL lets the sleep timer and crossfade fade the music without touching your volume setting */
let VOLMUL = 1;
const effVol = () => (settings.muted ? 0 : (settings.volume ?? .8)) * VOLMUL;
let ytmVolTimer = 0;
function ytmSetVol(now) { // the hidden YouTube Music page is kept at Nagham's volume from the very first moment of every song
  if (!(EXT.embedded || E.mode === "external")) return;
  clearTimeout(ytmVolTimer);
  const go = () => ytmApi({ vol: Math.max(0, Math.min(1, effVol())) });
  if (now) go(); else ytmVolTimer = setTimeout(go, 90);
}
function applyEngineVolume() {
  audio.volume = Math.max(0, Math.min(1, (settings.volume ?? .8) * VOLMUL)); audio.muted = settings.muted;
  try { spSetVolume(effVol()); } catch {}
  try { ytVolume(); } catch {}
  if (extOn()) ytmVolume();
  ytmSetVol();
}
function renderVol() {
  audio.volume = Math.max(0, Math.min(1, settings.volume * VOLMUL)); audio.muted = settings.muted;
  spSetVolume(effVol());
  ytVolume();
  if (extOn()) ytmVolume();
  ytmSetVol();
  vol.value = settings.muted ? 0 : Math.round(settings.volume * 100); setP(vol);
  const v = settings.muted ? 0 : settings.volume;
  $("#mute").innerHTML = v === 0 ? IC.vol0 : v < .5 ? IC.vol1 : IC.vol3;
}
vol.addEventListener("input", () => { settings.volume = vol.value / 100; settings.muted = settings.volume === 0; renderVol(); saveUser(); });
$("#mute").onclick = () => { if (settings.volume === 0) settings.volume = .5; settings.muted = !settings.muted; renderVol(); saveUser(); };
$("#pp").onclick = $("#fPP").onclick = togglePlay;
$("#next").onclick = $("#fNext").onclick = () => next(false);
$("#prev").onclick = $("#fPrev").onclick = prev;
$("#prev").innerHTML = $("#fPrev").innerHTML = IC.prev;
$("#next").innerHTML = $("#fNext").innerHTML = IC.next;
$("#shuffle").onclick = $("#fShuffle").onclick = () => { setShuffle(!settings.shuffle); toast(settings.shuffle ? "Shuffle on" : "Shuffle off"); };
$("#repeat").onclick = $("#fRepeat").onclick = cycleRepeat;
$("#qBtn").onclick = () => toggleQueue();
$("#closeQ").onclick = () => toggleQueue(false);
$("#fullBtn").onclick = () => toggleFull();
function toggleQueue(on) {
  const a = $("#app"); on = on ?? !a.classList.contains("show-queue");
  a.classList.toggle("show-queue", on); $("#qBtn").classList.toggle("on", on); renderQueue();
}

function renderNP() {
  const t = T(P.current);
  if (!t) { $("#np").innerHTML = ""; return; }
  const liked = lib.liked.has(t.id);
  $("#np").innerHTML = `<div class="art" data-npfull title="Full-screen player">${trackArt(t.id, true)}</div>
    <div class="meta"><div class="t" data-npalbum><span>${esc(t.title)}</span>${badge(t)}</div><div class="a" data-npartist>${E.mode === "external" && EXT.id === t.id && !EXT.embedded ? '<span style="color:#ff4e45">▶ Playing in YouTube Music</span>' : esc(t.artist)}</div></div>
    <button class="icon-btn ${liked ? "on" : ""}" id="npLike" title="${liked ? "Remove from Liked Songs" : "Save to Liked Songs"}">${liked ? IC.heartOn : IC.heart}</button>`;
}
function goArtistOf(t) {
  if (!t) return;
  if (t.spotify && t.artistId) return go("spartist", t.artistId.slice(4));
  if (t.online) { if (t.artistId && /^(dz|au):/.test(t.artistId)) go("oartist", t.artistId); else { $("#q").value = t.artist; go("search", t.artist); } }
  else go("artist", lib.trackArtist[t.id]);
}
function goAlbumOf(t) {
  if (!t) return;
  if (t.spotify && t.albumId) return go("spalbum", t.albumId.slice(5));
  if (t.online) { if (t.albumId && /^(dz|it):/.test(t.albumId)) go("oalbum", t.albumId); }
  else go("album", lib.trackAlbum[t.id]);
}
$("#np").addEventListener("click", e => {
  const t = T(P.current); if (!t) return;
  if (e.target.closest("#npLike")) toggleLike([t.id]);
  else if (e.target.closest("[data-npfull]") || PHONE()) toggleFull(true);
  else if (e.target.closest("[data-npalbum]")) goAlbumOf(t);
  else if (e.target.closest("[data-npartist]")) goArtistOf(t);
});

/* full-screen now playing */
function toggleFull(on) {
  const f = $("#full"); on = on ?? !f.classList.contains("open");
  if (on && !P.current) return toast("Play something first");
  f.classList.toggle("open", on); if (on) renderFull();
  requestAnimationFrame(placeYtMini);
}
/* the blurred backdrop of the full-screen player: a tiny canvas stretched up (cheap) instead of a huge CSS blur (laggy) */
let fbgTok = 0;
function paintFullBg(src, t) {
  const box = $("#fbg"); if (!box) return;
  const key = src || ("ph:" + t.id);
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  const tok = ++fbgTok;
  const draw = img => {
    if (tok !== fbgTok) return;
    const c = document.createElement("canvas"); c.width = c.height = 48;
    const x = c.getContext("2d");
    if (img) { try { x.filter = "blur(2px)"; } catch {} x.drawImage(img, -4, -4, 56, 56); }
    else { const g = x.createLinearGradient(0, 0, 48, 48); phColors(albumKeyOf(t.id) || t.id).forEach((col, i, arr) => g.addColorStop(arr.length > 1 ? i / (arr.length - 1) : 0, col)); x.fillStyle = g; x.fillRect(0, 0, 48, 48); }
    box.replaceChildren(c);
  };
  if (!src) return draw(null);
  const im = new Image(); im.onload = () => draw(im); im.onerror = () => draw(null); im.src = src;
}
function renderFull() {
  if (!$("#full").classList.contains("open")) return;
  const t = T(P.current); if (!t) return;
  const src = coverOf(t.id);
  paintFullBg(src, t);
  $("#fArt").innerHTML = trackArt(t.id);
  $("#fKind").innerHTML = `${P.ctxInfo?.name ? "Playing from " + esc(P.ctxInfo.name) : "Now playing"} ${badge(t)}`;
  $("#fTitle").textContent = t.title;
  $("#fArtist").textContent = t.artist;
  const liked = lib.liked.has(t.id);
  $("#fLike").innerHTML = liked ? IC.heartOn.replace('width="17" height="17"', "") : IC.heart.replace('width="17" height="17"', "");
  $("#fLike").classList.toggle("on", liked);
  const nx = P.upNext[0] || (P.opos + 1 < P.order.length ? P.ctx[P.order[P.opos + 1]] : null);
  $("#fNextUp").textContent = nx && T(nx) ? `Next: ${T(nx).title} • ${T(nx).artist}` : "";
  renderPP(); renderTime(true);
}
$("#fClose").onclick = () => toggleFull(false);
$("#fLike").onclick = () => P.current && toggleLike([P.current]);
$("#fShare").onclick = () => P.current && shareSong(P.current);
$("#fArtist").onclick = () => { toggleFull(false); goArtistOf(T(P.current)); };

function renderQueue() {
  if (!$("#app").classList.contains("show-queue")) return;
  const row = (id, i, kind) => { const t = T(id); if (!t) return ""; return `<div class="lib-item ${kind === "now" ? "playing" : ""}" data-q="${kind}:${i}"><div class="art">${trackArt(id, true)}</div><div class="meta"><div class="name">${esc(t.title)}</div><div class="sub">${esc(t.artist)}</div></div></div>`; };
  let h = "";
  if (P.current) h += `<h4>Now playing</h4>` + row(P.current, 0, "now");
  if (P.upNext.length) h += `<h4>Next in queue</h4>` + P.upNext.map((id, i) => row(id, i, "up")).join("");
  const rest = P.order.slice(P.opos + 1, P.opos + 51);
  if (rest.length) h += `<h4>Next from: ${esc(P.ctxInfo?.name || "your library")}</h4>` + rest.map((ci, i) => row(P.ctx[ci], i, "ctx")).join("");
  if (!h) h = `<div class="empty" style="padding:40px 16px"><p>Your queue is empty.<br>Double-click a song to start listening.</p></div>`;
  $("#qBody").innerHTML = h;
}
$("#qBody").addEventListener("dblclick", e => {
  const it = e.target.closest("[data-q]"); if (!it) return;
  const [kind, i] = it.dataset.q.split(":");
  if (kind === "up") playId(P.upNext.splice(+i, 1)[0], true);
  if (kind === "ctx") { P.opos += +i + 1; playId(P.ctx[P.order[P.opos]]); }
});
$("#qBody").addEventListener("contextmenu", e => {
  const it = e.target.closest("[data-q^='up:']"); if (!it) return; e.preventDefault();
  const i = +it.dataset.q.split(":")[1];
  menu(e.clientX, e.clientY, [{ label: "Remove from queue", icon: IC.trash, act: () => { P.upNext.splice(i, 1); renderQueue(); } }, { label: "Clear queue", icon: IC.trash, act: () => { P.upNext = []; renderQueue(); } }]);
});

/* media keys / Windows media overlay */
function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const t = T(P.current); if (!t) return;
  const c = coverOf(t.id);
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || "", artwork: [{ src: location.origin + (c || "/icon.svg"), sizes: "512x512" }] });
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => togglePlay());
  ms.setActionHandler("pause", () => E.pause());
  ms.setActionHandler("previoustrack", prev);
  ms.setActionHandler("nexttrack", () => next(false));
  try { ms.setActionHandler("seekto", d => { E.time = d.seekTime; }); } catch {}
}

/* keyboard */
const KBD_GROUPS = [
  ["play", "Space", "Play / pause"], ["skip", "Ctrl + ← / →", "Next / previous song"], ["seek", "Shift + ← / →", "Seek 5 seconds"],
  ["volume", "Ctrl + ↑ / ↓", "Volume up / down"], ["letters", "S · R · M · Q · F · L · K", "Shuffle · Repeat · Mute · Queue · Full-screen · Lyrics · Karaoke"],
  ["search", "Ctrl + F  or  /", "Search"], ["newpl", "Ctrl + N", "New playlist"], ["selectall", "Ctrl + A · Enter · Delete", "Select all · play selected · remove selected"], ["nav", "Alt + ← / →", "Back / forward"],
];
const kbdOn = g => settings.kbd !== false && !(settings.kbdOff && settings.kbdOff[g]);
/* Esc: closes the top-most thing, one press at a time (it always works, even with shortcuts turned off) */
function escapeStep(typing, target) {
  if (typeof menuEl !== "undefined" && menuEl) { closeMenu(); return true; }
  const sug = $("#dlSug:not([hidden])"); if (sug) { sug.hidden = true; return true; }
  if ($("#full").classList.contains("open")) { toggleFull(false); return true; }
  if (typing) { target.blur(); return true; }
  if ($("#app").classList.contains("show-queue")) { toggleQueue(false); return true; }
  return false;
}
addEventListener("keydown", e => {
  if (e.key === "Escape" && !$(".modal-bg") && !$("#onboard.open") && !(typeof NEWQ !== "undefined" && NEWQ.open)) {
    const typing = e.target.matches("input:not([type=range]):not([type=checkbox]):not([type=color]), textarea, select");
    if (escapeStep(typing, e.target)) e.preventDefault();
    return;
  }
  if ($(".modal-bg")) return;
  const typing = e.target.matches("input:not([type=range]):not([type=checkbox]):not([type=color]), textarea, select");
  if (((e.ctrlKey && e.key.toLowerCase() === "f") || (!typing && e.key === "/")) && kbdOn("search")) { e.preventDefault(); toggleFull(false); $("#q").focus(); $("#q").select(); return; }
  if (typing) return;
  const k = e.key, low = k.toLowerCase(), plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  const arrow = k === "ArrowLeft" || k === "ArrowRight", vert = k === "ArrowUp" || k === "ArrowDown";
  const grp = k === " " ? "play" : e.ctrlKey && arrow ? "skip" : e.shiftKey && arrow ? "seek" : e.ctrlKey && vert ? "volume" : e.ctrlKey && low === "n" ? "newpl"
    : e.ctrlKey && low === "a" ? "selectall" : plain && "srmqf".includes(low) && low.length === 1 ? "letters" : (k === "Enter" || k === "Delete") ? "selectall" : e.altKey && arrow ? "nav" : null;
  if (grp && !kbdOn(grp)) return;
  if (k === " ") { e.preventDefault(); togglePlay(); }
  else if (e.ctrlKey && k === "ArrowRight") { e.preventDefault(); next(false); }
  else if (e.ctrlKey && k === "ArrowLeft") { e.preventDefault(); prev(); }
  else if (e.shiftKey && k === "ArrowRight") E.time = Math.min(E.duration || 0, E.time + 5);
  else if (e.shiftKey && k === "ArrowLeft") E.time = Math.max(0, E.time - 5);
  else if (e.ctrlKey && k === "ArrowUp") { e.preventDefault(); settings.volume = Math.min(1, settings.volume + .1); settings.muted = false; renderVol(); saveUser(); }
  else if (e.ctrlKey && k === "ArrowDown") { e.preventDefault(); settings.volume = Math.max(0, settings.volume - .1); renderVol(); saveUser(); }
  else if (e.ctrlKey && low === "n") { e.preventDefault(); newPlaylist(); }
  else if (e.ctrlKey && low === "a" && tables[sel.key || "main"]) { e.preventDefault(); const key = sel.key || "main"; sel = { key, ids: new Set(tables[key].ids), last: null }; paintSel(); }
  else if (plain && low === "s") $("#shuffle").click();
  else if (plain && low === "r") cycleRepeat();
  else if (plain && low === "m") $("#mute").click();
  else if (plain && low === "q") toggleQueue();
  else if (plain && low === "f") toggleFull();
  else if (k === "Enter" && sel.ids.size) { const tb = tables[sel.key]; const i = tb?.ids.findIndex(id => sel.ids.has(id)); if (i >= 0) playContext(tb.ids, i, tb.ctx); }
  else if (k === "Delete" && sel.ids.size && tables[sel.key]?.playlistId) removeFromPlaylist(tables[sel.key].playlistId, selectedIds());
  else if (e.altKey && k === "ArrowLeft") history_back();
  else if (e.altKey && k === "ArrowRight") $("#fwd").click();
});
addEventListener("mouseup", e => { if (e.button === 3) history_back(); if (e.button === 4) $("#fwd").click(); });

/* search box */
let qT;
$("#q").addEventListener("input", () => {
  clearTimeout(qT);
  qT = setTimeout(() => { const cur = nav.stack[nav.idx]; go("search", $("#q").value, cur?.view === "search"); $("#q").focus(); }, 350);
});
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(qT); const cur = nav.stack[nav.idx]; go("search", $("#q").value, cur?.view === "search"); $("#q").focus(); } });
$("#q").addEventListener("focus", () => { const cur = nav.stack[nav.idx]; if (cur?.view !== "search") { go("search", $("#q").value); $("#q").focus(); } });

/* ------------------------------------------------------------ background tasks */
let pollT;
async function pollScan(force) {
  clearTimeout(pollT);
  const was = lib.scanning, before = lib.tracks.length;
  try { await loadState(false); } catch { pollT = setTimeout(pollScan, 3000); return; }
  $("#scanStatus").innerHTML = lib.scanning ? `<div class="spin"></div>Scanning… ${lib.scanned}` : "";
  const cur = nav.stack[nav.idx]?.view;
  const busy = (cur === "settings" && document.activeElement?.id === "pathIn") || cur === "themeEdit";
  if (!busy && (force || lib.tracks.length !== before || was !== lib.scanning)) {
    if (!["playlist", "liked", "search", "discover", "oalbum", "oartist", "themes"].includes(cur) || !lib.scanning) render(true); else renderLib();
  }
  if (lib.scanning || force) pollT = setTimeout(pollScan, lib.scanning ? 1200 : 600);
  else probeDurations();
}
let probing = false;
async function probeDurations() {
  if (probing) return; probing = true;
  const todo = lib.tracks.filter(t => !t.duration).map(t => t.id);
  const a = new Audio(); a.preload = "metadata"; a.muted = true;
  let batch = {}, n = 0;
  for (const id of todo) {
    const d = await new Promise(res => {
      const done = v => { a.onloadedmetadata = a.onerror = null; clearTimeout(to); res(v); };
      const to = setTimeout(() => done(0), 4000);
      a.onloadedmetadata = () => done(a.duration); a.onerror = () => done(0);
      a.src = "/audio/" + id;
    });
    if (d && isFinite(d)) { batch[id] = d; lib.byId[id].duration = d; n++; }
    if (n >= 25) { await api("/api/durations", batch).catch(() => {}); batch = {}; n = 0; }
  }
  a.removeAttribute("src");
  if (n) await api("/api/durations", batch).catch(() => {});
  probing = false;
  if (todo.length && nav.stack[nav.idx]?.view !== "themeEdit") render(true);
}
setInterval(() => fetch("/api/ping").catch(() => {}), 10000);
fetch("/api/ping").catch(() => {});

/* ------------------------------------------------------------ boot */
(async function boot() {
  quickPerfCheck();
  applyTheme(currentTheme());
  try { await loadState(true); } catch (e) { $("#view").innerHTML = `<div class="pad empty"><h2>Couldn't load your library</h2><p>${esc(e.message)}</p></div>`; return; }
  settings.recent ||= []; settings.sort ||= {}; settings.customThemes ||= []; settings.history ||= [];
  if (!settings.light3190) { settings.light3190 = true; if (!settings.perf || settings.perf === "auto") settings.perf = "on"; saveUser(); } // 3.19.0: light by default
  if (settings.perf === "on" || (settings.perf !== "off" && settings.liteAuto)) document.body.classList.add("lite");
  if (settings.perf === "off") document.body.classList.remove("lite");
  applyTheme(currentTheme());
  renderVol(); renderPP(); renderModes();
  go("home");
  renderMe();
  fetch("/api/ui/ready", { method: "POST" }).catch(() => {});
  setTimeout(detectPerf, 2500);
  if (!settings.onboarded) { try { startOnboarding(); } catch (e) { postLog("onboarding: " + e.stack); settings.onboarded = true; $("#onboard").className = "ob"; } }
  if (settings.lastId && T(settings.lastId)) {
    const local = lib.byId[settings.lastId];
    const ids = local ? lib.tracks.map(t => t.id) : [settings.lastId];
    P.ctx = ids; P.ctxInfo = local ? { type: "songs", id: "", name: (IOS ? "My songs" : "On this PC") } : null;
    buildOrder(ids.indexOf(settings.lastId));
    playId(settings.lastId, false, false, settings.lastPos || 0);
    renderTime();
  }
  pollScan();
})();

window.naghamAuthDone = () => {};
document.addEventListener("visibilitychange", () => { if (!document.hidden) try { renderTime(true); } catch {} });
addEventListener("blur", () => document.body.classList.add("idle"));
addEventListener("focus", () => document.body.classList.remove("idle"));
