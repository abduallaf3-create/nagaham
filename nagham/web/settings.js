"use strict";
/* Nagham – Settings tabs, profile menu */

const SETTINGS_TABS = {
  profile() {
    const n = settings.userName || "";
    return `<div class="settings-sec"><h3>Your profile</h3>
      <div class="set-row"><div class="me-big">${esc((n || "?").slice(0, 1).toUpperCase())}</div>
        <div class="lbl" style="flex:1"><b>Your name</b><span>Shown on the home page greeting</span>
        <div class="field"><input class="input" id="nameIn" maxlength="30" value="${esc(n)}" placeholder="Your name"><button class="btn sm accent" data-savename>Save</button></div></div></div>
    </div>
    <div class="settings-sec"><h3>Getting started</h3>
      <div class="set-row"><div class="lbl"><b>Take the tour again</b><span>A quick walk through where everything is</span></div><button class="btn ghost sm" data-tour>Start tour</button></div>
      <div class="set-row"><div class="lbl"><b>Run the welcome setup again</b><span>Name, theme and linked accounts</span></div><button class="btn ghost sm" data-onboard>Run setup</button></div>
    </div>`;
  },
  appearance() { return themesBody(); },
  library() {
    return `<div class="settings-sec"><h3>Music on this PC</h3>
      <p class="muted" style="margin:4px 0 0">Nagham scans these folders and everything inside them. ${lib.scanning ? `<b style="color:var(--text)">Scanning… ${lib.scanned} found</b>` : `${plural(lib.tracks.length, "song")} found.`}</p>
      <div class="folders">${lib.folders.map(f => `<div class="folder">${IC.folder}<span class="p" title="${esc(f)}">${esc(f)}</span><button class="btn ghost sm" data-folder="remove" data-path="${esc(f)}">Remove</button></div>`).join("") || `<p class="muted">No folders yet.</p>`}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${lib.canPick ? `<button class="btn accent sm" data-folder="pick">Add a folder…</button>` : ""}<button class="btn ghost sm" data-folder="rescan">Rescan</button></div>
      <div class="field"><input class="input" id="pathIn" placeholder="…or paste a folder path, e.g. D:\\Music" spellcheck="false"><button class="btn sm" data-folder="add">Add</button></div>
    </div>
    <div class="settings-sec"><h3>Hidden playlists</h3>
      <p class="muted" style="margin:4px 0 8px">Right-click any YouTube or Spotify playlist (or Liked music / Saved songs) and choose <b>Hide from Nagham</b>. Hidden ones are listed here.</p>
      ${(settings.hiddenPl || []).map(h => `<div class="folder"><span class="p">${esc(h.name)} <span class="muted" style="font-size:12px">· ${h.key.startsWith("yt") ? "YouTube Music" : "Spotify"}</span></span><button class="btn ghost sm" data-unhide="${esc(h.key)}">Show again</button></div>`).join("") || `<p class="muted">Nothing hidden.</p>`}
    </div>`;
  },
  accounts() {
    const sp = SP.connected
      ? `<div class="acct-row"><span class="acct-logo sp">${SP_LOGO}</span><div class="lbl" style="flex:1"><b>Spotify — ${esc(SP.user?.display_name || SP.user?.id || "")}</b><span>${SP.premium ? "Premium: full songs play in Nagham (needs the Classic window style)" : "Free account: your playlists and saved songs are in Your Library"}</span></div><button class="btn ghost sm" data-go="spotify">Open</button><button class="btn ghost sm" data-splogout>Unlink</button></div>`
      : `<details class="acct" ${SP.waiting || SP.error ? "open" : ""}><summary><span class="acct-logo sp">${SP_LOGO}</span><div class="lbl" style="flex:1"><b>Spotify</b><span>Bring in your Spotify playlists and saved songs</span></div><span class="btn ghost sm">Link</span></summary><div class="acct-body">${spSetupCard()}</div></details>`;
    return `<div class="settings-sec"><h3>Linked accounts <span class="muted" style="font-size:13px;font-weight:600">(optional — not needed to listen)</span></h3>
      <div class="acct-list">${ytAccountCard()}${sp}${discordCard()}</div></div>`;
  },
  playback() {
    return `<div class="settings-sec"><h3>Playback</h3>
      <div class="set-row"><div class="lbl"><b>Your country</b><span>Used for "Top songs" on the home page and for search</span></div>
        <select class="input" id="countrySel" style="flex:0 0 200px">${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${settings.country === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="set-row"><div class="lbl"><b>Full songs from YouTube</b><span>${YTM.connected ? "Nagham finds each song on YouTube and plays it in full. Each new song uses one YouTube search (about 100 a day); songs you've played before are remembered." : "Link YouTube Music (Linked accounts) and songs that normally play 30 seconds will play in full."}</span></div>
        <label class="switch"><input type="checkbox" id="swYtFull" ${settings.ytFull !== false ? "checked" : ""} ${YTM.connected ? "" : "disabled"}><i></i></label></div>
      <div class="set-row"><div class="lbl"><b>Songs YouTube won't play inside Nagham</b><span>Many music videos are blocked by YouTube in other apps. Open them in full in a YouTube Music window, or skip them. (Nagham never plays 30-second clips.)</span></div>
        <div class="seg" data-elsewhere>${[["open", "Open in YouTube Music"], ["skip", "Skip"]].map(([v, l]) => `<button data-v="${v}" class="${(settings.elsewhere || "open") === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="set-row"><div class="lbl"><b>YouTube Music window</b><span>Size and where it opens. Small is a compact player you can keep beside Nagham.</span></div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <div class="seg" data-ytmsize>${[["s", "Small"], ["m", "Medium"], ["l", "Large"]].map(([v, l]) => `<button data-v="${v}" class="${(settings.ytmSize || "l") === v ? "on" : ""}">${l}</button>`).join("")}</div>
          <div class="seg" data-ytmpos>${[["left", "Left"], ["center", "Center"], ["right", "Right"]].map(([v, l]) => `<button data-v="${v}" class="${(settings.ytmPos || "right") === v ? "on" : ""}">${l}</button>`).join("")}</div>
          ${EXT.url ? '<button class="btn ghost sm" data-ytmapply>Apply to the open window</button>' : ""}
        </div></div>
      <div class="set-row"><div class="lbl"><b>Video box inside Nagham</b><span>Drag its top bar to move it, drag the corner to resize, ▣ to switch size. Double-click the bar to put it back.</span></div><button class="btn ghost sm" data-minireset>Reset position</button></div>
      <div class="set-row"><div class="lbl"><b>Open a code from a friend</b><span>Songs, playlists and themes — or just press Ctrl+V anywhere</span></div><button class="btn ghost sm" data-opencode>Enter code</button></div>
    </div>
    <div class="settings-sec"><h3>Window</h3>
      <div class="set-row"><div class="lbl"><b>Window style</b><span>Themed: the title bar takes your theme's colours (Windows 11). Classic: a standard Edge window (needed for full Spotify Premium playback). Applies next time you open Nagham.</span></div>
        <div class="seg" data-winmode><button data-v="themed" class="${settings.windowMode !== "classic" ? "on" : ""}">Themed</button><button data-v="classic" class="${settings.windowMode === "classic" ? "on" : ""}">Classic</button></div></div>
    </div>`;
  },
  shortcuts() {
    return `<div class="settings-sec"><h3>Keyboard shortcuts</h3><div class="kbd" style="margin-top:12px">
      <span><kbd>Space</kbd></span><span>Play / pause</span>
      <span><kbd>Ctrl</kbd> + <kbd>→</kbd> / <kbd>←</kbd></span><span>Next / previous song</span>
      <span><kbd>Shift</kbd> + <kbd>→</kbd> / <kbd>←</kbd></span><span>Seek forward / back 5 seconds</span>
      <span><kbd>Ctrl</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></span><span>Volume up / down</span>
      <span><kbd>S</kbd> · <kbd>R</kbd> · <kbd>M</kbd> · <kbd>Q</kbd> · <kbd>F</kbd></span><span>Shuffle · Repeat · Mute · Queue · Full-screen player</span>
      <span><kbd>Ctrl</kbd> + <kbd>F</kbd> or <kbd>/</kbd></span><span>Search</span>
      <span><kbd>Ctrl</kbd> + <kbd>N</kbd></span><span>New playlist</span>
      <span><kbd>Ctrl</kbd> + <kbd>V</kbd></span><span>Open a code you copied from a friend</span>
      <span><kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd></span><span>Back / forward</span>
    </div></div>`;
  },
  about() {
    return `<div class="settings-sec about"><img src="icon.svg" alt="" class="about-logo"><h3 style="font-size:24px">Nagham <span class="muted" style="font-size:14px">${esc(UPD.current || "3.1")}</span></h3>
      <p class="muted">Everything Nagham needs comes inside the app — no Python or other downloads.</p>
      <div class="set-row"><div class="lbl"><b>Updates</b><span>${UPD.checking ? "Checking GitHub…" : UPD.info?.newer ? `Version ${esc(UPD.info.latest)} is available` : UPD.info?.error ? (UPD.info.error === "no repository set" ? "Add your GitHub repository below to get updates" : esc(UPD.info.error)) : UPD.info?.latest ? `You have the newest version (${esc(UPD.info.current)})` : "New versions come from GitHub Releases"}</span></div>
        ${UPD.info?.newer ? `<button class="btn accent sm" data-updinstall>Update now</button>` : `<button class="btn ghost sm" data-updcheck>Check for updates</button>`}</div>
      <div class="set-row"><div class="lbl"><b>GitHub repository</b><span>Where new versions are published, like <code>yourname/Nagham</code></span></div>
        <div class="field" style="margin:0;max-width:300px"><input class="input" id="updRepo" placeholder="owner/Nagham" spellcheck="false" value="${esc(settings.updateRepo || UPD.info?.repo || "")}"><button class="btn sm ghost" data-updsave>Save</button></div></div>
      <div class="set-row"><div class="lbl"><b>Your data</b><span>Playlists, likes, themes and linked accounts are stored only on this computer, in %APPDATA%\\Nagham</span></div></div>
      <div class="set-row"><div class="lbl"><b>Song catalogue</b><span>Song info and charts: Deezer & Apple Music. Free full songs: Audius. Linked accounts: YouTube Music, Spotify.</span></div></div>
    </div>`;
  },
};

/* settings interactions */
$("#view").addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("[data-savename]")) { settings.userName = $("#nameIn").value.trim(); saveUser(); renderMe(); toast("Saved"); render(true); return; }
  if (t.closest("[data-tour]")) { startTour(); return; }
  if (t.closest("[data-onboard]")) { startOnboarding(); return; }
  if (t.closest("[data-opencode]")) { openCodeDialog(); return; }
  if (t.closest("[data-newpl]")) { newPlaylist(); return; }
});
$("#view").addEventListener("click", e => {
  const sz = e.target.closest("[data-ytmsize] button"); if (sz) { settings.ytmSize = sz.dataset.v; saveUser(); render(true); return; }
  const ps = e.target.closest("[data-ytmpos] button"); if (ps) { settings.ytmPos = ps.dataset.v; saveUser(); render(true); return; }
  if (e.target.closest("[data-ytmapply]")) { reopenYtm(); return; }
  if (e.target.closest("[data-minireset]")) { settings.ytMini = {}; saveUser(); applyMiniGeom(); toast("Video box reset"); }
});
$("#view").addEventListener("click", e => { const b = e.target.closest("[data-elsewhere] button"); if (b) { settings.elsewhere = b.dataset.v; saveUser(); render(true); } });
$("#view").addEventListener("change", e => { if (e.target.id === "swYtFull") { settings.ytFull = e.target.checked; saveUser(); toast(settings.ytFull ? "Full songs from YouTube: on" : "Full songs from YouTube: off"); } });
$("#view").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "nameIn") $("[data-savename]")?.click(); });

/* playlists from linked accounts, for Your Library */
function linkedPlaylistTiles() {
  let h = "";
  if (YTM.connected) {
    const c = ytLoad("myplaylists", YTF.myplaylists);
    if (!isHidden("ytliked:")) h += `<div class="tile" data-go="ytliked"><div class="art"><div class="art-ph" style="background:linear-gradient(135deg,#ff4e45,#8a1c17)">${YT_LOGO}</div></div><button class="play-big" data-playctx="ytliked:">${IC.play}</button><div class="name"><span>Liked music</span></div><div class="sub">YouTube Music</div></div>`;
    for (const p of c.data || []) if (!isHidden("ytplaylist:" + p.id)) h += ytPlaylistTile(p);
  }
  if (SP.connected) {
    const c = spLoad("myplaylists", SPF.myplaylists);
    if (!isHidden("spliked:")) h += `<div class="tile" data-go="spliked"><div class="art">${likedArt()}</div><button class="play-big" data-playctx="spliked:">${IC.play}</button><div class="name"><span>Saved songs</span></div><div class="sub">Spotify</div></div>`;
    for (const p of c.data || []) if (!isHidden("spplaylist:" + p.id)) h += spPlaylistTile(p);
  }
  return h;
}

/* the round "you" button in the top bar */
function renderMe() {
  const b = $("#meBtn"); if (!b) return;
  const n = settings.userName || "";
  b.innerHTML = `<span class="me-av">${esc((n || "♪").slice(0, 1).toUpperCase())}</span><span class="lbl">${esc(n || "You")}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>`;
}
$("#meBtn").onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();
  menu(r.right - 240, r.bottom + 8, [
    { label: "Enter a code from a friend", icon: IC.share, act: () => openCodeDialog() },
    { label: (settings.dynamic ? "✓ " : "") + "Colours follow the song", icon: IC.palette, act: () => setDynamic(!settings.dynamic) },
    { label: "Themes", icon: IC.palette, act: () => go("settings", "appearance") },
    { label: "Linked accounts", icon: IC.share, act: () => go("settings", "accounts") },
    "-",
    { label: "Settings", icon: IC.dots, act: () => go("settings") },
    { label: "Take the tour", icon: IC.info, act: () => startTour() },
  ]);
};

/* ---------------- hide / delete linked playlists ---------------- */
const isHidden = key => (settings.hiddenPl || []).some(h => h.key === key);
function hidePl(key, name) {
  settings.hiddenPl = [...(settings.hiddenPl || []).filter(h => h.key !== key), { key, name }];
  saveUser(); renderLib();
  const cur = nav.stack[nav.idx];
  if (cur && (cur.view + ":" + (cur.arg || "")) === key) go("library", "playlists", true); else render(true);
  toast(`“${name}” hidden — bring it back in Settings → Music on this PC`);
}
function unhidePl(key) { settings.hiddenPl = (settings.hiddenPl || []).filter(h => h.key !== key); saveUser(); renderLib(); render(true); }
function linkedPlName(kind, id) {
  if (kind === "ytliked") return "Liked music";
  if (kind === "spliked") return "Saved songs";
  if (kind === "ytplaylist") { const p = (oCache["yt:myplaylists"]?.data || []).find(p => p.id === id); return p?.snippet?.title || oCache["yt:pl:" + id]?.data?.pl?.snippet?.title || "Playlist"; }
  const p = (oCache["sp:myplaylists"]?.data || []).find(p => p.id === id); return p?.name || oCache["sp:pl:" + id]?.data?.pl?.name || "Playlist";
}
async function deleteLinkedPl(kind, id, name) {
  const yt = kind === "ytplaylist";
  const ok = await confirm_(yt ? `Delete “${name}” from YouTube?` : `Remove “${name}” from your Spotify?`,
    yt ? "This deletes the playlist from your YouTube / YouTube Music account for good. It can't be undone." : "This removes the playlist from your Spotify library (if you made it, it's deleted). You can follow it again later from Spotify.",
    yt ? "Delete from YouTube" : "Remove from Spotify");
  if (!ok) return;
  try {
    const r = await fetch(yt ? `/api/youtube/v3/playlists?id=${encodeURIComponent(id)}` : `/api/spotify/v1/playlists/${encodeURIComponent(id)}/followers`, { method: "DELETE" });
    if (!r.ok) throw new Error((await r.text()).trim() || "Couldn't delete it");
    delete oCache[(yt ? "yt:" : "sp:") + "myplaylists"]; delete oCache[(yt ? "yt:pl:" : "sp:pl:") + id];
    settings.hiddenPl = (settings.hiddenPl || []).filter(h => h.key !== kind + ":" + id); saveUser();
    const cur = nav.stack[nav.idx];
    if (cur?.view === kind && cur.arg === id) go("library", "playlists", true); else render(true);
    renderLib(); toast(`“${name}” ${yt ? "deleted from YouTube" : "removed from Spotify"}`);
  } catch (e) { toast(e.message); }
}
function linkedPlaylistMenu(kind, id, x, y) {
  const name = linkedPlName(kind, id), key = kind + ":" + id;
  const items = [
    { label: "Play", icon: IC.play, act: () => playCtxKey(key) },
    { label: "Copy into a Nagham playlist", icon: IC.plus, act: async () => {
      const ids = kind.startsWith("yt") ? (kind === "ytliked" ? (await ytEnsureData("liked", YTF.liked)).ids : (await ytEnsureData("pl:" + id, () => YTF.playlist(id))).ids)
        : (kind === "spliked" ? (await spEnsure("liked", SPF.liked)).ids : (await spEnsure("pl:" + id, () => SPF.playlist(id))).ids);
      const p = { id: uid(), name, tracks: [...ids], created: Date.now() }; lib.playlists.push(p); saveUser(); renderLib(); toast(`Copied “${name}” to Your Library`);
    } },
    "-",
    { label: "Hide from Nagham", icon: IC.edit, act: () => hidePl(key, name) },
  ];
  if (kind === "ytplaylist") items.push({ label: "Delete from YouTube…", icon: IC.trash, act: () => deleteLinkedPl(kind, id, name) });
  if (kind === "spplaylist") items.push({ label: "Remove from Spotify…", icon: IC.trash, act: () => deleteLinkedPl(kind, id, name) });
  menu(x, y, items);
}
/* right-click on any linked playlist (sidebar, library, home) */
for (const host of [$("#libList"), $("#view")]) host.addEventListener("contextmenu", e => {
  const el = e.target.closest('[data-ctx^="ytplaylist:"],[data-ctx^="spplaylist:"],[data-ctx="ytliked:"],[data-ctx="spliked:"],[data-go^="ytplaylist:"],[data-go^="spplaylist:"],[data-go="ytliked"],[data-go="spliked"]');
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  const key = el.dataset.ctx || el.dataset.go, i = key.indexOf(":");
  linkedPlaylistMenu(i < 0 ? key : key.slice(0, i), i < 0 ? "" : key.slice(i + 1).replace(/:$/, ""), e.clientX, e.clientY);
}, true);
$("#view").addEventListener("click", e => {
  const b = e.target.closest("[data-lplmenu]"); if (b) { const [k, id] = b.dataset.lplmenu.split("|"); const r = b.getBoundingClientRect(); linkedPlaylistMenu(k, id, r.left, r.bottom); return; }
  const u = e.target.closest("[data-unhide]"); if (u) unhidePl(u.dataset.unhide);
});

/* ---------------- updates from GitHub Releases ---------------- */
const UPD = { info: null, checking: false, current: "" };
async function checkUpdates(manual) {
  UPD.checking = true; if (manual) refreshAbout();
  try { UPD.info = await api("/api/update/check"); UPD.current = UPD.info.current; } catch (e) { UPD.info = { error: e.message }; }
  UPD.checking = false; refreshAbout();
  if (UPD.info?.newer) showUpdateBanner();
  else if (manual && UPD.info?.error !== "no repository set") toast(UPD.info?.error ? "Updates: " + UPD.info.error : "You have the newest version");
}
function refreshAbout() { const c = nav.stack[nav.idx]; if (c?.view === "settings" && (c.arg || "") === "about") render(true); }
function showUpdateBanner() {
  if ($("#updBanner") || settings.updSkip === UPD.info.latest) return;
  const b = document.createElement("div"); b.id = "updBanner"; b.className = "upd-banner";
  b.innerHTML = `<b>Nagham ${esc(UPD.info.latest)} is ready</b><span>${esc((UPD.info.notes || "").split("\n")[0].slice(0, 90))}</span><button class="btn accent sm" data-updinstall>Update</button><button class="icon-btn" data-updlater title="Later">✕</button>`;
  document.body.appendChild(b);
}
async function installUpdate() {
  toast("Downloading the update…");
  $$("[data-updinstall]").forEach(b => { b.disabled = true; b.textContent = "Downloading…"; });
  try { const r = await api("/api/update/install", {}); toast(`Installing ${r.version} — Nagham will reopen by itself`); }
  catch (e) { toast("Update failed: " + e.message); $$("[data-updinstall]").forEach(b => { b.disabled = false; b.textContent = "Update"; }); }
}
document.addEventListener("click", async e => {
  if (e.target.closest("[data-updcheck]")) return checkUpdates(true);
  if (e.target.closest("[data-updinstall]")) return installUpdate();
  if (e.target.closest("[data-updlater]")) { settings.updSkip = UPD.info?.latest; saveUser(); $("#updBanner")?.remove(); return; }
  if (e.target.closest("[data-updsave]")) { settings.updateRepo = $("#updRepo").value.trim(); saveUser(); setTimeout(() => checkUpdates(true), 400); }
});
setTimeout(() => checkUpdates(false), 8000);
setInterval(() => checkUpdates(false), 6 * 3600e3);
