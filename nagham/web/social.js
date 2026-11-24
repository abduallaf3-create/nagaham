"use strict";
/* Nagham – Friends (see what your friends listen to) and Private songs (hidden from everyone, optional PIN) */
(() => {
  const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
  const USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3.3"/><path d="M3.5 19.5c.4-3.3 2.8-5.2 5.5-5.2s5.1 1.9 5.5 5.2"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.6c1.8.6 3 2.3 3.2 4.9"/></svg>';
  const big = svg => svg.replace("<svg", '<svg style="width:44px;height:44px"');
  const ago = ts => { const m = Math.max(1, Math.round((Date.now() - ts) / 60000)); return m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
  const colorOf = key => phColors(key || "x")[0];

  /* ============================================================ PRIVATE SONGS: still in your library, but friends never see them */
  function setPrivate(ids, on) {
    const set = new Set(settings.privateIds || []);
    ids.forEach(id => on ? set.add(id) : set.delete(id));
    settings.privateIds = [...set]; privRefresh(); saveUser();
    toast(on ? `${plural(ids.length, "song")} hidden from your friends` : `${plural(ids.length, "song")} visible to friends again`);
    render(true);
  }
  window.setPrivate = setPrivate;
  const small = svg => svg;
  const enterOk = () => {};

  /* ============================================================ FRIENDS */
  const friends = () => (settings.friends = settings.friends || []);

  async function buildProfileCode(pick) {
    const refs = ids => ids.filter(id => !isPrivate(id)).map(songRef).filter(Boolean).slice(0, 300);
    const data = { u: settings.uid || (settings.uid = uid() + uid()), n: settings.userName || "A friend", ts: Date.now(), p: [], l: [] };
    if (pick.liked) data.l = refs([...lib.liked].reverse());
    if (pick.k && window.karaokeShareList) data.k = karaokeShareList();
    lib.playlists.filter(p => pick.pl.has(p.id)).forEach(p => { const r = refs(p.tracks.filter(x => T(x))); if (r.length) data.p.push({ n: p.name, t: r }); });
    saveUser();
    return "NGM1.f." + await squeeze(data);
  }

  function shareProfileDialog() {
    const pls = lib.playlists;
    modal(`<h3>Share my profile</h3><p class="muted">Pick what your friends can see. <b>Songs you marked Private are never included.</b></p>
      <div class="pv-list" style="max-height:230px"><label class="pv-row"><input type="checkbox" id="fpLiked" checked><span class="pv-t"><b>Liked Songs</b><small>${plural(lib.liked.size, "song")}</small></span></label>
      <label class="pv-row"><input type="checkbox" id="fpKar" checked><span class="pv-t"><b>My Karaoke scores</b><small>${plural(Object.keys(settings.kScores || {}).length, "song")} you sang</small></span></label>
      ${pls.map(p => `<label class="pv-row"><input type="checkbox" data-pl="${esc(p.id)}" checked><span class="pv-t"><b>${esc(p.name)}</b><small>${plural(p.tracks.length, "song")}</small></span></label>`).join("")}</div>
      <div id="fpOut"></div><div class="row-gap"><button class="btn ghost cancel">Close</button><button class="btn accent ok">Make my code</button></div>`, null, {
      onOpen(bg, done) {
        $(".ok", bg).onclick = async () => {
          const pick = { liked: $("#fpLiked", bg).checked, k: $("#fpKar", bg).checked, pl: new Set($$("[data-pl]", bg).filter(i => i.checked).map(i => i.dataset.pl)) };
          const code = await buildProfileCode(pick);
          $("#fpOut", bg).innerHTML = `<div class="code-box"><code>${esc(code)}</code></div><p class="muted" style="font-size:13px;margin:6px 0 0">Send this code to your friend. They add it in <b>Friends</b>. Send a new code any time to update what they see.</p>`;
          const ok = $(".ok", bg); ok.textContent = "Copy code"; ok.onclick = () => { copyText(code, "Code copied — send it to your friend"); };
        };
      } });
  }

  function addFriend(data) {
    if (!data || !data.u || !data.n) throw new Error("This isn't a friend code");
    if (data.u === settings.uid) throw new Error("That's your own code");
    const f = { id: data.u, name: String(data.n).slice(0, 40), ts: data.ts || Date.now(), added: Date.now(), p: (data.p || []).slice(0, 60), l: (data.l || []).slice(0, 300), k: (data.k || []).slice(0, 40).map(x => [String(x[0] || "").slice(0, 120), String(x[1] || "").slice(0, 80), Math.max(0, Math.min(100, +x[2] || 0)), +x[3] || 0, x[4]]) };
    const list = friends(), i = list.findIndex(x => x.id === f.id);
    if (i >= 0) { f.added = list[i].added; list[i] = f; } else list.push(f);
    saveUser();
    return { f, updated: i >= 0 };
  }
  window.addFriendFromCode = addFriend;

  VIEWS_EXTRA.friends = () => {
    const list = friends();
    return `<div class="pad fade-in fr-page"><h1 class="greet">Friends <span class="muted" style="font-size:16px">الأصدقاء</span></h1>
      <div class="fr-top">
        <div class="settings-sec"><h3>Your profile</h3><p class="muted" style="margin:4px 0 12px">Share a code with a friend. They can see the playlists and liked songs you pick — except songs you marked <b>Private</b> (right-click a song → Make private).</p>
          <div class="fr-me"><div class="fr-av" style="--c:${colorOf(settings.uid || "me")}">${esc((settings.userName || "Y")[0].toUpperCase())}</div><div style="flex:1"><b>${esc(settings.userName || "You")}</b><div class="muted" style="font-size:13px">${plural(lib.playlists.length, "playlist")} • ${plural(lib.liked.size, "liked song")}</div></div><button class="btn accent" data-frshare>${IC.share}Share my profile</button></div></div>
        <div class="settings-sec"><h3>Add a friend</h3><p class="muted" style="margin:4px 0 12px">Paste the code your friend sent you.</p>
          <div class="field" style="margin:0"><input class="input" id="frCode" placeholder="NGM1.f.…" spellcheck="false" autocomplete="off"><button class="btn accent" data-fradd>Add</button></div><div id="frErr" class="priv-err" style="margin-top:8px"></div></div>
      </div>
      <h3 style="margin:26px 0 10px">${list.length ? plural(list.length, "friend") : "No friends yet"}</h3>
      ${list.length ? `<div class="fr-grid">${list.map(f => `<div class="fr-card" data-frid="${esc(f.id)}"><div class="fr-av lg" style="--c:${colorOf(f.id)}">${esc(f.name[0].toUpperCase())}</div><div class="fr-name">${esc(f.name)}</div><div class="muted fr-sub">${plural(f.p.length, "playlist")} • ${plural(f.l.length, "liked song")}</div><div class="muted fr-sub">Updated ${ago(f.ts)}</div></div>`).join("")}</div>`
      : `<div class="empty" style="padding:30px 0"><div class="big">${big(USERS)}</div><p>Ask a friend to press <b>Share my profile</b> and send you their code.</p></div>`}
      <p class="muted" style="font-size:13px;margin-top:22px">Nagham has no server, so a friend's list updates when they send you a new code.</p></div>`;
  };

  VIEWS_EXTRA.friend = id => {
    const f = friends().find(x => x.id === id);
    if (!f) return `<div class="pad empty"><h2>Friend not found</h2></div>`;
    const sec = (title, n, key, refs) => `<div class="fr-pl" data-frkey="${esc(key)}"><div class="fr-plh"><div style="flex:1;min-width:0"><b>${esc(title)}</b><div class="muted" style="font-size:13px">${plural(n, "song")}</div></div>
      <button class="btn ghost sm" data-frsave="${esc(key)}">${IC.plus}Save to mine</button><button class="btn accent sm" data-frplay="${esc(key)}">${IC.play}Play</button></div>
      <div class="fr-songs">${refs.slice(0, 8).map(r => Array.isArray(r) ? `<span>${esc(r[0])}${r[1] ? " · " + esc(r[1]) : ""}</span>` : "").join("")}${refs.length > 8 ? `<span class="muted">+${refs.length - 8} more</span>` : ""}</div></div>`;
    return `<div class="pad fade-in fr-page"><div class="fr-head"><div class="fr-av lg" style="--c:${colorOf(f.id)}">${esc(f.name[0].toUpperCase())}</div><div style="flex:1;min-width:0"><h1 class="greet" style="margin:0">${esc(f.name)}</h1><div class="muted">${plural(f.p.length, "playlist")} • ${plural(f.l.length, "liked song")} • updated ${ago(f.ts)}</div></div>
      <button class="btn ghost sm" data-frback>← Friends</button><button class="btn ghost sm" data-frremove="${esc(f.id)}">${IC.trash}Remove</button></div>
      ${(f.k || []).length ? `<div class="fr-pl"><div class="fr-plh"><div style="flex:1"><b>🎤 Karaoke scores</b><div class="muted" style="font-size:13px">${plural(f.k.length, "song")} ${esc(f.name)} sang</div></div></div>
        ${f.k.map(x => { const mine = (settings.kScores || {})[norm(x[0]) + "|" + norm(String(x[1] || "").split(",")[0])]; return `<div class="sg-brow"><span class="sg-bn"><b>${esc(x[0])}</b> <span class="muted">${esc(x[1])}</span></span><span class="sg-bs">${"★".repeat(x[2] >= 90 ? 5 : x[2] >= 75 ? 4 : x[2] >= 55 ? 3 : x[2] >= 35 ? 2 : x[2] >= 15 ? 1 : 0)}</span><b>${x[2]}</b>${mine ? `<span class="muted" style="font-size:12px">you ${mine.best}</span>` : ""}<button class="btn ghost sm" data-singref="${esc(norm(x[0]) + "|" + norm(String(x[1] || "").split(",")[0]))}">Sing</button></div>`; }).join("")}</div>` : ""}
      ${f.l.length ? sec("Liked songs", f.l.length, "l", f.l) : ""}${f.p.map((p, i) => sec(p.n, p.t.length, "p" + i, p.t)).join("")}
      ${!f.l.length && !f.p.length && !(f.k || []).length ? `<div class="empty"><h2>${esc(f.name)} hasn't shared any songs</h2></div>` : ""}
      <p class="muted" style="font-size:13px;margin-top:20px">Songs on ${esc(f.name)}'s computer are found again here in your library or online.</p></div>`;
  };

  const frRefs = (f, key) => key === "l" ? f.l : f.p[+key.slice(1)]?.t || [];
  const frName = (f, key) => key === "l" ? `${f.name}'s liked songs` : f.p[+key.slice(1)]?.n || "Playlist";
  async function frResolve(refs, btn) {
    const ids = []; let i = 0, done = 0;
    const worker = async () => { while (i < refs.length) { const k = i++; const id = await resolveRef(refs[k]).catch(() => null); if (id) ids[k] = id; done++; if (btn) btn.textContent = `Finding… ${Math.round(done * 100 / refs.length)}%`; } };
    await Promise.all(Array.from({ length: 4 }, worker));
    return ids.filter(Boolean);
  }
  async function frAct(kind, key, btn) {
    const f = friends().find(x => x.id === nav.stack[nav.idx]?.arg); if (!f) return;
    const refs = frRefs(f, key), label = btn.innerHTML;
    btn.disabled = true;
    try {
      const ids = await frResolve(refs, btn);
      if (!ids.length) { toast("Couldn't find these songs — check your internet"); return; }
      if (kind === "play") playContext(ids, 0, { type: "friend", id: f.id + key, name: frName(f, key) });
      else { const p = { id: uid(), name: frName(f, key), tracks: ids, created: Date.now() }; lib.playlists.push(p); saveUser(); renderLib(); toast(`Saved “${p.name}” to your library`); }
    } finally { btn.disabled = false; btn.innerHTML = label; }
  }

  /* ============================================================ wiring */
  document.addEventListener("click", async e => {
    const t = e.target;
    if (t.closest("[data-frshare]")) return shareProfileDialog();
    if (t.closest("[data-fradd]")) {
      const inp = $("#frCode"); if (!inp) return;
      try { const c = await decodeCode(inp.value); if (c.type !== "f") throw new Error("That's not a friend code — use the Enter code button for songs and playlists"); const r = addFriend(c.data); toast(r.updated ? `${r.f.name} updated` : `${r.f.name} added`); go("friend", r.f.id); }
      catch (err) { $("#frErr").textContent = err.message; }
      return;
    }
    const card = t.closest("[data-frid]"); if (card) return go("friend", card.dataset.frid);
    if (t.closest("[data-frback]")) return go("friends");
    const rm = t.closest("[data-frremove]"); if (rm) { if (await confirm_("Remove this friend?", "Their playlists will disappear from your Friends page.", "Remove")) { settings.friends = friends().filter(f => f.id !== rm.dataset.frremove); saveUser(); go("friends"); } return; }
    const pl = t.closest("[data-frplay]"); if (pl) return frAct("play", pl.dataset.frplay, pl);
    const sv = t.closest("[data-frsave]"); if (sv) return frAct("save", sv.dataset.frsave, sv);
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (e.target.id === "frCode") $("[data-fradd]")?.click();
  });

  /* ---------- sidebar entries + styles */
  const st = document.createElement("style");
  st.textContent = `
.priv-art{display:grid;place-items:center;width:100%;height:100%;background:linear-gradient(135deg,#3b2a73,#150f2e);color:#fff}
.priv-lock{text-align:center;padding-top:9vh!important}.priv-ring{width:96px;height:96px;margin:0 auto 14px;border-radius:50%;display:grid;place-items:center;background:var(--input);color:var(--accent);animation:privPulse 2.4s ease-in-out infinite}
@keyframes privPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 40%,transparent)}50%{box-shadow:0 0 0 16px transparent}}
.priv-pinrow{display:inline-flex;gap:8px;margin-top:10px}.priv-pinrow .input{width:170px;text-align:center;letter-spacing:6px;font-size:18px}
.priv-err{color:#ff6b81;font-size:14px;min-height:18px;margin-top:10px}.shake{animation:shk .35s}@keyframes shk{20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
.priv-banner{display:flex;gap:16px;align-items:center;margin:14px 0}
.pv-list{max-height:320px;overflow:auto;margin:6px 0 12px;border-radius:12px}.pv-row{display:flex;gap:12px;align-items:center;padding:8px 10px;border-radius:10px;cursor:pointer}.pv-row:hover{background:var(--input)}.pv-t{display:flex;flex-direction:column;min-width:0}.pv-t b,.pv-t small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pv-t small{color:var(--muted)}
.fr-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}.fr-me{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.fr-av{width:46px;height:46px;border-radius:50%;background:var(--c);color:#fff;display:grid;place-items:center;font-weight:800;font-size:19px;flex:none}.fr-av.lg{width:64px;height:64px;font-size:26px}
.fr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}.fr-card{padding:18px;border-radius:16px;background:var(--input);cursor:pointer;text-align:center;transition:transform .18s,background .18s}.fr-card:hover{transform:translateY(-3px);background:rgba(127,127,127,.22)}
.fr-card .fr-av{margin:0 auto 10px}.fr-name{font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fr-sub{font-size:13px;margin-top:3px}
.fr-head{display:flex;gap:16px;align-items:center;margin-bottom:20px;flex-wrap:wrap}.fr-pl{padding:14px 16px;border-radius:16px;background:var(--input);margin-top:12px}.fr-plh{display:flex;gap:10px;align-items:center}
.fr-songs{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.fr-songs span{font-size:13px;padding:4px 10px;border-radius:999px;background:rgba(127,127,127,.18)}
.privmark{display:inline-flex;margin-inline-start:8px;color:var(--muted);vertical-align:-2px}.privmark svg{width:14px;height:14px}`;
  document.head.appendChild(st);
  const settingsLink = $('[data-nav="settings"]');
  const addNav = (key, label, icon) => {
    if (!settingsLink || $(`[data-nav="${key}"]`)) return;
    const a = document.createElement("a"); a.dataset.nav = key; a.innerHTML = `${icon}<span>${label}</span>`;
    a.addEventListener("click", () => go(key)); settingsLink.parentNode.insertBefore(a, settingsLink);
  };
})();
