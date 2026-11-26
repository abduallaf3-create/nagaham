"use strict";
/* Nagham – share codes for songs, playlists and themes */

const b64u = {
  enc: bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); },
};
async function squeeze(obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const cs = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64u.enc(new Uint8Array(await new Response(cs).arrayBuffer()));
}
async function unsqueeze(s) {
  const ds = new Blob([b64u.dec(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(ds).text());
}

/* a reference to a song that works on someone else's computer */
function songRef(id) {
  const t = T(id); if (!t) return null;
  if (t.spotify || t.youtube) return [t.title, t.artist.split(",")[0], id];
  return t.online ? id : [t.title, t.artist === "Unknown artist" ? "" : t.artist];
}
async function songCode(id) {
  const t = T(id);
  if (t?.online && !t.spotify) { const [s, r] = id.split(/:(.*)/s); return `NGM-${s}-${r}`; }
  return "NGM1.s." + await squeeze(songRef(id));
}
async function playlistCode(name, ids) {
  return "NGM1.p." + await squeeze({ n: name, t: ids.filter(id => !isPrivate(id)).map(songRef).filter(Boolean).slice(0, 500) });
}
async function themeCode(th) {
  const { id, image, _new, ...rest } = th;
  return "NGM1.t." + await squeeze(rest);
}

function shareDialog(title, sub, code, cardHTML, note) {
  modal(`<h3>${esc(title)}</h3><p class="muted">${sub}</p>${cardHTML || ""}
    <div class="code-box"><code>${esc(code)}</code></div>
    <p class="muted" style="font-size:13px;margin:6px 0 0">${note || "Send this code to your friends. They open Nagham, click <b>Enter code</b> and paste it."}</p>
    <div class="row-gap"><button class="btn ghost cancel">Close</button><button class="btn accent ok">${IC.copy}Copy code</button></div>`, () => { copyText(code, "Code copied — paste it to your friends"); return true; });
}
async function shareSong(id) {
  const t = T(id); if (!t) return;
  const code = await songCode(id);
  shareDialog("Share song", "A code for this song:", code,
    `<div class="share-card"><div class="art">${trackArt(id, true)}</div><div style="min-width:0"><b>${esc(t.title)}</b><span class="muted">${esc(t.artist)}</span></div></div>`,
    t.online ? undefined : "This song is on your PC, so your friend's Nagham will find the same song in their library or online.");
}
async function sharePlaylist(name, ids) {
  ids = ids.filter(id => T(id));
  if (!ids.length) return toast("Add some songs first");
  const code = await playlistCode(name, ids);
  shareDialog("Share playlist", `${esc(name)} • ${plural(ids.length, "song")}`, code);
}
async function shareTheme(th) {
  const code = await themeCode(th);
  shareDialog("Share theme", esc(th.name), code, "", th.image ? "Background pictures aren't included in codes (they're too big) — everything else is." : undefined);
}

/* ---------------- decoding ---------------- */
function parseLink(s) {
  let m;
  if ((m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i))) return { type: "yt", vid: m[1] };
  if ((m = s.match(/deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i))) return { type: "s", ref: "dz:" + m[1] };
  if ((m = s.match(/music\.apple\.com\/.*[?&]i=(\d+)/i))) return { type: "s", ref: "it:" + m[1] };
  if ((m = s.match(/deezer\.com\/(?:[a-z]{2}\/)?album\/(\d+)/i))) return { type: "album", id: "dz:" + m[1] };
  return null;
}
async function decodeCode(raw) {
  const s = raw.trim().replace(/\s+/g, "");
  let m;
  if ((m = s.match(/^NGM-(dz|it|au)-([A-Za-z0-9_-]+)$/i))) return { type: "s", ref: m[1].toLowerCase() + ":" + m[2] };
  if ((m = s.match(/^NGM1\.([sptkf])\.([A-Za-z0-9_-]+)$/))) {
    const data = await unsqueeze(m[2]);
    if (m[1] === "s") return { type: "s", ref: data };
    if (m[1] === "p") return { type: "p", name: data.n, refs: data.t || [] };
    if (m[1] === "t") return { type: "t", theme: data };
    if (m[1] === "f") return { type: "f", data };
    if (m[1] === "k") return { type: "k", id: data.i, secret: data.s };
  }
  const link = parseLink(raw.trim());
  if (link) return link;
  throw new Error("That doesn't look like a Nagham code");
}
const norm = s => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
async function resolveRef(ref) {
  if (typeof ref === "string") return (await fetchOnlineTrack(ref).catch(() => null))?.id || null;
  const [title, artist, spId] = ref;
  if (spId && spId.startsWith("yt:")) { const v = spId.slice(3); return registerOnline([{ id: spId, src: "yt", youtube: true, online: true, title, artist: artist || "", album: "", cover: `https://i.ytimg.com/vi/${v}/hqdefault.jpg`, duration: 0 }])[0]; }
  const local = lib.tracks.find(t => norm(t.title) === norm(title) && (!artist || norm(t.artist) === norm(artist)))
    || lib.tracks.find(t => norm(t.title) === norm(title));
  if (local) return local.id;
  return (await findOnline(title, artist).catch(() => null))?.id || null;
}

function openCodeDialog(prefill = "") {
  modal(`<h3>Enter a code</h3><p class="muted">Paste a song, playlist, theme or key code from a friend — or a YouTube, Deezer or Apple Music link.</p>
    <textarea class="input" id="codeIn" placeholder="NGM-…" spellcheck="false">${esc(prefill)}</textarea>
    <div id="codeOut" style="min-height:8px"></div>
    <div class="row-gap"><button class="btn ghost cancel">Close</button><button class="btn accent" id="codeGo">Open</button></div>`, null, {
    onOpen(bg, done) {
      const out = $("#codeOut", bg);
      $("#codeGo", bg).onclick = async () => {
        const btn = $("#codeGo", bg); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Opening…';
        try {
          const c = await decodeCode($("#codeIn", bg).value);
          await handleCode(c, out, done);
        } catch (err) { out.innerHTML = `<p style="color:#ff6b81;margin:10px 0 0">${esc(err.message)}</p>`; }
        btn.disabled = false; btn.textContent = "Open";
      };
    },
  });
}
async function handleCode(c, out, done) {
  if (c.type === "s") {
    const id = await resolveRef(c.ref);
    if (!id) throw new Error("Couldn't find that song. Check your internet connection and try again.");
    const t = T(id);
    out.innerHTML = `<div class="share-card"><div class="art">${trackArt(id, true)}</div><div style="min-width:0;flex:1"><b>${esc(t.title)} ${badge(t)}</b><span class="muted">${esc(t.artist)}</span></div>
      <button class="btn sm ghost" id="cLike">${lib.liked.has(id) ? "Liked" : "Save to Liked"}</button><button class="btn sm accent" id="cPlay">${IC.play}Play</button></div>`;
    $("#cPlay", out).onclick = () => { playContext([id], 0, { type: "shared", id, name: "Shared with you" }); done(true); };
    $("#cLike", out).onclick = e => { if (!lib.liked.has(id)) toggleLike([id]); e.target.textContent = "Liked"; };
  } else if (c.type === "p") {
    out.innerHTML = `<p class="muted" style="margin:12px 0 0"><span class="spin" style="display:inline-block;vertical-align:-2px"></span> Finding ${plural(c.refs.length, "song")}…</p>`;
    const ids = []; let i = 0;
    const worker = async () => { while (i < c.refs.length) { const k = i++; const id = await resolveRef(c.refs[k]); if (id) ids[k] = id; } };
    await Promise.all(Array.from({ length: 4 }, worker));
    const found = ids.filter(Boolean);
    if (!found.length) throw new Error("Couldn't find any of these songs. Check your internet connection.");
    const p = { id: uid(), name: c.name || "Shared playlist", tracks: found, created: Date.now() };
    lib.playlists.push(p); saveUser(); done(true);
    toast(`Added “${p.name}” — ${plural(found.length, "song")}${found.length < c.refs.length ? ` (${c.refs.length - found.length} not found)` : ""}`);
    go("playlist", p.id);
  } else if (c.type === "t") {
    const th = { ...c.theme, id: "c" + uid(), name: c.theme.name || "Shared theme" };
    if (!th.accent || !th.bg1 || !th.bg2) throw new Error("This theme code is incomplete");
    settings.customThemes.push(th); settings.themeId = th.id; applyTheme(th); saveUser(); done(true);
    toast(`Theme “${th.name}” added and applied`);
    go("themes");
  } else if (c.type === "yt") {
    await playYouTubeLink(c.vid, out, done);
  } else if (c.type === "k") {
    done(true); toast("YouTube account linking isn't in Nagham any more — you don't need these keys");
  } else if (c.type === "f") {
    const r = addFriendFromCode(c.data); done(true);
    toast(r.updated ? `${r.f.name} updated` : `${r.f.name} added to Friends`); go("friend", r.f.id);
  } else if (c.type === "album") {
    done(true); go("oalbum", c.id);
  }
}
if ($("#codeBtn")) $("#codeBtn").onclick = () => openCodeDialog();
// paste a code anywhere (outside text boxes) to open it
addEventListener("paste", e => {
  if (e.target.matches("input,textarea")) return;
  const s = e.clipboardData?.getData("text") || "";
  if (/^\s*(NGM-|NGM1\.)/.test(s) || parseLink(s)) { e.preventDefault(); openCodeDialog(s.trim()); setTimeout(() => $("#codeGo")?.click(), 50); }
});
