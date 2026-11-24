"use strict";
/* Nagham – whole albums & playlists on the Download page:
   search an album / playlist (or paste its link), see its songs, download them all; every finished download becomes a
   Nagham playlist with the songs in their order. Also: a "Download all" button on playlist pages. */
(() => {
  const COL = { mode: "songs", q: "", hits: null, searching: false, err: "", open: null, loading: "", sel: null, batches: [], seq: 0 };
  window.COL = COL;
  const DLI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>';
  const SRC = { spotify: ["Spotify", "#1ed760"], deezer: ["Deezer", "#a238ff"], youtube: ["YouTube", "#ff3b3b"], apple: ["Apple Music", "#fa2d48"], nagham: ["Nagham", "var(--accent)"] };
  const fmtDur = d => d ? `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, "0")}` : "";
  const isLink = s => /^(https?:\/\/|www\.|open\.spotify|music\.|spotify:)\S+$/i.test(s.trim());
  const fmt = () => document.querySelector('[name="dlfmt"]:checked')?.value || "mp3";
  const get = async (path, opts) => { const r = await fetch(path, opts); if (!r.ok) throw new Error((await r.text()).trim() || r.statusText); return r.json(); };
  const nm = s => (s || "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const firstArtist = s => nm(String(s || "").split(/,|&| feat\.? | ft\.? | x /i)[0]);

  /* songs of the library that are already on this PC: matched by title + first artist */
  let haveIdx = null, haveFor = null;
  function haveMap() {
    if (haveFor === lib.tracks) return haveIdx;
    haveIdx = new Map(); haveFor = lib.tracks;
    for (const t of lib.tracks) { haveIdx.set(nm(t.title) + "|" + firstArtist(t.artist), t.id); if (!haveIdx.has(nm(t.title) + "|")) haveIdx.set(nm(t.title) + "|", t.id); }
    return haveIdx;
  }
  const haveId = s => { const m = haveMap(); return m.get(nm(s.title) + "|" + firstArtist(s.artist)) || (!s.artist ? m.get(nm(s.title) + "|") : null) || null; };

  /* ---------------------------------------------------------------- page parts */
  function modesHTML() {
    const b = (k, label, icon) => `<button data-dlmode="${k}" class="${COL.mode === k ? "on" : ""}">${icon}<span>${label}</span></button>`;
    return `<div class="dl-modes" role="tablist">${b("songs", "Songs", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="17" r="3"/><path d="M11 17V5l9-2v12"/><circle cx="17" cy="15" r="3"/></svg>')}${b("albums", "Albums & playlists", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>')}</div>`;
  }
  function albumsFrame() {
    return `<div class="settings-sec"><h3>Albums & playlists <span class="muted" style="font-size:14px;font-weight:400">ألبومات وقوائم كاملة</span></h3>
      <p class="muted" style="margin:6px 0 0">Search an album, an artist or a playlist — or paste a link from <b>Spotify</b>, <b>YouTube Music</b> (playlist or album: ⋮ → Share → Copy link), YouTube, Deezer or Apple Music.</p>
      <p class="muted" style="margin:4px 0 0;font-size:13px">Private playlists: link your Spotify / YouTube account first (Settings → Linked accounts) — then they open from their link too.</p>
      <div class="field dl-box"><div class="dl-inwrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin:0"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/></svg><input class="input" id="colQ" placeholder="Album, artist, playlist — or paste a link…" spellcheck="false" autocomplete="off" value="${esc(COL.q)}"></div>
        <button class="btn accent" data-colsearch>Find</button></div>
      <div id="colRes"></div></div>`;
  }
  /* ---------------------------------------------------------------- drawing */
  function hitHTML(h, i, extra) {
    const [sname, scol] = SRC[h.source] || ["", "#888"];
    return `<button class="col-hit in" style="--i:${i}" data-colopen="${esc(h.url)}"><div class="art">${h.cover ? `<img src="${esc(proxImg(h.cover))}" alt="" loading="lazy">` : ""}${extra || ""}</div>
      <div class="col-hn" title="${esc(h.title)}">${esc(h.title)}</div><div class="col-hs">${esc(h.artist || "")}</div>
      <div class="col-hm"><span class="col-dot" style="background:${scol}"></span>${h.kind === "album" ? "Album" : "Playlist"}${h.count ? " • " + plural(h.count, "song") : ""}${h.year ? " • " + esc(h.year) : ""}<span class="col-src">${esc(sname)}</span></div></button>`;
  }
  const loadingHTML = msg => `<div class="dl-status"><span class="dl-eq"><i></i><i></i><i></i><i></i><i></i></span><span>${esc(msg)}</span></div>`;

  function drawAlbums() {
    const box = $("#colRes"); if (!box) return;
    if (COL.loading) { box.innerHTML = loadingHTML(COL.loading); return; }
    if (COL.open) { box.innerHTML = viewHTML(COL.open); paintView(); return; }
    if (COL.searching) { box.innerHTML = loadingHTML(`Looking for “${COL.q}”…`) + `<div class="col-grid">${Array.from({ length: 6 }, (_, i) => `<div class="col-hit sk" style="--i:${i}"><div class="art"></div><div class="sk-line" style="width:70%"></div><div class="sk-line s" style="width:45%"></div></div>`).join("")}</div>`; return; }
    if (COL.err) { box.innerHTML = `<div class="dl-note dl-bad">${esc(COL.err)}</div>`; return; }
    if (!COL.hits) { box.innerHTML = myListsHTML(); return; }
    if (!COL.hits.length) { box.innerHTML = `<div class="dl-note muted">Nothing found — try other words, or paste a link</div>`; return; }
    box.innerHTML = `<div class="col-grid">${COL.hits.map((h, i) => hitHTML(h, i)).join("")}</div>`;
  }
  /* your own playlists, ready to download */
  function myListsHTML() {
    const tiles = [];
    const add = (key, name, sub, art) => tiles.push(`<button class="col-mine" data-dlall="${esc(key)}"><div class="art">${art}</div><div style="min-width:0;flex:1;text-align:start"><b>${esc(name)}</b><small class="muted">${esc(sub)}</small></div><span class="col-mine-dl">${DLI}</span></button>`);
    if (lib.liked.size) add("liked:", "Liked Songs", plural(lib.liked.size, "song"), likedArt());
    for (const p of lib.playlists) if (p.tracks.length) add("playlist:" + p.id, p.name, plural(p.tracks.length, "song"), playlistArt(p));
    for (const p of oCache["sp:myplaylists"]?.data || []) add("spplaylist:" + p.id, p.name, "Spotify" + (p.tracks?.total != null ? " • " + plural(p.tracks.total, "song") : ""), imgHTML(proxImg(bestImg(p.images, true)), p.id));
    for (const p of oCache["yt:myplaylists"]?.data || []) if (p?.id) add("ytplaylist:" + p.id, p.snippet?.title || "Playlist", "YouTube", imgHTML(proxImg(p.snippet?.thumbnails?.medium?.url), p.id));
    if (!tiles.length) return "";
    return `<h4 class="col-sub">Your playlists <span class="muted">— download every song in one go</span></h4><div class="col-mines">${tiles.join("")}</div>`;
  }

  function viewHTML(c) {
    const [sname, scol] = SRC[c.source] || ["", "#888"];
    const total = c.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const have = c.tracks.filter(t => t.have).length;
    const rows = c.tracks.map((t, i) => `<label class="col-tr in" style="--i:${Math.min(i, 20)}" data-ci="${i}"><input type="checkbox" data-colck="${i}" ${COL.sel.has(i) ? "checked" : ""} ${t.have ? "disabled" : ""}>
      <span class="col-n">${t.n || i + 1}</span><div class="col-m"><b title="${esc(t.title)}">${esc(t.title)}</b><span>${esc(t.artist || "")}</span></div>
      <span class="col-d">${fmtDur(t.duration)}</span><span class="col-st" data-cst="${i}">${t.have ? '<span class="dl-ok">✓ In your library</span>' : ""}</span></label>`).join("");
    const n = COL.sel.size;
    return `<div class="col-view fade-in"><button class="btn ghost sm col-back" data-colback>← Back</button>
      <div class="col-head"><div class="art">${c.cover ? `<img src="${esc(proxImg(c.cover))}" alt="">` : phHTML(c.title)}</div>
        <div style="min-width:0"><div class="kind"><span class="col-dot" style="background:${scol}"></span>${c.kind === "album" ? "Album" : "Playlist"} • ${esc(sname)}</div><h2>${esc(c.title)}</h2>
        <div class="muted">${c.artist ? esc(c.artist) + " • " : ""}${plural(c.tracks.length, "song")}${total ? ", " + fmtLong(total) : ""}${have ? ` • ${have} already in your library` : ""}</div></div></div>
      ${c.note ? `<div class="col-note">${IC.info || ""}<span>${esc(c.note)}</span></div>` : ""}
      <div class="col-act"><button class="btn accent" data-colall ${n ? "" : "disabled"}>${have === c.tracks.length ? "✓ All songs are in your library" : DLI + (n === c.tracks.length - have ? `Download all (${n})` : `Download ${plural(n, "song")}`)}</button>
        <label class="col-all"><input type="checkbox" id="colChkAll" ${n && n === c.tracks.length - have ? "checked" : ""}> Select all</label>
        <span class="muted" style="font-size:13px">Saved inside Nagham as a playlist called <b>${esc(c.title)}</b></span></div>
      <div class="col-list">${rows}</div></div>`;
  }
  /* each song's own status, while its album / playlist is downloading */
  function paintView() {
    const c = COL.open; if (!c) return;
    const b = COL.batches.find(b => b.key === c.key && !b.closed);
    if (!b) return;
    b.items.forEach(it => {
      const el = document.querySelector(`[data-cst="${it.i}"]`); if (!el) return;
      const j = it.job && b.jobs[it.job];
      let h = "";
      if (it.have) h = '<span class="dl-ok">✓ In your library</span>';
      else if (!it.job) h = it.failed ? '<span class="dl-bad">Failed</span>' : "";
      else if (!j || j.status === "queued") h = '<span class="muted">Waiting…</span>';
      else if (j.status === "done") h = '<span class="dl-ok">✓ Saved</span>';
      else if (j.status === "error") h = `<span class="dl-bad" title="${esc(j.error || "")}">Failed</span>`;
      else if (j.status === "cancelled") h = '<span class="muted">Cancelled</span>';
      else h = `<span class="col-pct"><i style="width:${Math.max(4, Math.min(100, j.pct || 0))}%"></i></span><span class="muted">${j.phase === "Finding the song…" ? "Finding…" : Math.round(j.pct || 0) + "%"}</span>`;
      if (el.dataset.k !== h) { el.dataset.k = h; el.innerHTML = h; }
    });
  }
  function drawBatches() {
    const box = $("#dlBatches"); if (!box) return;
    const list = COL.batches.filter(b => !b.closed);
    box.innerHTML = list.map(b => {
      const st = batchStats(b);
      const doneAll = b.finished;
      const bar = doneAll ? "" : `<div class="dl-bar"><i style="width:${Math.max(3, st.pct)}%"></i></div>`;
      const sub = doneAll ? (b.plId ? `✓ ${plural(st.ok + st.have, "song")} in the playlist “${esc(b.title)}”${st.bad ? ` • ${st.bad} couldn't be found` : ""}` : esc(b.msg || "Finished"))
        : `${st.ok} of ${st.total} saved${st.bad ? ` • ${st.bad} failed` : ""}${st.have ? ` • ${st.have} were already here` : ""} — ${st.active ? "downloading…" : "waiting…"}`;
      const btns = doneAll
        ? `${b.plId ? `<button class="btn accent sm" data-go="playlist:${esc(b.plId)}">Open playlist</button>` : ""}${st.bad ? `<button class="btn ghost sm" data-colretry="${esc(b.id)}">Try failed again</button>` : ""}<button class="icon-btn" data-colclose="${esc(b.id)}" title="Hide">✕</button>`
        : `<button class="btn ghost sm" data-colcancel="${esc(b.id)}">Cancel</button>`;
      return `<div class="col-batch ${doneAll ? "done" : ""}"><div class="art">${b.cover ? `<img src="${esc(proxImg(b.cover))}" alt="">` : phHTML(b.title)}</div>
        <div style="flex:1;min-width:0"><div class="p"><b>${esc(b.title)}</b></div><div class="muted dl-sub">${sub}</div>${bar}</div><div class="row-gap" style="flex-wrap:nowrap">${btns}</div></div>`;
    }).join("");
  }
  function batchStats(b) {
    let ok = 0, bad = 0, have = 0, active = 0, pct = 0, total = 0;
    for (const it of b.items) {
      if (it.have) { have++; continue; }
      total++;
      const j = it.job && b.jobs[it.job];
      if (!it.job || !j) { if (it.failed) bad++; continue; }
      if (j.status === "done") { ok++; pct += 100; }
      else if (j.status === "error" || j.status === "cancelled") { bad++; pct += 100; }
      else { if (j.status !== "queued") active++; pct += j.pct || 0; }
    }
    return { ok, bad, have, active, total, pct: total ? pct / total : 100 };
  }
  function drawMode() {
    $$("[data-dlmode]").forEach(b => b.classList.toggle("on", b.dataset.dlmode === COL.mode));
    const s = $("#dlSongsBox"), a = $("#dlAlbumsBox");
    if (s) s.hidden = COL.mode !== "songs";
    if (a) { a.hidden = COL.mode !== "albums"; if (!a.hidden && !a.firstChild) a.innerHTML = albumsFrame(); }
    if (COL.mode === "albums") drawAlbums();
  }
  /* called by the Download page after it draws itself */
  window.colDraw = () => { const f = document.activeElement?.id; drawMode(); drawBatches(); if (f === "colQ") $("#colQ")?.focus(); };
  window.colModesHTML = modesHTML;

  /* ---------------------------------------------------------------- actions */
  async function search(q) {
    q = (q ?? $("#colQ")?.value ?? "").trim(); if (!q) { $("#colQ")?.focus(); return; }
    COL.q = q;
    if (isLink(q)) return openLink(q);
    COL.open = null; COL.searching = true; COL.err = ""; COL.hits = null; drawAlbums();
    const my = ++COL.seq;
    try {
      const r = await get(`/api/dl/expand?source=${settings.dlSource === "spotify" ? "spotify" : ""}&q=${encodeURIComponent(q)}`);
      if (my !== COL.seq) return; COL.hits = r.results || [];
    } catch (e) { if (my !== COL.seq) return; COL.err = e.message; }
    COL.searching = false; drawAlbums();
  }
  function openInfo(info) {
    info.key = info.key || info.link || info.title;
    info.tracks.forEach(t => { if (t.have === undefined) t.have = haveId(t); });
    COL.open = info; COL.sel = new Set(info.tracks.map((t, i) => t.have ? -1 : i).filter(i => i >= 0));
    COL.loading = ""; COL.mode = "albums";
  }
  async function openLink(url) {
    COL.mode = "albums"; COL.open = null; COL.err = ""; COL.loading = "Reading the songs…";
    if ((nav.stack[nav.idx]?.view) !== "dl") go("dl"); else drawMode();
    const my = ++COL.seq;
    try {
      const info = await get("/api/dl/expand?url=" + encodeURIComponent(url) + "&country=" + (settings.country || "us"));
      if (my !== COL.seq) return;
      openInfo(info);
    } catch (e) { if (my !== COL.seq) return; COL.loading = ""; COL.err = e.message; COL.hits = COL.hits || null; }
    window.colDraw();
  }
  window.colOpenLink = openLink;

  /* a playlist / album already in Nagham (yours, Spotify's, YouTube's): its songs, straight to the list */
  async function openCtx(key) {
    const i = key.indexOf(":"), type = key.slice(0, i), id = key.slice(i + 1);
    let ids = ctxTracks(type, id);
    if (!ids.length) { // not opened yet: read its songs first
      const load = { spplaylist: () => spEnsure("pl:" + id, () => SPF.playlist(id)), spalbum: () => spEnsure("al:" + id, () => SPF.album(id)), spliked: () => spEnsure("liked", SPF.liked),
        ytplaylist: () => ytEnsureData("pl:" + id, () => YTF.playlist(id)), ytliked: () => ytEnsureData("liked", YTF.liked),
        oalbum: async () => { const d = await api("/api/online/album?id=" + encodeURIComponent(id) + "&country=" + settings.country); oCache["album:" + id] = { data: d, at: Date.now() }; },
        oartistall: async () => { const d = await api("/api/online/artistsongs?id=" + encodeURIComponent(id)); oCache["artistsongs:" + id] = { data: d, at: Date.now() }; } }[type];
      if (load) { toast("Reading the songs…"); try { await load(); } catch (e) { return toast(e.message || "Couldn't read that playlist"); } ids = ctxTracks(type, id); }
    }
    if (!ids.length) { toast(/^(sp|yt)/.test(type) ? "Open the playlist first so Nagham can read its songs" : "No songs here"); if (/^(sp|yt)/.test(type)) go(type, id); return; }
    const name = ctxName(type, id) || "Playlist";
    const tracks = ids.map(x => T(x)).filter(Boolean).map((t, k) => {
      const s = { title: t.title, artist: t.artist === "YouTube" ? "" : t.artist, album: type.includes("album") ? name : t.album || "", duration: t.fullDuration || t.duration || 0, cover: t.cover || t.coverSmall || "" };
      if (type.includes("album")) s.n = k + 1;
      if (!t.online) s.have = t.id;
      else if (t.id.startsWith("yt:")) s.url = "https://music.youtube.com/watch?v=" + t.id.slice(3);
      return s;
    });
    const first = T(ids[0]);
    const cover = type === "oalbum" ? oCache["album:" + id]?.data?.album?.cover : type === "spplaylist" ? bestImg(oCache["sp:pl:" + id]?.data?.pl?.images) : type === "spalbum" ? bestImg(oCache["sp:al:" + id]?.data?.a?.images) : first?.cover || "";
    openInfo({ kind: type.includes("album") ? "album" : "playlist", source: /^sp/.test(type) ? "spotify" : /^yt/.test(type) ? "youtube" : "nagham", title: name, cover, tracks, key: "ctx:" + key, link: "ctx:" + key, own: type === "playlist" ? id : "" });
    if ((nav.stack[nav.idx]?.view) !== "dl") go("dl"); else window.colDraw();
  }

  async function downloadOpen() {
    const c = COL.open; if (!c) return;
    const pick = [...COL.sel].sort((a, b) => a - b);
    if (!pick.length) return toast("Pick at least one song");
    const id = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const items = c.tracks.map((t, i) => ({ i, song: t, have: t.have || null, job: null, picked: COL.sel.has(i) }));
    const todo = items.filter(it => it.picked && !it.have);
    const b = { id, key: c.key, title: c.title, cover: c.cover, kind: c.kind, own: c.own || "", items: items.filter(it => it.picked || it.have), jobs: {}, finished: false, at: Date.now() };
    COL.batches = COL.batches.filter(x => !(x.key === b.key && x.finished));
    COL.batches.unshift(b);
    try {
      const r = await get("/api/dl/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch: id, folder: c.title, format: fmt(), songs: todo.map(it => ({ title: it.song.title, artist: it.song.artist, album: it.song.album || (c.kind === "album" ? c.title : ""), duration: it.song.duration, n: it.song.n || 0, url: it.song.url || "", cover: it.song.cover || "" })) }) });
      (r.ids || []).forEach((jid, k) => { if (jid) todo[k].job = jid; else todo[k].failed = true; });
    } catch (e) { COL.batches.shift(); toast(e.message); return; }
    toast(`Downloading ${plural(todo.length, "song")} from “${c.title}”`);
    drawBatches(); paintView(); poll();
  }
  let polling = false;
  async function poll() {
    if (polling) return; polling = true;
    while (COL.batches.some(b => !b.finished)) {
      await new Promise(r => setTimeout(r, 1000));
      for (const b of COL.batches.filter(b => !b.finished)) {
        try { const r = await get("/api/dl/batch?id=" + encodeURIComponent(b.id)); for (const j of r.jobs || []) b.jobs[j.id] = j; } catch { continue; }
        const left = b.items.some(it => it.job && !["done", "error", "cancelled"].includes(b.jobs[it.job]?.status));
        if (!left) await finish(b);
      }
      drawBatches(); paintView();
    }
    polling = false;
  }
  /* all songs of an album / playlist are done: make (or update) its Nagham playlist, in the album's order */
  async function finish(b) {
    b.finished = true;
    const want = b.items.filter(it => it.job && b.jobs[it.job]?.status === "done").map(it => b.jobs[it.job].track);
    for (let k = 0; k < 16 && want.some(t => t && !lib.byId[t]); k++) { await new Promise(r => setTimeout(r, 600)); await loadState(false).catch(() => {}); }
    const ids = b.items.map(it => it.have && lib.byId[it.have] ? it.have : it.job && b.jobs[it.job]?.status === "done" ? b.jobs[it.job].track : null).filter(id => id && lib.byId[id]);
    if (!ids.length) { b.msg = "No songs could be saved"; return; }
    let p = lib.playlists.find(x => x.dlFrom === b.key);
    if (!p && b.own) { // your own Nagham playlist: its downloaded copy sits next to it
      const src = lib.playlists.find(x => x.id === b.own);
      p = { id: uid(), name: (src?.name || b.title) + " (downloaded)", tracks: [], created: Date.now(), dlFrom: b.key };
      lib.playlists.push(p);
    } else if (!p) {
      p = { id: uid(), name: b.title, tracks: [], created: Date.now(), dlFrom: b.key };
      lib.playlists.push(p);
    }
    p.tracks = [...new Set([...p.tracks.filter(x => lib.byId[x] && !ids.includes(x)), ...ids])];
    const order = new Map(ids.map((x, i) => [x, i])); p.tracks.sort((a, z) => (order.get(a) ?? 1e9) - (order.get(z) ?? 1e9));
    b.plId = p.id; b.title = p.name;
    saveUser(); renderLib(); pollScan(true);
    const st = batchStats(b);
    toast(`“${p.name}” is ready — ${plural(ids.length, "song")}${st.bad ? `, ${st.bad} couldn't be found` : ""}`);
  }
  async function cancelBatch(id) {
    try { await get("/api/dl/batch?cancel=1&id=" + encodeURIComponent(id), { method: "POST" }); } catch (e) { toast(e.message); }
  }
  async function retryBatch(id) {
    const b = COL.batches.find(x => x.id === id); if (!b) return;
    const bad = b.items.filter(it => !it.have && (it.failed || ["error", "cancelled"].includes(b.jobs[it.job]?.status)));
    if (!bad.length) return;
    try {
      const r = await get("/api/dl/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch: b.id, folder: b.title.replace(/ \(downloaded\)$/, ""), format: fmt(), songs: bad.map(it => ({ title: it.song.title, artist: it.song.artist, album: it.song.album || "", duration: it.song.duration, n: it.song.n || 0, url: it.song.url || "", cover: it.song.cover || "" })) }) });
      (r.ids || []).forEach((jid, k) => { bad[k].job = jid || null; bad[k].failed = !jid; });
      b.finished = false; drawBatches(); poll();
    } catch (e) { toast(e.message); }
  }

  /* ---------------------------------------------------------------- "Download all" on playlist / album pages */
  const DLABLE = new Set(["playlist", "liked", "oalbum", "oartistall", "spplaylist", "spalbum", "spliked", "ytplaylist", "ytliked"]);
  const _actions = actions;
  actions = function (ctxKey, extra = "") {
    const type = String(ctxKey).slice(0, String(ctxKey).indexOf(":"));
    if (DLABLE.has(type)) extra = `<button class="icon-btn" data-dlall="${esc(ctxKey)}" title="Download all songs">${DLI}</button>` + extra;
    return _actions(ctxKey, extra);
  };

  /* ---------------------------------------------------------------- events */
  document.addEventListener("click", e => {
    const t = e.target;
    const m = t.closest("[data-dlmode]"); if (m) { COL.mode = m.dataset.dlmode; drawMode(); return; }
    if (t.closest("[data-colsearch]")) return search();
    const o = t.closest("[data-colopen]"); if (o) return openLink(o.dataset.colopen);
    if (t.closest("[data-colback]")) { COL.open = null; COL.err = ""; drawAlbums(); return; }
    if (t.closest("[data-colall]")) return downloadOpen();
    const da = t.closest("[data-dlall]"); if (da) { e.stopPropagation(); return openCtx(da.dataset.dlall); }
    const c = t.closest("[data-colcancel]"); if (c) return cancelBatch(c.dataset.colcancel);
    const r = t.closest("[data-colretry]"); if (r) return retryBatch(r.dataset.colretry);
    const x = t.closest("[data-colclose]"); if (x) { const b = COL.batches.find(b => b.id === x.dataset.colclose); if (b) b.closed = true; drawBatches(); return; }
  });
  document.addEventListener("change", e => {
    if (e.target.id === "colChkAll" && COL.open) { COL.sel = new Set(e.target.checked ? COL.open.tracks.map((t, i) => t.have ? -1 : i).filter(i => i >= 0) : []); drawAlbums(); return; }
    const ck = e.target.closest?.("[data-colck]");
    if (ck && COL.open) { const i = +ck.dataset.colck; if (ck.checked) COL.sel.add(i); else COL.sel.delete(i); const keep = $(".col-list")?.scrollTop; drawAlbums(); const l = $(".col-list"); if (l && keep != null) l.scrollTop = keep; }
  });
  document.addEventListener("input", e => { if (e.target.id === "colQ") COL.q = e.target.value; });
  document.addEventListener("keydown", e => { if (e.target.id === "colQ" && e.key === "Enter") search(); });
  const st = document.createElement("style");
  st.textContent = `
.dl-modes{display:flex;gap:6px;padding:5px;border-radius:16px;background:var(--input);margin:4px 0 16px;flex-wrap:wrap}
.dl-modes button{flex:1;min-width:140px;border:0;background:none;color:inherit;font:inherit;font-weight:650;padding:11px 14px;border-radius:12px;cursor:pointer;display:flex;gap:8px;align-items:center;justify-content:center;transition:background .2s,color .2s}
.dl-modes button svg{width:18px;height:18px;flex:none}.dl-modes button.on{background:var(--accent);color:var(--on-accent);box-shadow:0 6px 18px color-mix(in srgb,var(--accent) 30%,transparent)}
.dl-modes button:not(.on):hover{background:rgba(127,127,127,.16)}
.col-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-top:14px}
.col-hit{display:flex;flex-direction:column;gap:3px;text-align:start;border:0;background:rgba(127,127,127,.1);color:inherit;font:inherit;padding:10px;border-radius:14px;cursor:pointer;transition:background .2s,transform .2s;min-width:0}
.col-hit:hover{background:rgba(127,127,127,.2);transform:translateY(-2px)}.col-hit .art{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#2a2340;margin-bottom:6px}.col-hit .art img{width:100%;height:100%;object-fit:cover;display:block}
.col-hit.in{animation:dlIn .35s var(--ease) both;animation-delay:calc(var(--i)*40ms)}.col-hit.sk .art{background:linear-gradient(90deg,rgba(127,127,127,.18) 25%,rgba(127,127,127,.34) 50%,rgba(127,127,127,.18) 75%);background-size:200% 100%;animation:shimmer 1.2s linear infinite}
.col-hn{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.col-hs{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.col-hm{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px;flex-wrap:wrap}.col-src{margin-inline-start:auto;opacity:.8}.col-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.col-sub{margin:18px 0 4px;font-size:15px}.col-mines{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-top:8px}
.col-mine{display:flex;gap:12px;align-items:center;padding:8px;border-radius:12px;border:0;background:rgba(127,127,127,.1);color:inherit;font:inherit;cursor:pointer;transition:background .2s}.col-mine:hover{background:rgba(127,127,127,.2)}
.col-mine .art{width:46px;height:46px;border-radius:8px;overflow:hidden;flex:none}.col-mine .art>*{width:100%;height:100%;object-fit:cover}.col-mine b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.col-mine small{display:block;font-size:12px}
.col-mine-dl{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--on-accent);flex:none}.col-mine-dl svg{width:17px;height:17px}
.col-view{margin-top:14px}.col-back{margin-bottom:12px}.col-head{display:flex;gap:18px;align-items:flex-end}.col-head .art{width:150px;height:150px;border-radius:14px;overflow:hidden;flex:none;box-shadow:0 12px 30px rgba(0,0,0,.35)}.col-head .art>*{width:100%;height:100%;object-fit:cover}
.col-head h2{margin:4px 0 6px;font-size:28px;line-height:1.15;overflow-wrap:anywhere}.col-head .kind{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;opacity:.85}
.col-note{display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:10px 14px;border-radius:12px;background:color-mix(in srgb,var(--accent) 12%,transparent);font-size:13.5px}.col-note svg{width:18px;height:18px;flex:none;margin-top:1px}
.col-act{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:16px 0 8px}.col-act .btn svg{width:17px;height:17px;margin-inline-end:6px;vertical-align:-3px}.col-all{display:flex;gap:7px;align-items:center;cursor:pointer;font-size:14px}
.col-list{max-height:min(56vh,620px);overflow:auto;border-radius:12px;background:rgba(127,127,127,.06);padding:4px}
.col-tr{display:flex;gap:12px;align-items:center;padding:7px 10px;border-radius:10px;cursor:pointer}.col-tr:hover{background:rgba(127,127,127,.12)}.col-tr.in{animation:dlIn .3s var(--ease) both;animation-delay:calc(var(--i)*18ms)}
.col-tr input{width:17px;height:17px;accent-color:var(--accent);flex:none}.col-n{width:24px;text-align:end;color:var(--muted);font-size:13px;flex:none}.col-m{flex:1;min-width:0;display:flex;flex-direction:column}
.col-m b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.col-m span{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.col-d{font-size:13px;color:var(--muted);flex:none}
.col-st{min-width:110px;text-align:end;font-size:13px;display:flex;gap:6px;align-items:center;justify-content:flex-end;flex:none}.col-pct{width:46px;height:5px;border-radius:5px;background:rgba(127,127,127,.25);overflow:hidden}.col-pct i{display:block;height:100%;background:var(--accent);transition:width .4s}
.col-batch{display:flex;gap:14px;align-items:center;padding:12px;border-radius:16px;background:var(--panel,rgba(127,127,127,.1));border:1px solid var(--line);margin-bottom:10px;animation:dlIn .35s var(--ease) both}
.col-batch .art{width:56px;height:56px;border-radius:10px;overflow:hidden;flex:none}.col-batch .art>*{width:100%;height:100%;object-fit:cover}.col-batch.done{border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
@media (max-width:700px){.col-head{flex-direction:column;align-items:flex-start}.col-head .art{width:120px;height:120px}.col-st{min-width:70px}.col-d{display:none}}
body.lite .col-hit.in,body.lite .col-tr.in,body.lite .col-batch{animation:none}`;
  document.head.appendChild(st);
})();
