/* ============================================================ Download songs: search by name or paste a link */
(() => {
  const DL = { src: "ytmusic", info: null, jobs: [], fmt: "mp3", queue: [], showing: false, q: "", results: null, didYouMean: "", searching: false, serr: "", sug: [], seq: 0, ctl: null };
  let drawn = null;
  const jobByUrl = u => DL.jobs.find(j => j.url === u && !["error", "cancelled"].includes(j.status)) || DL.jobs.find(j => j.url === u);

  const hfetch = async (path, body, signal) => {
    const r = await fetch("/api/dl/" + path, body === undefined ? { signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
    return r.json();
  };
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>';
  const SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/></svg>';
  const small = (svg, px) => svg.replace("<svg", `<svg style="width:${px}px;height:${px}px;vertical-align:-3px;margin-inline-end:6px"`);
  const fmtDur = d => d ? `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, "0")}` : "";
  const looksLikeLink = s => /^(https?:\/\/|www\.|spotify:)\S+$/i.test(s.trim()) || /^([\w-]+\.)+[a-z]{2,}\/\S+$/i.test(s.trim());
  /* a whole album / playlist (not one song): opened in "Albums & playlists" */
  const isCollection = s => /open\.spotify\.com\/(intl-[a-z-]+\/)?(playlist|album)\/|spotify:(playlist|album):|deezer\.com\/([a-z]{2}\/)?(album|playlist)\/|music\.youtube\.com\/(playlist|browse\/)|youtube\.com\/playlist/i.test(s)
    || (/music\.apple\.com\/.*\/album\//i.test(s) && !/[?&]i=/.test(s))
    || (/youtu(\.be|be\.com)\//i.test(s) && /[?&]list=/.test(s) && !/[?&]v=|youtu\.be\/[\w-]{6,}/i.test(s));

  let prepT = 0;
  async function loadInfo() {
    try { DL.info = await hfetch("info"); } catch { DL.info = { ready: false }; }
    const n = $("#dlNote");
    if (n) {
      const p = DL.info.prep;
      n.hidden = !!DL.info.ready && !(p && p.status === "tools");
      if (p && p.status === "tools") n.innerHTML = `<span class="dl-eq" style="vertical-align:-2px;margin-inline-end:6px"><i></i><i></i><i></i><i></i><i></i></span>Preparing the downloader (one time): ${esc(p.phase || "")} <b>${Math.round(p.pct || 0)}%</b> — you can already search; downloads start when it's ready.`;
      else if (p && p.status === "error") n.innerHTML = `Couldn't get the downloader yet (${esc(p.error || "")}) — check your internet; Nagham tries again by itself.`;
      else n.textContent = "The first download fetches the tools it needs (one time, needs internet, ~200 MB).";
    }
    clearTimeout(prepT);
    if (DL.info.prep?.status === "tools" && $("#dlNote")) prepT = setTimeout(loadInfo, 1000);
    paintSrc();
  }

  /* ---------- static page frame (rendered once, parts are patched in place: no flicker, no lag) */
  VIEWS_EXTRA.dl = () => {
    drawn = null; loadInfo(); try { DL.src = settings.dlSource === "spotify" ? "spotify" : "ytmusic"; } catch {}
    setTimeout(paintSrc, 0);
    setTimeout(() => { drawResults(); drawJobs(); window.colDraw?.(); }, 0);
    const fmtRow = `<div class="dl-opts muted" style="margin:0 0 14px"><span>Save songs as:</span><label><input type="radio" name="dlfmt" value="mp3" ${DL.fmt === "mp3" ? "checked" : ""}> MP3</label><label><input type="radio" name="dlfmt" value="m4a" ${DL.fmt === "m4a" ? "checked" : ""}> M4A</label></div>`;
    return `<div class="pad fade-in dl-page"><h1 class="greet">Download <span class="muted" style="font-size:16px">تنزيل</span></h1>
      ${window.colModesHTML ? colModesHTML() : ""}${fmtRow}
      <div id="dlAlbumsBox" hidden></div>
      <div id="dlSongsBox" ${window.COL && COL.mode !== "songs" ? "hidden" : ""}><div class="settings-sec dl-search"><h3>Search for a song <span class="muted" style="font-size:14px;font-weight:400">ابحث عن أغنية</span></h3>
        <div class="dl-src" role="tablist"><button data-dlsrc="ytmusic" class="${DL.src === "ytmusic" ? "on" : ""}"><span class="dl-sd yt"></span>YouTube Music</button><button data-dlsrc="spotify" class="${DL.src === "spotify" ? "on" : ""}"><span class="dl-sd sp"></span>Spotify</button></div>
        <p class="muted" id="dlHint" style="margin:10px 0 0"></p>
        <div class="field dl-box"><div class="dl-inwrap">${small(SEARCH, 18).replace("margin-inline-end:6px", "margin:0")}<input class="input" id="dlQ" placeholder="Song name, words from the song, or paste a link…" spellcheck="false" autocomplete="off" value="${esc(DL.q)}"><div id="dlSug" class="dl-sug" hidden></div></div>
          <button class="btn accent" id="dlSearchBtn" data-dlsearch>Search</button></div>
                <div id="dlRes" class="dl-results"></div>
        </div></div>
      <p id="dlNote" class="muted" style="margin:0 0 12px;font-size:13px" ${DL.info?.ready ? "hidden" : ""}>The first download fetches the tools it needs (one time, needs internet, ~100 MB).</p>
      <div id="dlBatches"></div><div id="dlList"></div></div>`;
  };

  function paintSrc() {
    $$("[data-dlsrc]").forEach(b => b.classList.toggle("on", b.dataset.dlsrc === DL.src));
    const h = $("#dlHint"); if (!h) return;
    h.innerHTML = DL.src === "spotify"
      ? (DL.info?.spotify === false ? "No Spotify account needed — type the song name or paste a Spotify link, and <b>Nagham</b> finds the same song and saves it." : "Search a Spotify song or paste a Spotify link — Nagham finds it and saves the song inside Nagham.")
      : "Type a song name or even a few words from the song, or paste a YouTube / YouTube Music link.";
  }
  /* ---------- search results */
  function skeleton() {
    return Array.from({ length: 5 }, (_, i) => `<div class="dl-res sk" style="--i:${i}"><div class="dl-th"></div><div style="flex:1"><div class="sk-line" style="width:${60 - i * 6}%"></div><div class="sk-line s" style="width:${32 + i * 3}%"></div></div><div class="sk-btn"></div></div>`).join("");
  }
  function resRow(r, i) {
    return `<div class="dl-res in" style="--i:${i}" data-u="${esc(r.url)}"><div class="dl-th" ${r.thumb ? `style="background-image:url('/img?u=${encodeURIComponent(r.thumb)}')"` : ""}></div>
      <div style="flex:1;min-width:0"><div class="p" title="${esc(r.title)}">${esc(r.title)}</div><div class="muted dl-sub">${esc(r.channel || "")}${r.duration ? " • " + fmtDur(r.duration) : ""}</div></div>
      <button class="btn accent sm dl-get" data-dlres="${esc(r.url)}"></button></div>`;
  }
  function drawResults() {
    const box = $("#dlRes"); if (!box) return;
    const btn = $("#dlSearchBtn"); if (btn) { btn.classList.toggle("busy", DL.searching); btn.innerHTML = DL.searching ? '<span class="dl-dots"><i></i><i></i><i></i></span>' : "Search"; }
    if (DL.searching) { box.innerHTML = `<div class="dl-status"><span class="dl-eq"><i></i><i></i><i></i><i></i><i></i></span><span>Looking for “${esc(DL.q)}”…</span></div>` + skeleton(); drawn = null; return; }
    if (DL.serr) { box.innerHTML = `<div class="dl-note dl-bad">${esc(DL.serr)}</div>`; drawn = null; return; }
    if (DL.results === null) { box.innerHTML = ""; drawn = null; return; }
    if (!DL.results.length) { box.innerHTML = `<div class="dl-note muted">No songs found — try other words</div>`; drawn = null; return; }
    if (drawn !== DL.results) { box.innerHTML = DL.results.map(resRow).join(""); drawn = DL.results; }
    DL.results.forEach(paintBtn);
  }
  // the Download button of one result shows its own progress, so you see what's happening right there
  function paintBtn(r) {
    const b = $(`.dl-res[data-u="${CSS.escape(r.url)}"] .dl-get`); if (!b) return;
    const j = jobByUrl(r.url);
    let html, cls = "btn accent sm dl-get", dis = false;
    if (!j) html = small(ICON, 16) + "Download";
    else if (j.status === "done") { html = "✓ Saved"; cls += " ok"; dis = true; }
    else if (j.status === "error") html = small(ICON, 16) + "Retry";
    else if (j.status === "cancelled") html = small(ICON, 16) + "Download";
    else { html = j.status === "tools" ? "Preparing…" : j.status === "converting" ? "Saving…" : Math.round(j.pct || 0) + "%"; cls += " go"; dis = true; b.style.setProperty("--p", Math.max(4, Math.min(100, j.pct || 0)) + "%"); }
    if (b.dataset.k !== html + cls) { b.dataset.k = html + cls; b.className = cls; b.innerHTML = html; }
    else if (!dis) b.style.removeProperty("--p"); else if (cls.includes(" go")) b.style.setProperty("--p", Math.max(4, Math.min(100, j.pct || 0)) + "%");
    b.disabled = dis;
  }

  /* ---------- download list (patched in place) */
  function jobHTML(j) {
    const title = j.title || j.url;
    const sub = j.status === "error" ? esc(j.error || "Download failed") + ` <button class="dl-rep" data-report>Copy report</button>` : j.status === "done" ? "Saved inside Nagham" : esc(j.phase || "");
    const right = j.status === "done" ? `<span class="dl-ok">✓ Added</span>` : j.status === "error" ? `<span class="dl-bad">Failed</span>` : j.status === "cancelled" ? `<span class="muted">Cancelled</span>` : `<button class="btn ghost sm" data-dlcancel="${esc(j.id)}">Cancel</button>`;
    const bar = ["done", "error", "cancelled"].includes(j.status) ? "" : `<div class="dl-bar"><i style="width:${Math.max(3, Math.min(100, j.pct || 0))}%"></i></div>`;
    return `<div class="p" title="${esc(title)}">${esc(title)}</div><div class="muted dl-sub">${sub}</div>${bar}</div>${right}`;
  }
  function drawJobs() {
    const list = $("#dlList"); if (!list) return;
    DL.jobs.forEach(j => {
      let row = list.querySelector(`[data-dlid="${j.id}"]`);
      if (!row) { row = document.createElement("div"); row.className = "folder dl-row in"; row.dataset.dlid = j.id; list.prepend(row); }
      const key = [j.status, j.title, j.phase, j.error].join("|");
      if (row.dataset.k !== key) { row.dataset.k = key; row.innerHTML = `<div style="flex:1;min-width:0">` + jobHTML(j); }
      else { const i = row.querySelector(".dl-bar i"); if (i) i.style.width = Math.max(3, Math.min(100, j.pct || 0)) + "%"; }
    });
    (DL.results || []).forEach(paintBtn);
  }

  /* ---------- "song saved" popup: animation + pick the library it goes to */
  async function chooser() {
    if (DL.showing) return; DL.showing = true;
    while (DL.queue.length) {
      const job = DL.queue.shift();
      for (let i = 0; i < 12 && !lib.byId[job.track]; i++) { await new Promise(r => setTimeout(r, 500)); await loadState(false).catch(() => {}); }
      const t = lib.byId[job.track];
      const title = t?.title || job.title || "Your song", artist = t?.artist || "";
      const row = (k, name, sub, icon) => `<button class="dl-pick" data-pick="${esc(k)}"><span class="dl-pi">${icon}</span><span style="flex:1;min-width:0;text-align:start"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>`;
      const html = `<div class="dl-done"><div class="dl-ring"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M15 27l8 8 14-16"/></svg><i></i><i></i><i></i><i></i><i></i></div>
        <h3>Song saved!</h3><p class="muted dl-t"><b>${esc(title)}</b>${artist ? " • " + esc(artist) : ""}</p>
        <p class="muted" style="margin:0 0 10px">Which library should it go to? اختر المكتبة اللي تبيها</p>
        <div class="dl-picks">${row("liked", "Liked Songs", "", IC.heart || "♥")}${lib.playlists.map(p => row("pl:" + p.id, p.name, plural(p.tracks.length, "song"), IC.note || "♪")).join("")}${row("new", "New playlist…", "", "+")}</div>
        <div class="row-gap"><button class="btn ghost cancel">Just keep it in Songs</button></div></div>`;
      const choice = await modal(html, null, { onOpen: (bg, done) => bg.addEventListener("click", e => { const b = e.target.closest("[data-pick]"); if (b) done(b.dataset.pick); }) });
      if (!choice) { toast("Saved in your library"); continue; }
      if (choice === "liked") { lib.liked.add(job.track); afterLikeChange("Added to Liked Songs"); }
      else if (choice === "new") await newPlaylist([job.track]);
      else addToPlaylist(choice.slice(3), [job.track]);
    }
    DL.showing = false;
  }

  /* ---------- actions */
  async function track(job) {
    for (;;) {
      await new Promise(r => setTimeout(r, 600));
      let s;
      try { s = await hfetch("job?id=" + encodeURIComponent(job.id)); } catch { s = { ...job, status: "error", error: "Lost contact with Nagham" }; }
      Object.assign(job, s);
      drawJobs();
      if (["done", "error", "cancelled"].includes(job.status)) break;
    }
    if (job.status === "done") { pollScan(true); DL.queue.push(job); chooser(); }
    else if (job.status === "error") toast(job.error || "Download failed");
  }
  async function start(url) {
    url = (url || "").trim(); if (!url) return;
    const exist = jobByUrl(url);
    if (exist && !["error", "cancelled"].includes(exist.status)) return;
    try {
      const { id } = await hfetch("start", { url, format: DL.fmt });
      const job = { id, url, status: "queued", phase: "Starting…", pct: 0, title: "" };
      DL.jobs.unshift(job);
      drawJobs(); track(job);
    } catch (e) { toast(e.message); drawJobs(); }
  }
  async function search(q) {
    q = (q ?? $("#dlQ")?.value ?? "").trim();
    if (!q) { $("#dlQ")?.focus(); return; }
    hideSug();
    if (looksLikeLink(q)) {
      const i = $("#dlQ"); if (i) i.value = ""; DL.q = "";
      if (isCollection(q) && window.colOpenLink) { toast("That's a whole album / playlist — showing its songs"); return colOpenLink(q); }
      return start(q);
    }
    DL.q = q; DL.searching = true; DL.serr = ""; DL.results = null; DL.didYouMean = "";
    const my = ++DL.seq; DL.ctl?.abort(); DL.ctl = new AbortController();
    drawResults();
    try {
      const r = await hfetch("search?source=" + DL.src + "&q=" + encodeURIComponent(q), undefined, DL.ctl.signal);
      if (my !== DL.seq) return;
      DL.results = r.results;
    } catch (e) { if (my !== DL.seq || e.name === "AbortError") return; DL.serr = e.message; }
    DL.searching = false; drawResults();
  }

  /* ---------- spelling suggestions while typing */
  let sugT = 0;
  function hideSug() { const s = $("#dlSug"); if (s) s.hidden = true; DL.sug = []; }
  function onType() {
    clearTimeout(sugT);
    const q = ($("#dlQ")?.value || "").trim();
    if (q.length < 2 || looksLikeLink(q)) return hideSug();
    sugT = setTimeout(async () => {
      try {
        const r = await hfetch("suggest?q=" + encodeURIComponent(q));
        if (($("#dlQ")?.value || "").trim() !== q) return;
        DL.sug = r.suggestions || [];
        const s = $("#dlSug"); if (!s) return;
        s.hidden = !DL.sug.length || document.activeElement?.id !== "dlQ";
        s.innerHTML = DL.sug.map(x => `<div class="dl-sg" data-dlq="${esc(x)}">${small(SEARCH, 14)}${esc(x)}</div>`).join("");
      } catch { /* offline: no suggestions, search still works */ }
    }, 220);
  }

  document.addEventListener("input", e => { if (e.target.id === "dlQ") onType(); });
  document.addEventListener("focusin", e => { if (e.target.id === "dlQ" && DL.sug.length) $("#dlSug").hidden = false; });
  document.addEventListener("mousedown", e => { if (!e.target.closest(".dl-inwrap")) hideSug(); });
  document.addEventListener("click", e => {
    const q = e.target.closest("[data-dlq]"); if (q) { const i = $("#dlQ"); if (i) i.value = q.dataset.dlq; return search(q.dataset.dlq); }
    const sb = e.target.closest("[data-dlsrc]");
    if (sb) { DL.src = sb.dataset.dlsrc; settings.dlSource = DL.src; saveUser(); DL.results = null; DL.serr = ""; paintSrc(); drawResults(); const i = $("#dlQ"); if (i && i.value.trim() && !looksLikeLink(i.value)) search(); return; }
    if (e.target.closest("[data-dlsearch]")) return search();
    const rb = e.target.closest("[data-dlres]"); if (rb && !rb.disabled) return start(rb.dataset.dlres);
    const c = e.target.closest("[data-dlcancel]");
    if (c) hfetch("cancel?id=" + encodeURIComponent(c.dataset.dlcancel), {}).catch(() => {});
  });
  document.addEventListener("keydown", e => {
    if (e.target.id !== "dlQ") return;
    if (e.key === "Enter") search(); else if (e.key === "Escape") hideSug();
  });
  document.addEventListener("change", e => { if (e.target.name === "dlfmt") DL.fmt = e.target.value; });

  /* ---------- sidebar entry + styles */
  const st = document.createElement("style");
  st.textContent = `
.dl-box{align-items:stretch}.dl-inwrap{position:relative;flex:1;min-width:0}.dl-inwrap>svg{position:absolute;inset-inline-start:14px;top:50%;margin-top:-9px!important;width:18px;height:18px;opacity:.6;pointer-events:none}.dl-inwrap .input{width:100%;padding-inline-start:42px}
.dl-sug{position:absolute;z-index:20;inset-inline:0;top:calc(100% + 6px);background:var(--menu-bg);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:6px;animation:pop .15s var(--ease)}
.dl-sg{padding:9px 12px;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:6px}.dl-sg:hover{background:var(--input)}.dl-sg svg{opacity:.55;flex:none;margin:0!important}
#dlSearchBtn{min-width:96px;position:relative;overflow:hidden}#dlSearchBtn.busy{pointer-events:none}
.dl-dots{display:inline-flex;gap:5px;align-items:center;height:18px}.dl-dots i{width:7px;height:7px;border-radius:50%;background:currentColor;animation:dlDot .9s ease-in-out infinite}.dl-dots i:nth-child(2){animation-delay:.15s}.dl-dots i:nth-child(3){animation-delay:.3s}
@keyframes dlDot{0%,80%,100%{transform:scale(.5);opacity:.4}40%{transform:scale(1);opacity:1}}
.dl-src{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:var(--input);margin-top:12px}.dl-src button{border:0;background:none;color:inherit;font:inherit;font-weight:650;padding:8px 18px;border-radius:999px;cursor:pointer;display:flex;align-items:center;gap:8px;white-space:nowrap;transition:background .2s,color .2s}.dl-src button.on{background:var(--accent);color:var(--on-accent)}
.dl-sd{width:10px;height:10px;border-radius:50%}.dl-sd.yt{background:#ff3b3b}.dl-sd.sp{background:#1ed760}
.dl-opts{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:14px}.dl-opts label{display:flex;gap:6px;align-items:center;cursor:pointer}
.dl-dym{margin-top:12px;font-size:14px;color:var(--muted)}.dl-link{background:none;border:0;color:var(--accent);font:inherit;font-weight:700;cursor:pointer;padding:0}.dl-link:hover{text-decoration:underline}
.dl-results{margin-top:6px}.dl-status{display:flex;align-items:center;gap:12px;justify-content:center;padding:14px 0 6px;color:var(--muted)}
.dl-eq{display:inline-flex;gap:3px;align-items:flex-end;height:22px}.dl-eq i{width:4px;border-radius:2px;background:var(--accent);animation:dlEq .9s ease-in-out infinite}.dl-eq i:nth-child(1){animation-delay:0s}.dl-eq i:nth-child(2){animation-delay:.15s}.dl-eq i:nth-child(3){animation-delay:.3s}.dl-eq i:nth-child(4){animation-delay:.45s}.dl-eq i:nth-child(5){animation-delay:.6s}
@keyframes dlEq{0%,100%{height:5px}50%{height:22px}}
.dl-res{display:flex;gap:12px;align-items:center;padding:8px;border-radius:12px;margin-top:8px;background:rgba(127,127,127,.12);transition:background .2s,transform .2s}.dl-res:hover{background:rgba(127,127,127,.2)}
.dl-res.in{animation:dlIn .35s var(--ease) both;animation-delay:calc(var(--i)*45ms)}@keyframes dlIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
.dl-th{width:64px;height:48px;border-radius:8px;background:#2a2340 center/cover;flex:none}.dl-res .p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dl-res.sk{animation:dlIn .3s both;animation-delay:calc(var(--i)*60ms)}.sk .dl-th,.sk-line,.sk-btn{background:linear-gradient(90deg,rgba(127,127,127,.18) 25%,rgba(127,127,127,.34) 50%,rgba(127,127,127,.18) 75%);background-size:200% 100%;animation:shimmer 1.2s linear infinite}
.sk-line{height:12px;border-radius:6px;margin:4px 0}.sk-line.s{height:9px;opacity:.7}.sk-btn{width:104px;height:30px;border-radius:999px}
.dl-get{min-width:112px;position:relative;overflow:hidden;transition:transform .15s}.dl-get:active{transform:scale(.96)}
.dl-get.go{background:linear-gradient(90deg,var(--accent) var(--p,0%),rgba(127,127,127,.3) var(--p,0%));color:var(--text);transition:none}.dl-get.ok{background:rgba(127,127,127,.25);color:var(--accent);animation:heartpop .5s}
.dl-note{text-align:center;padding:16px 0}.dl-row{flex-wrap:nowrap}.dl-row.in{animation:dlIn .3s var(--ease) both}.dl-sub{font-size:13px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dl-bar{height:5px;border-radius:5px;background:rgba(127,127,127,.25);margin-top:8px;overflow:hidden}.dl-bar i{display:block;height:100%;background:var(--accent);border-radius:5px;transition:width .4s}
.dl-done{text-align:center}.dl-ring{position:relative;width:84px;height:84px;margin:4px auto 10px}.dl-ring svg{width:84px;height:84px;fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.dl-ring circle{stroke-dasharray:145;stroke-dashoffset:145;animation:dlDraw .6s ease forwards}.dl-ring path{stroke-dasharray:40;stroke-dashoffset:40;animation:dlDraw .4s .5s ease forwards}
.dl-ring i{position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3px;border-radius:50%;background:var(--accent);opacity:0;animation:dlBurst .9s .55s ease-out forwards}
.dl-ring i:nth-of-type(1){--r:0}.dl-ring i:nth-of-type(2){--r:1}.dl-ring i:nth-of-type(3){--r:2}.dl-ring i:nth-of-type(4){--r:3}.dl-ring i:nth-of-type(5){--r:4}
@keyframes dlDraw{to{stroke-dashoffset:0}}@keyframes dlBurst{0%{opacity:1;transform:rotate(calc(var(--r)*72deg)) translateY(0)}100%{opacity:0;transform:rotate(calc(var(--r)*72deg)) translateY(-54px)}}
.dl-done h3{margin:0 0 4px}.dl-t{margin:0 0 12px!important}.dl-picks{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto;margin-bottom:14px;text-align:start}
.dl-pick{display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:12px;background:var(--input);border:0;color:inherit;cursor:pointer;font:inherit;transition:transform .15s,background .15s}.dl-pick:hover{transform:translateX(3px);background:rgba(127,127,127,.22)}
.dl-pick small{display:block;color:var(--muted);font-size:12px}.dl-pi{width:34px;height:34px;border-radius:9px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-weight:800}.dl-pi svg{width:18px;height:18px}
.dl-ok{color:var(--accent);font-weight:700}.dl-bad{color:#ff6b6b;font-weight:700}
body.lite .dl-res.in,body.lite .dl-res.sk{animation:none}`;
  document.head.appendChild(st);
  const settingsLink = $('[data-nav="settings"]');
  if (settingsLink && !$('[data-nav="dl"]')) {
    const a = document.createElement("a");
    a.dataset.nav = "dl";
    a.innerHTML = `${ICON}<span>Download</span>`;
    a.addEventListener("click", () => go("dl"));
    settingsLink.parentNode.insertBefore(a, settingsLink);
  }
})();
