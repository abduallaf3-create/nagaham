"use strict";
/* Nagham – show what you're listening to on Discord (Rich Presence) */

const DC = { loaded: false, enabled: false, appId: "", connected: false, user: "", error: "" };
const DC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v11H9l-5 4z"/><circle cx="9" cy="10.5" r="1.2" fill="currentColor"/><circle cx="15" cy="10.5" r="1.2" fill="currentColor"/></svg>';

async function dcRefresh() { try { Object.assign(DC, await api("/api/discord/status"), { loaded: true }); } catch { DC.loaded = true; } return DC; }

function discordCard() {
  const d = DC;
  const status = d.enabled ? (d.connected ? `<span style="color:#5eead4">● Showing on Discord${d.user ? " as " + esc(d.user) : ""}</span>` : `<span style="color:#ffb86b">● ${esc(d.error || "Waiting for Discord to open…")}</span>`) : "Off";
  const step = (n, title, body) => `<div class="sp-step"><div class="sp-num">${n}</div><div style="min-width:0;flex:1"><b>${title}</b><div class="muted" style="font-size:13.5px;margin-top:4px;line-height:1.55">${body}</div></div></div>`;
  return `<details class="acct" ${d.enabled && !d.connected ? "open" : ""}><summary><span class="acct-logo dc">${DC_ICON}</span><div class="lbl" style="flex:1"><b>Discord status</b><span>${d.enabled ? status : "Show “Listening to…” with the song on your Discord profile"}</span></div>
      <label class="switch" onclick="event.stopPropagation()"><input type="checkbox" id="dcOn" ${d.enabled ? "checked" : ""} ${d.appId ? "" : "disabled"}><i></i></label></summary>
    <div class="acct-body">
      ${step(1, "Create a Discord app (1 minute)", `<a class="btn sm ghost" href="https://discord.com/developers/applications" target="_blank">Open Discord Developer Portal ↗</a> &nbsp;→ <b>New Application</b> → name it <b>Nagham</b> (this name shows as “Listening to <b>Nagham</b>”).`)}
      ${step(2, "Paste the Application ID", `On the app's <b>General Information</b> page, copy <b>Application ID</b> (a long number). It's not a secret.
        <div class="field"><input class="input" id="dcAppId" placeholder="e.g. 1234567890123456789" value="${esc(d.appId)}" spellcheck="false" maxlength="22"><button class="btn sm accent" data-dcsave>${d.appId ? "Update" : "Save"}</button></div>`)}
      ${step(3, "Turn it on", `Flip the switch above. Keep the Discord app open on this PC. Optional: in your Discord app's <b>Rich Presence → Art Assets</b> upload a picture named <b>nagham</b> — it's shown for songs from your PC.`)}
      <div class="set-row" style="border-top:1px solid var(--line);margin-top:6px"><div class="lbl"><b>Show when paused</b><span>Otherwise your status clears while music is paused</span></div><label class="switch"><input type="checkbox" id="dcPaused" ${settings.dcShowPaused ? "checked" : ""}><i></i></label></div>
    </div></details>`;
}

$("#view").addEventListener("click", async e => {
  if (!e.target.closest("[data-dcsave]")) return;
  try { const r = await api("/api/discord/config", { appId: $("#dcAppId").value.trim(), enabled: true }); await dcRefresh(); toast(r.connected ? "Discord connected" : "Saved — " + (DC.error || "open Discord")); render(true); discordUpdate(true); }
  catch (err) { toast(err.message); }
});
$("#view").addEventListener("change", async e => {
  if (e.target.id === "dcOn") { await api("/api/discord/config", { enabled: e.target.checked }).catch(err => toast(err.message)); await dcRefresh(); render(true); discordUpdate(true); }
  if (e.target.id === "dcPaused") { settings.dcShowPaused = e.target.checked; saveUser(); discordUpdate(true); }
});

/* keep Discord in sync with the player */
let dcSent = "", dcT = 0;
function discordUpdate(force) {
  if (!DC.enabled) return;
  clearTimeout(dcT);
  dcT = setTimeout(() => {
    const t = T(P.current);
    let body;
    if (!t || (E.paused && !settings.dcShowPaused)) body = { clear: true };
    else {
      const dur = E.duration || t.duration || 0, pos = E.time || 0, now = Date.now();
      const cover = t.online ? (t.cover || t.coverSmall || "") : "";
      const url = t.youtube ? "https://music.youtube.com/watch?v=" + t.id.slice(3) : t.spotify ? "https://open.spotify.com/track/" + t.id.slice(3) : "";
      body = { title: t.title, artist: t.artist, album: t.album || "", cover, url, paused: E.paused, start: E.paused ? 0 : Math.round(now - pos * 1000), end: E.paused || !dur ? 0 : Math.round(now + (dur - pos) * 1000) };
    }
    const sig = JSON.stringify({ ...body, start: Math.round((body.start || 0) / 3000), end: Math.round((body.end || 0) / 3000) });
    if (!force && sig === dcSent) return;
    dcSent = sig;
    fetch("/api/discord/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  }, 400);
}
setInterval(() => discordUpdate(false), 15000);
dcRefresh().then(() => discordUpdate(true));
