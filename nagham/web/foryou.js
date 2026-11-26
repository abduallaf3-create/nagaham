"use strict";
/* Nagham – "For you": your own picks from YouTube Music or Spotify (you choose; both can be signed in).
   You sign in inside Nagham's window — no sign-in callback / webhook, no keys. A hidden page of that
   service reads your home (ytacct.go). Spotify songs play through YouTube Music, like every online song. */
(() => {
  const SVC = {
    yt: { name: "YouTube Music", key: "ytAcct", account: "Google",
      signin: "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=" +
        encodeURIComponent("https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=" + encodeURIComponent("https://music.youtube.com/")),
      home: "https://music.youtube.com/", logout: "https://www.youtube.com/logout",
      blurb: "Your mixes, daily picks, “listen again” and new releases for you." },
    sp: { name: "Spotify", key: "spAcct", account: "Spotify",
      signin: "https://accounts.spotify.com/login?continue=" + encodeURIComponent("https://open.spotify.com/"),
      home: "https://open.spotify.com/", logout: "https://www.spotify.com/logout/",
      blurb: "Made for you, your top mixes, recently played and more from your Spotify home." },
  };
  const S0 = () => ({ data: null, at: 0, loading: false, err: "", needLogin: false, gen: 0 });
  const FY = { yt: S0(), sp: S0(), signing: "" };
  window.FY = FY;
  const cur = () => (settings.fySvc === "sp" ? "sp" : "yt");
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
  const acct = body => api("/api/yt/acct", body);
  const big = u => (u || "").replace(/=w\d+-h\d+[^&]*$/, "=w544-h544-l90-rj").replace(/\/(default|mqdefault|hqdefault)\.jpg/, "/hqdefault.jpg")
    .replace(/(i\.scdn\.co\/image\/ab67616d0000)(1e02|4851)/, "$1b273");
  const linked = s => !!settings[SVC[s].key];
  const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return (h >>> 0).toString(36); };

  async function ask(req, ms = 60000) {
    const r = await acct({ req });
    if (!r?.native) throw new Error("native");
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await new Promise(res => setTimeout(res, 500));
      const a = await api("/api/yt/acct/result?seq=" + r.seq);
      if (!a?.wait) { if (a.error) throw new Error(a.error); return a; }
    }
    throw new Error(SVC[req.svc || "yt"].name + " didn't answer");
  }

  const secs = d => String(d || "").split(":").map(Number).reduce((a, b) => a * 60 + (b || 0), 0);
  function fyTrack(s) {
    if (s?.v) return { id: "yt:" + s.v, src: "yt", youtube: true, online: true, title: s.title || "Untitled", artist: s.artist || "", album: "", cover: big(s.th), coverSmall: s.th || "", duration: secs(s.dur) || 0 };
    if (s?.title) { // a Spotify song: played through YouTube Music (found by its name and singer)
      const id = "spfy:" + (s.sp || hash(s.title + "|" + (s.artist || "")));
      return { id, src: "spfy", online: true, title: s.title, artist: s.artist || "", album: s.album || "", cover: big(s.th || s.cover), coverSmall: s.th || s.cover || "", duration: s.duration || secs(s.dur) || 0 };
    }
    return null;
  }

  async function loadHome(svc, force) {
    const F = FY[svc];
    if (F.loading || (!force && F.data && Date.now() - F.at < 20 * 60e3)) return;
    F.loading = true; F.err = ""; const my = ++F.gen;
    redraw();
    try {
      const d = await ask({ svc, kind: "home" });
      if (my !== F.gen) return;
      if (!d.loggedIn) { F.needLogin = true; F.data = null; if (settings[SVC[svc].key]) { settings[SVC[svc].key] = false; saveUser(); } }
      else { F.needLogin = false; F.data = d; F.at = Date.now(); settings[SVC[svc].key] = { name: d.name || "" }; saveUser(); }
    } catch (e) { if (my === F.gen) F.err = e.message === "native" ? "native" : e.message; }
    if (my === F.gen) { F.loading = false; redraw(); }
  }
  window.fyLoadHome = loadHome;

  const onPage = () => ["foryou", "home"].includes(nav.stack[nav.idx]?.view);
  function redraw() { if (onPage()) render(true); }

  /* ---- connecting: one click. Already signed in there → done in a few seconds, nothing to see.
     Otherwise a small sign-in card opens with the service's own sign-in page in it, and closes by itself. */
  const LOGO = {
    yt: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ff1f1f"/><circle cx="12" cy="12" r="5.6" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M10.6 9.6v4.8l3.9-2.4z" fill="#fff"/></svg>',
    sp: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1ed760"/><path d="M6.6 9.3c3.6-1.1 7.6-.8 10.9 1M7.2 12.3c3-.9 6.2-.6 8.9.9M7.7 15.1c2.4-.7 4.8-.5 6.9.7" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };
  let modal = null;
  function sendRect() {
    const b = $("#fySignBox"); if (!b || FY.signing !== "page") return;
    const r = b.getBoundingClientRect(), d = devicePixelRatio || 1;
    acct({ show: true, rect: [Math.round(r.left * d), Math.round(r.top * d), Math.round(r.width * d), Math.round(r.height * d)] }).catch(() => {});
  }
  addEventListener("resize", () => sendRect());
  function openModal(svc) {
    closeModal(true);
    modal = document.createElement("div");
    modal.className = "fy-modal";
    modal.innerHTML = `<div class="fy-box" role="dialog" aria-label="Connect ${SVC[svc].name}">
      <div class="fy-box-head"><span class="fy-logo">${LOGO[svc]}</span><div><b>Connect ${SVC[svc].name}</b><span>Your picks, right inside Nagham</span></div><button class="fy-x" data-fyx title="Cancel">✕</button></div>
      <div class="fy-box-body" id="fySignBox"><div class="fy-wait"><div class="fy-spin"></div><b>Connecting…</b><span>Checking if you're already signed in</span></div></div>
      <div class="fy-box-foot">🔒 You sign in on ${SVC[svc].name}'s own page — Nagham never sees your password.</div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal || e.target.closest("[data-fyx]")) cancelSignIn(); });
    requestAnimationFrame(() => modal?.classList.add("in"));
  }
  function closeModal(now) {
    const m = modal; modal = null; if (!m) return;
    if (now) m.remove(); else { m.classList.remove("in"); setTimeout(() => m.remove(), 220); }
  }
  function modalState(html) { const b = $("#fySignBox"); if (b) b.innerHTML = html; }
  addEventListener("keydown", e => { if (e.key === "Escape" && modal) { e.stopPropagation(); cancelSignIn(); } }, true);

  async function startSignIn() {
    const svc = cur(), my = svc + Date.now();
    FY.signing = "check"; FY.signTok = my;
    openModal(svc);
    // 1) already signed in there? (the hidden page checks, nothing is shown)
    try {
      const d = await ask({ svc, kind: "check" }, 30000);
      if (FY.signTok !== my) return;
      if (d.loggedIn) return connected(svc, d.name);
    } catch (e) { if (FY.signTok !== my) return; if (e.message === "native") { closeModal(); FY.signing = ""; toast("Connecting works in Nagham's own window on Windows"); return; } }
    // 2) not yet: the sign-in page appears inside the card
    FY.signing = "page";
    modalState("");
    await acct({ nav: SVC[svc].signin }).catch(() => {});
    sendRect(); setTimeout(sendRect, 250); setTimeout(sendRect, 800);
    await new Promise(r => setTimeout(r, 2500));
    while (FY.signTok === my) {
      try {
        const d = await ask({ svc, kind: "status" }, 10000);
        if (FY.signTok !== my) return;
        if (d.loggedIn) return connected(svc, d.name);
      } catch {}
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  async function connected(svc, name) {
    FY.signTok = ""; FY.signing = "";
    await acct({ show: false, nav: SVC[svc].home }).catch(() => {});
    modalState(`<div class="fy-wait ok"><div class="fy-tick">✓</div><b>Connected${name ? " as " + esc(name) : ""}</b><span>Getting your picks…</span></div>`);
    settings[SVC[svc].key] = { name: name || "" }; saveUser();
    FY[svc].needLogin = false; FY[svc].err = ""; FY[svc].data = null;
    setTimeout(() => closeModal(), 1100);
    render(true);
    setTimeout(() => { acct({ open: false }).catch(() => {}); loadHome(svc, true); }, 1500);
  }
  function cancelSignIn() {
    FY.signTok = ""; FY.signing = "";
    acct({ show: false, open: false }).catch(() => {});
    closeModal();
  }
  const finishSignIn = () => connected(cur(), "");
  async function signOut() {
    const svc = cur(), s = SVC[svc];
    if (!(await confirm_(`Sign out of ${s.name} in Nagham? Songs keep playing; For you from ${s.name} goes away until you sign in again.`))) return;
    await acct({ nav: s.logout }).catch(() => {});
    settings[s.key] = false; saveUser(); FY[svc].data = null; FY[svc].needLogin = true;
    setTimeout(() => acct({ open: false }).catch(() => {}), 6000);
    render(true); toast("Signed out of " + s.name);
  }

  /* ---- tiles */
  function shelfHTML(svc, sh, si) {
    const key = "fy" + svc + si;
    const songs = sh.items.filter(i => i.t === "song");
    if (songs.length) setList(key, registerOnline(songs.map(fyTrack).filter(Boolean)), { type: "chart", id: key, name: sh.title });
    let k = 0;
    const tiles = sh.items.map((it, ii) => {
      if (it.t === "song") { const t = fyTrack(it); return t ? songTile(t.id, key, k++) : ""; }
      const art = `<div class="art${it.t === "artist" ? " circle" : ""}">${imgHTML(proxImg(big(it.th)), it.b || it.list || it.sp || it.title, IC.disc)}</div>`;
      if (it.t === "artist") return `<div class="tile" data-fyartist="${esc(it.title)}">${art}<div class="name"><span>${esc(it.title)}</span></div><div class="sub">${esc(it.sub || "")}</div></div>`;
      const ref = `${svc}:${si}:${ii}`;
      return `<div class="tile" data-fypl="${ref}">${art}<button class="play-big" data-fypl="${ref}">${IC.play}</button><div class="name"><span>${esc(it.title)}</span></div><div class="sub">${esc(it.sub || "")}</div></div>`;
    }).join("");
    return `<h2 class="sec">${esc(sh.title)}${sh.strap ? ` <span class="hint">${esc(sh.strap)}</span>` : ""}</h2><div class="row-scroll">${tiles}</div>`;
  }
  async function playPl(svc, si, ii) {
    const it = FY[svc].data?.shelves?.[si]?.items?.[ii]; if (!it) return;
    toast("Opening “" + it.title + "”…");
    try {
      let songs = [];
      if (svc === "sp") {
        // public playlists and albums are read straight away; your private ones through your Spotify page
        try {
          const info = await api("/api/dl/expand?url=" + encodeURIComponent(`https://open.spotify.com/${it.t}/${it.sp}`) + "&country=" + (settings.country || "us"));
          songs = (info.tracks || []).map(t => ({ title: t.title, artist: t.artist, album: t.album, duration: t.duration, cover: t.cover || info.cover || it.th }));
        } catch {}
        if (!songs.length) songs = ((await ask({ svc, kind: "queue", type: it.t, id: it.sp })).songs || []).map(s => Object.assign(s, { th: s.th || it.th }));
      } else songs = (await ask({ svc, kind: "queue", id: it.list || "", b: it.b || "" })).songs || [];
      const ids = registerOnline(songs.map(fyTrack).filter(Boolean));
      if (!ids.length) return toast("No songs in “" + it.title + "”");
      playContext(ids, 0, { type: "chart", id: "fypl:" + (it.list || it.b || it.sp), name: it.title });
    } catch (e) { toast("Couldn't open it: " + e.message); }
  }
  $("#view").addEventListener("click", e => {
    const p = e.target.closest("[data-fypl]");
    if (p) { e.stopPropagation(); const [svc, si, ii] = p.dataset.fypl.split(":"); playPl(svc, +si, +ii); return; }
    const a = e.target.closest("[data-fyartist]");
    if (a) { e.stopPropagation(); go("search", a.dataset.fyartist); return; }
    const v = e.target.closest("[data-fysvc]");
    if (v) { e.stopPropagation(); settings.fySvc = v.dataset.fysvc; saveUser(); render(true); return; }
    const b = e.target.closest("[data-fy]"); if (!b) return;
    e.stopPropagation();
    ({ signin: startSignIn, done: finishSignIn, cancel: cancelSignIn,
       refresh: () => loadHome(cur(), true), signout: signOut })[b.dataset.fy]?.();
  }, true);

  function tabsHTML() {
    const t = s => `<button data-fysvc="${s}" class="${cur() === s ? "on" : ""}"><span class="fy-dot ${s}"></span>${SVC[s].name}${linked(s) ? ' <span class="fy-ok">✓</span>' : ""}</button>`;
    return `<div class="fy-tabs" role="tablist">${t("yt")}${t("sp")}</div>`;
  }
  function signInCard(svc) {
    const s = SVC[svc];
    return `<div class="notice fy-card">${ICON}<div><b style="color:var(--text)">See your own ${s.name} picks here</b><br>${s.blurb} One click — no keys, nothing to set up.${svc === "sp" ? "<br><span class=\"muted\">Spotify songs play through YouTube Music, like every song in Nagham.</span>" : ""}
      <div class="row-gap" style="justify-content:flex-start;margin-top:10px"><button class="btn accent fy-connect" data-fy="signin"><span class="fy-logo sm">${LOGO[svc]}</span>Connect ${s.name}</button></div></div></div>`;
  }

  /* the page */
  VIEWS_EXTRA.foryou = () => {
    const svc = cur(), s = SVC[svc], F = FY[svc];
    let h = `<div class="pad fade-in"><div class="fy-head"><h1 class="greet">For you</h1>`;
    if (linked(svc) && !F.needLogin) h += `<span class="muted fy-who">${settings[s.key].name ? esc(settings[s.key].name) : ""}</span><span style="flex:1"></span><button class="btn ghost" data-fy="refresh">Refresh</button><button class="btn ghost" data-fy="signout">Sign out</button>`;
    h += `</div>${tabsHTML()}`;
    if (F.err === "native") return h + `<div class="notice">${ICON}<div>For you works in Nagham's own window on Windows.</div></div></div>`;
    if (!linked(svc) || F.needLogin) return h + signInCard(svc) + "</div>";
    if (!F.data && !F.loading && !F.err) setTimeout(() => loadHome(svc), 0);
    if (F.err && !F.data) return h + `<div class="notice">${ICON}<div><b style="color:var(--text)">Couldn't read your ${s.name} home.</b><br>${esc(F.err)}<div class="row-gap" style="justify-content:flex-start;margin-top:10px"><button class="btn accent" data-fy="refresh">Try again</button></div></div></div></div>`;
    if (!F.data) return h + `<h2 class="sec">Getting your picks…</h2>${skeletonRow()}<h2 class="sec">&nbsp;</h2>${skeletonRow()}</div>`;
    const sh = F.data.shelves || [];
    if (!sh.length) return h + `<div class="notice">${ICON}<div>${s.name} has nothing to suggest yet — play some songs there and come back.</div></div></div>`;
    return h + sh.map((x, i) => shelfHTML(svc, x, i)).join("") + "</div>";
  };

  /* a few of your picks on Home (from the service you chose) */
  window.fyHomeHTML = () => {
    const svc = linked(cur()) ? cur() : ["yt", "sp"].find(linked);
    if (!svc || FY[svc].needLogin) return "";
    const F = FY[svc];
    if (!F.data) { if (!F.loading && !F.err) setTimeout(() => loadHome(svc), 0); return F.loading ? `<h2 class="sec">For you</h2>${skeletonRow()}` : ""; }
    return (F.data.shelves || []).slice(0, 2).map((x, i) => shelfHTML(svc, x, i).replace("</h2>", ` <a data-go="foryou">Show all</a></h2>`)).join("");
  };

  const st = document.createElement("style");
  st.textContent = `.fy-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.fy-head .greet{margin-right:6px}.fy-who{font-size:14px}
.fy-tabs{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:rgba(255,255,255,.06);margin:2px 0 18px}
.fy-tabs button{display:flex;align-items:center;gap:8px;border:0;background:none;color:var(--muted);font:inherit;font-weight:700;padding:8px 16px;border-radius:999px;cursor:pointer}
.fy-tabs button.on{background:var(--accent);color:var(--on-accent)}
.fy-dot{width:9px;height:9px;border-radius:50%;display:inline-block}.fy-dot.yt{background:#ff3b3b}.fy-dot.sp{background:#1ed760}.fy-ok{font-size:12px;opacity:.85}
.fy-modal{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;background:rgba(0,0,0,0);transition:background .2s}
.fy-modal.in{background:rgba(0,0,0,.6)}
.fy-box{width:min(460px,92vw);height:min(640px,88vh);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;background:var(--bg2,#1c1c22);box-shadow:0 24px 70px rgba(0,0,0,.55);transform:translateY(14px) scale(.97);opacity:0;transition:transform .22s,opacity .22s}
.fy-modal.in .fy-box{transform:none;opacity:1}
.fy-box-head{display:flex;align-items:center;gap:12px;padding:16px 16px 14px 18px;border-bottom:1px solid rgba(255,255,255,.07)}
.fy-box-head b{display:block;font-size:16px;color:var(--text)}.fy-box-head span{font-size:12.5px;color:var(--muted)}
.fy-box-head>div{flex:1;min-width:0}
.fy-logo{width:34px;height:34px;flex:none;display:inline-flex}.fy-logo svg{width:100%;height:100%}.fy-logo.sm{width:20px;height:20px;margin-right:8px;vertical-align:-4px}
.fy-x{border:0;background:rgba(255,255,255,.07);color:var(--muted);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:14px}.fy-x:hover{color:var(--text);background:rgba(255,255,255,.14)}
.fy-box-body{flex:1;position:relative;background:#121212}
.fy-box-foot{padding:10px 16px;font-size:12px;color:var(--muted);text-align:center;border-top:1px solid rgba(255,255,255,.07)}
.fy-wait{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--muted);text-align:center;padding:20px}
.fy-wait b{color:var(--text);font-size:17px}
.fy-spin{width:38px;height:38px;border-radius:50%;border:3px solid rgba(255,255,255,.12);border-top-color:var(--accent);animation:fyspin .8s linear infinite;margin-bottom:6px}
@keyframes fyspin{to{transform:rotate(360deg)}}
.fy-tick{width:56px;height:56px;border-radius:50%;background:var(--accent);color:var(--on-accent,#fff);display:grid;place-items:center;font-size:28px;font-weight:800;margin-bottom:6px;animation:fypop .35s ease-out}
@keyframes fypop{from{transform:scale(.4);opacity:0}}
.fy-connect{display:inline-flex;align-items:center}
.fy-card svg{color:var(--accent)}`;
  document.head.appendChild(st);
  const settingsLink = $('[data-nav="settings"]');
  if (settingsLink && !$('[data-nav="foryou"]') && !IOS) {
    const a = document.createElement("a");
    a.dataset.nav = "foryou";
    a.innerHTML = `${ICON}<span>For you</span>`;
    a.addEventListener("click", () => go("foryou"));
    const homeLink = $('[data-nav="home"]');
    (homeLink?.nextSibling ? homeLink.parentNode.insertBefore(a, homeLink.nextSibling) : settingsLink.parentNode.insertBefore(a, settingsLink));
  }
})();
