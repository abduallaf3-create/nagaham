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
      <div class="set-row"><div class="lbl"><b>Run the welcome setup again</b><span>Name and theme</span></div><button class="btn ghost sm" data-onboard>Run setup</button></div>
    </div>`;
  },
  appearance() { return themesBody(); },
  library() {
    if (IOS) return `<div class="settings-sec"><h3>Music on this iPhone</h3>
      <p class="muted" style="margin:4px 0 10px">${lib.scanning ? `<b style="color:var(--text)">Scanning… ${lib.scanned} found</b>` : `${plural(lib.tracks.length, "song")} found.`}</p>
      <div class="ios-steps"><b>Add your own songs</b>
        <ol><li>Open the <b>Files</b> app</li><li>Go to <b>On My iPhone → Nagham → Music</b></li><li>Copy or move songs there (MP3, M4A, FLAC, WAV)</li><li>Come back and tap <b>Rescan</b></li></ol>
        <span class="muted" style="font-size:13px">From a computer: plug in the iPhone, open it in Finder / Apple Devices → Files → Nagham, and drag songs in.</span></div>
      <button class="btn accent sm" data-folder="rescan" style="margin-top:12px">Rescan</button>
    </div>` + this.libraryHidden();
    return `<div class="settings-sec"><h3>Music on this PC</h3>
      <p class="muted" style="margin:4px 0 0">Nagham scans these folders and everything inside them. ${lib.scanning ? `<b style="color:var(--text)">Scanning… ${lib.scanned} found</b>` : `${plural(lib.tracks.length, "song")} found.`}</p>
      <div class="folders">${lib.folders.map(f => `<div class="folder">${IC.folder}<span class="p" title="${esc(f)}">${esc(f)}</span><button class="btn ghost sm" data-folder="remove" data-path="${esc(f)}">Remove</button></div>`).join("") || `<p class="muted">No folders yet.</p>`}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${lib.canPick ? `<button class="btn accent sm" data-folder="pick">Add a folder…</button>` : ""}<button class="btn ghost sm" data-folder="rescan">Rescan</button></div>
      <div class="field"><input class="input" id="pathIn" placeholder="…or paste a folder path, e.g. D:\\Music" spellcheck="false"><button class="btn sm" data-folder="add">Add</button></div>
    </div>` + this.libraryHidden();
  },
  libraryHidden() {
    if (!(settings.hiddenPl || []).length) return "";
    return `<div class="settings-sec"><h3>Hidden playlists</h3>
      <p class="muted" style="margin:4px 0 8px">Right-click any YouTube or Spotify playlist (or Liked music / Saved songs) and choose <b>Hide from Nagham</b>. Hidden ones are listed here.</p>
      ${(settings.hiddenPl || []).map(h => `<div class="folder"><span class="p">${esc(h.name)} <span class="muted" style="font-size:12px">· ${h.key.startsWith("yt") ? "YouTube Music" : "Spotify"}</span></span><button class="btn ghost sm" data-unhide="${esc(h.key)}">Show again</button></div>`).join("") || `<p class="muted">Nothing hidden.</p>`}
    </div>`;
  },
  accounts() {
    return IOS ? "" : `<div class="settings-sec"><h3>Discord</h3><div class="acct-list">${discordCard()}</div></div>`;
  },
  playback() {
    return `<div class="settings-sec"><h3>Playback</h3>
      <div class="set-row"><div class="lbl"><b>Your country</b><span>Used for "Top songs" on the home page and for search</span></div>
        <select class="input" id="countrySel" style="flex:0 0 200px">${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${settings.country === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="set-row"><div class="lbl"><b>Nagham's own player for online songs</b><span>Nagham gets the song's sound itself and keeps it for instant replay — no ads, much lighter on your PC. Off: songs play through a hidden YouTube Music page.</span></div>
        <div class="seg" data-ypplay>${[["on", "On"], ["off", "Off"]].map(([v, l]) => `<button data-v="${v}" class="${(settings.ytdlpPlay === false ? "off" : "on") === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="set-row"><div class="lbl"><b>Songs YouTube won't play inside Nagham</b><span>Many music videos are blocked by YouTube in other apps. Open them in full in a YouTube Music window, or skip them. (Nagham never plays 30-second clips.)</span></div>
        <div class="seg" data-elsewhere>${[["open", "Open in YouTube Music"], ["skip", "Skip"]].map(([v, l]) => `<button data-v="${v}" class="${(settings.elsewhere || "open") === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
${IOS ? "" : `      <div class="set-row"><div class="lbl"><b>YouTube Music window</b><span>Size and where it opens. Small is a compact player you can keep beside Nagham.</span></div>
        <div class="seg-stack">
          <div class="seg" data-ytmsize>${[["s", "Small"], ["m", "Medium"], ["l", "Large"]].map(([v, l]) => `<button data-v="${v}" class="${(settings.ytmSize || "l") === v ? "on" : ""}">${l}</button>`).join("")}</div>
          <div class="seg" data-ytmpos>${[["left", "Left"], ["center", "Center"], ["right", "Right"]].map(([v, l]) => `<button data-v="${v}" class="${(settings.ytmPos || "right") === v ? "on" : ""}">${l}</button>`).join("")}</div>
          ${EXT.url ? '<button class="btn ghost sm" data-ytmapply>Apply to the open window</button>' : ""}
        </div></div>
      <div class="set-row"><div class="lbl"><b>Video box inside Nagham</b><span>Drag its top bar to move it, drag the corner to resize, ▣ to switch size. Double-click the bar to put it back.</span></div><button class="btn ghost sm" data-minireset>Reset position</button></div>
`}      <div class="set-row"><div class="lbl"><b>Open a code from a friend</b><span>Songs, playlists and themes — or just press Ctrl+V anywhere</span></div><button class="btn ghost sm" data-opencode>Enter code</button></div>
    </div>
${IOS ? "" : `    <div class="settings-sec"><h3>Window</h3>
      <div class="set-row"><div class="lbl"><b>Window style</b><span>Themed: the title bar takes your theme's colours (Windows 11). Classic: a standard Edge window. Applies next time you open Nagham.</span></div>
        <div class="seg" data-winmode><button data-v="themed" class="${settings.windowMode !== "classic" ? "on" : ""}">Themed</button><button data-v="classic" class="${settings.windowMode === "classic" ? "on" : ""}">Classic</button></div></div>
    </div>`}`;
  },
  shortcuts() {
    const sw = (id, on) => `<label class="switch"><input type="checkbox" data-kbd="${id}" ${on ? "checked" : ""}><i></i></label>`;
    const master = settings.kbd !== false;
    return `<div class="settings-sec"><h3>Keyboard shortcuts</h3>
      <div class="set-row"><div class="lbl"><b>Use keyboard shortcuts</b><span>Turn them all off if keys get in your way (Esc always works)</span></div>${sw("*", master)}</div>
      <div style="${master ? "" : "opacity:.45;pointer-events:none"}">${KBD_GROUPS.map(([id, keys, what]) => `<div class="set-row"><div class="lbl"><b>${what}</b><span><kbd>${keys.replace(/ · /g, "</kbd> <kbd>").replace(/ \+ /g, "</kbd> + <kbd>")}</kbd></span></div>${sw(id, !(settings.kbdOff && settings.kbdOff[id]))}</div>`).join("")}</div>
      <div class="set-row"><div class="lbl"><b>Esc</b><span>Closes menus, windows and the full-screen player — always on</span></div></div>
      <div class="set-row"><div class="lbl"><b>Ctrl + V</b><span>Open a code you copied from a friend</span></div></div>
    </div>`;
  },
  about() {
    return `<div class="settings-sec about"><img src="icon.svg" alt="" class="about-logo"><h3 style="font-size:24px">Nagham <span class="muted" style="font-size:14px">${esc(UPD.current || "3.5")}</span></h3>
      <p class="muted">Everything Nagham needs comes inside the app — no Python or other downloads.</p>
${IOS ? `<div class="set-row"><div class="lbl"><b>Updates</b><span>${IOSUPD.latest && IOSUPD.newer ? `Version ${esc(IOSUPD.latest)} is out — open <b>SideStore</b> → My Apps and tap <b>Update</b> next to Nagham (your songs and settings stay)` : IOSUPD.latest ? `You have the newest version (${esc(UPD.current)})` : "New versions arrive in SideStore: open it → My Apps and tap Update next to Nagham"}</span></div><button class="btn ghost sm" data-iosupd>Check</button></div>` : `      <div class="set-row"><div class="lbl"><b>Updates</b><span>${UPD.checking ? "Checking GitHub…" : UPD.info?.newer ? `Version ${esc(UPD.info.latest)} is available` : UPD.info?.error ? (UPD.info.error === "no repository set" ? "Add your GitHub repository below to get updates" : esc(UPD.info.error)) : UPD.info?.latest ? `You have the newest version (${esc(UPD.info.current)})` : "New versions come from GitHub Releases"}</span></div>
        ${UPD.info?.newer ? `<button class="btn accent sm" data-updinstall>Update now</button>` : `<button class="btn ghost sm" data-updcheck>Check for updates</button>`}</div>
      <div class="set-row"><div class="lbl"><b>GitHub repository</b><span>Where new versions are published, like <code>yourname/Nagham</code></span></div>
        <div class="field" style="margin:0;max-width:300px"><input class="input" id="updRepo" placeholder="owner/Nagham" spellcheck="false" value="${esc(settings.updateRepo || UPD.info?.repo || "")}"><button class="btn sm ghost" data-updsave>Save</button></div></div>
`}
      ${backupRows()}
      <div class="set-row"><div class="lbl"><b>Your data</b><span>Playlists, likes and themes are stored only on this ${IOS ? "iPhone" : "computer, in %APPDATA%\\Nagham"}</span></div></div>
      <div class="set-row"><div class="lbl"><b>Song catalogue</b><span>Song info and charts: Deezer & Apple Music. Free full songs: Audius.</span></div></div>
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
$("#view").addEventListener("click", e => { const b = e.target.closest("[data-ypplay] button"); if (b) { settings.ytdlpPlay = b.dataset.v !== "off"; saveUser(); render(true); toast(settings.ytdlpPlay ? "Online songs play in Nagham's own player" : "Online songs play through YouTube Music"); } });
$("#view").addEventListener("change", e => {
  const kb = e.target.dataset?.kbd;
  if (kb) {
    if (kb === "*") { settings.kbd = e.target.checked; saveUser(); toast(settings.kbd ? "Keyboard shortcuts: on" : "Keyboard shortcuts: off"); render(true); return; }
    settings.kbdOff = { ...(settings.kbdOff || {}), [kb]: !e.target.checked }; saveUser(); return;
  }
  if (e.target.id === "swYtFull") { settings.ytFull = e.target.checked; saveUser(); toast(settings.ytFull ? "Full songs from YouTube: on" : "Full songs from YouTube: off"); } });
$("#view").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "nameIn") $("[data-savename]")?.click(); });

function linkedPlaylistTiles() { return ""; } // (linked accounts were removed)

/* the round "you" button in the top bar */
function renderMe() {
  const b = $("#meBtn"); if (!b) return;
  const n = settings.userName || "";
  b.innerHTML = `<span class="me-av">${esc((n || "♪").slice(0, 1).toUpperCase())}</span><span class="lbl">${esc(n || "You")}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>`;
}
$("#meBtn").onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();
  menu(r.right - 240, r.bottom + 8, [
    { label: "Friends", icon: IC.person, act: () => go("friends") },
    { label: "Karaoke", icon: IC.mic || IC.person, act: () => go("sing") },
    { label: "What's new", icon: IC.info || IC.person, act: () => showWhatsNew() },
    { label: "Report a problem", icon: IC.info || IC.person, act: () => copyReport() },
    { label: "Enter a code from a friend", icon: IC.share, act: () => openCodeDialog() },
    { label: (settings.dynamic ? "✓ " : "") + "Colours follow the song", icon: IC.palette, act: () => setDynamic(!settings.dynamic) },
    { label: "Themes", icon: IC.palette, act: () => go("settings", "appearance") },
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

/* backups of playlists, likes, follows and settings */
const BK = { list: null, busy: false };
function backupLoad() { api("/api/backup").then(r => { BK.list = r.backups || []; BK.dir = r.dir; if (!UPD.current && r.app) UPD.current = r.app; if (nav.stack[nav.idx]?.view === "settings") render(true); }).catch(() => {}); }
function backupRows() {
  if (!BK.list) { backupLoad(); BK.list = []; }
  const fmtAt = ms => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const where = IOS ? "Files app → On My iPhone → Nagham → Backups" : esc(BK.dir || "");
  return `<div class="set-row"><div class="lbl"><b>Backups</b><span>Your playlists, likes, artists you follow and settings. One is made every day by itself (the last 10 are kept). Saved in ${where}</span></div><button class="btn accent sm" data-bknow ${BK.busy ? "disabled" : ""}>Back up now</button></div>`
    + (BK.list.length ? `<div class="bk-list">${BK.list.slice(0, 12).map(b => `<div class="bk-row"><span>${fmtAt(b.at)} <span class="muted">${b.name.includes("-auto") ? "automatic" : b.name.includes("before-restore") ? "before a restore" : "made by you"} • ${Math.max(1, Math.round(b.size / 1024))} KB</span></span><button class="btn ghost sm" data-bkrestore="${esc(b.name)}">Restore</button></div>`).join("")}</div>` : "");
}
document.addEventListener("click", async e => {
  if (e.target.closest("[data-bknow]")) {
    BK.busy = true; render(true);
    try { await api("/api/backup", {}); toast("Backup saved ✓"); } catch (err) { toast("Couldn't back up: " + err.message); }
    BK.busy = false; backupLoad();
  }
  const r = e.target.closest("[data-bkrestore]");
  if (r) {
    if (!confirm("Put back your playlists, likes, follows and settings from this backup? What you have now is backed up first, so you can undo it.")) return;
    try { await api("/api/backup", { restore: r.dataset.bkrestore }); toast("Restored — reloading…"); setTimeout(() => location.reload(), 900); }
    catch (err) { toast("Couldn't restore: " + err.message); }
  }
  if (e.target.closest("[data-iosupd]")) { await iosUpdCheck(true); render(true); }
});

/* iPhone: is there a newer version in SideStore? (the app's source list on GitHub) */
const IOSUPD = { latest: "", newer: false };
const IOS_SOURCE = "https://raw.githubusercontent.com/abduallaf3-create/nagaham/main/ios/source.json";
function verNewer(a, b) { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
async function iosUpdCheck(manual) {
  try {
    const j = await (await fetch(IOS_SOURCE + "?t=" + Date.now(), { cache: "no-store" })).json();
    const v = j.apps?.[0]?.version || j.apps?.[0]?.versions?.[0]?.version || "";
    if (!UPD.current) { try { UPD.current = (await api("/api/update/check")).current || ""; } catch {} }
    IOSUPD.latest = v; IOSUPD.newer = !!(v && UPD.current && verNewer(v, UPD.current));
    if (IOSUPD.newer && !manual && settings.iosUpdSeen !== v) { settings.iosUpdSeen = v; saveUser(); toast(`Nagham ${v} is out — open SideStore and tap Update`); }
    else if (manual) toast(IOSUPD.newer ? `Version ${v} is out — open SideStore → My Apps → Update` : "You have the newest version");
  } catch (err) { if (manual) toast("Couldn't check: " + err.message); }
}
if (IOS) setTimeout(() => iosUpdCheck(false), 8000);
async function checkUpdates(manual) {
  if (IOS) return;
  UPD.checking = true; if (manual) refreshAbout();
  try { UPD.info = await api("/api/update/check"); UPD.current = UPD.info.current; } catch (e) { UPD.info = { error: e.message }; }
  UPD.checking = false; refreshAbout();
  if (UPD.current) { // just updated? say so once
    if (settings.lastVersion && newerVer(UPD.current, settings.lastVersion)) updComplete(UPD.current, settings.lastVersion);
    if (settings.lastVersion !== UPD.current) { settings.lastVersion = UPD.current; saveUser(); }
  }
  if (UPD.info?.newer) showUpdateBanner();
  else if (manual && UPD.info?.error !== "no repository set") toast(UPD.info?.error ? "Updates: " + UPD.info.error : "You have the newest version");
}
function newerVer(a, b) { const p = v => String(v).split(".").map(n => parseInt(n) || 0); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; }
function refreshAbout() { const c = nav.stack[nav.idx]; if (c?.view === "settings" && (c.arg || "") === "about") render(true); }
function showUpdateBanner() {
  if ($("#updBanner") || settings.updSkip === UPD.info.latest) return;
  const b = document.createElement("div"); b.id = "updBanner"; b.className = "upd-banner";
  b.innerHTML = `<b>Nagham ${esc(UPD.info.latest)} is ready</b><span>${esc((UPD.info.notes || "").split("\n")[0].slice(0, 90))}</span><button class="btn accent sm" data-updinstall>Update</button><button class="icon-btn" data-updlater title="Later">✕</button>`;
  document.body.appendChild(b);
}
/* full-screen animation while updating, and "Update complete" after */
function updOverlay(html, cls = "") {
  let o = $("#updOverlay");
  if (!o) { o = document.createElement("div"); o.id = "updOverlay"; document.body.appendChild(o); requestAnimationFrame(() => o.classList.add("show")); }
  o.className = "upd-overlay show " + cls;
  o.innerHTML = `<div class="upd-card">${html}</div>`;
  return o;
}
const UPD_RING = pct => `<div class="upd-ring" style="--p:${pct}"><img src="icon.svg" alt=""><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" class="bg"/><circle cx="60" cy="60" r="54" class="fg" pathLength="100" stroke-dasharray="${pct} 100"/></svg></div>`;
async function installUpdate() {
  $("#updBanner")?.remove();
  const ver = UPD.info?.latest || "";
  updOverlay(`${UPD_RING(0)}<h2>Updating Nagham</h2><p>Getting version ${esc(ver)}…</p><div class="upd-bar"><i style="width:0%"></i></div>`);
  try { await api("/api/update/install", {}); }
  catch (e) { return updFailed(e.message); }
  const poll = setInterval(async () => {
    let p; try { p = await api("/api/update/progress"); } catch { return; } // the app is being closed by the installer
    const o = $("#updOverlay"); if (!o || !$(".upd-ring", o)) return clearInterval(poll);
    if (p.stage === "download") {
      $(".upd-ring", o).outerHTML = UPD_RING(p.pct || 0);
      $("p", o).textContent = `Downloading ${p.version} — ${p.pct || 0}%`;
      $(".upd-bar i", o).style.width = (p.pct || 0) + "%";
    } else if (p.stage === "install") {
      o.classList.add("installing");
      $(".upd-ring", o).outerHTML = UPD_RING(100);
      $("h2", o).textContent = "Installing…";
      $("p", o).textContent = "Nagham will close and open again by itself in a few seconds";
      $(".upd-bar i", o).style.width = "100%";
    } else if (p.stage === "error") { clearInterval(poll); updFailed(p.error); }
  }, 400);
}
function updFailed(msg) {
  const page = UPD.info?.page;
  updOverlay(`<div class="upd-x">!</div><h2>Update didn't finish</h2><p>${esc(msg || "Something went wrong")}</p>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:18px">${page ? `<a class="btn accent" href="${esc(page)}" target="_blank">Open download page</a>` : ""}<button class="btn ghost" data-updclose>Close</button></div>`, "err");
}
function updComplete(ver, from) {
  const notes = typeof whatsNewHTML === "function" ? whatsNewHTML(from, ver) : "";
  const o = updOverlay(`<div class="upd-done"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div><h2>Update complete</h2><p>You're on Nagham ${esc(ver)}${notes ? " — what's new:" : ""}</p>${notes}<button class="btn accent" data-updclose style="margin-top:18px">Let's go</button>`, "done");
  if (settings.effects !== false) confettiBurst(o);
  if (!notes) setTimeout(() => { if ($("#updOverlay.done")) closeUpdOverlay(); }, 6000); // with notes: stays until you close it
}
function closeUpdOverlay() { const o = $("#updOverlay"); if (!o) return; o.classList.remove("show"); setTimeout(() => o.remove(), 350); }
function confettiBurst(host) {
  const cols = ["var(--accent)", "#ffd166", "#06d6a0", "#ef476f", "#4cc9f0", "#fff"];
  for (let i = 0; i < 46; i++) {
    const c = document.createElement("i"); c.className = "confetti";
    const ang = Math.random() * Math.PI * 2, dist = 140 + Math.random() * 260;
    c.style.cssText = `--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist - 80}px;--r:${Math.random() * 720 - 360}deg;background:${cols[i % cols.length]};animation-delay:${Math.random() * 120}ms`;
    host.appendChild(c); setTimeout(() => c.remove(), 1800);
  }
}
document.addEventListener("click", async e => {
  if (e.target.closest("[data-updcheck]")) return checkUpdates(true);
  if (e.target.closest("[data-updinstall]")) return installUpdate();
  if (e.target.closest("[data-updclose]")) return closeUpdOverlay();
  if (e.target.closest("[data-updlater]")) { settings.updSkip = UPD.info?.latest; saveUser(); $("#updBanner")?.remove(); return; }
  if (e.target.closest("[data-updsave]")) { settings.updateRepo = $("#updRepo").value.trim(); saveUser(); setTimeout(() => checkUpdates(true), 400); }
});
setTimeout(() => checkUpdates(false), 4000);
setInterval(() => checkUpdates(false), 6 * 3600e3);

/* a short report (version, tools, recent log lines) on the clipboard, to send to whoever helps */
async function copyReport() {
  try {
    const t = await (await fetch("/api/report")).text();
    await navigator.clipboard.writeText(t);
    toast("Problem report copied — paste it in a message to whoever helps you");
  } catch (e) { toast("Couldn't make the report: " + (e.message || e)); }
}
document.addEventListener("click", e => { if (e.target.closest("[data-report]")) { e.stopPropagation(); copyReport(); } });
(() => { const st = document.createElement("style"); st.textContent = `.dl-rep{border:0;background:rgba(127,127,127,.18);color:inherit;font:inherit;font-size:12px;padding:2px 9px;border-radius:999px;cursor:pointer;margin-inline-start:6px}.dl-rep:hover{background:var(--accent);color:var(--on-accent)}`; document.head.appendChild(st); })();
