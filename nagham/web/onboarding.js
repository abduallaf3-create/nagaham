"use strict";
/* Nagham – first-run welcome (name → theme → accounts) and the guided tour */

let obStep = 0;
const ob = { name: "", link: new Set() };

function startOnboarding() {
  obStep = 0; ob.name = settings.userName || ""; ob.link = new Set();
  const host = $("#onboard");
  host.className = "ob open";
  host.innerHTML = `<div class="ob-bg"><i></i><i></i><i></i></div>
    <button class="ob-skip" data-ob="skip">Skip setup</button>
    <div class="ob-card" id="obCard"></div>
    <div class="ob-dots">${[0, 1, 2, 3, 4].map(i => `<span data-d="${i}"></span>`).join("")}</div>`;
  obRender();
}
function obClose() {
  const host = $("#onboard");
  host.classList.add("closing");
  setTimeout(() => { host.className = "ob"; host.innerHTML = ""; }, 500);
}
function obRender(dir = 1) {
  const c = $("#obCard"); if (!c) return;
  $$(".ob-dots span").forEach((d, i) => d.classList.toggle("on", i <= obStep));
  const steps = [obWelcome, obName, obTheme, obAccounts, obDone];
  c.classList.remove("in-l", "in-r"); void c.offsetWidth;
  try { c.innerHTML = steps[obStep](); }
  catch (e) { postLog("onboarding step " + obStep + ": " + e.stack); obFinish(false); return; }
  c.classList.add(dir > 0 ? "in-r" : "in-l");
  setTimeout(() => $("#obName")?.focus(), 350);
}
function obNext() { obStep = Math.min(4, obStep + 1); obRender(1); }
function obBack() { obStep = Math.max(0, obStep - 1); obRender(-1); }

const obWave = () => `<div class="ob-wave">${Array.from({ length: 9 }, (_, i) => `<i style="--d:${(i * 0.11).toFixed(2)}s"></i>`).join("")}</div>`;
function obWelcome() {
  return `<div class="ob-center">
    <img src="icon.svg" class="ob-logo" alt="">
    ${obWave()}
    <h1 class="ob-title">Welcome to <span class="ob-grad">Nagham</span></h1>
    <p class="ob-sub">نغم — your music, your way.<br>Let's set things up. It takes less than a minute.</p>
    <button class="btn accent ob-go" data-ob="next">Let's go ${IC.arrow.replace("<svg", '<svg width="18" height="18"')}</button>
  </div>`;
}
function obName() {
  return `<div class="ob-center">
    <div class="ob-emoji">👋</div>
    <h1 class="ob-title">What should we call you?</h1>
    <p class="ob-sub">We'll use it to greet you.</p>
    <input class="input ob-input" id="obName" maxlength="30" placeholder="Your name" value="${esc(ob.name)}" autocomplete="off">
    <div class="ob-actions"><button class="btn ghost" data-ob="back">Back</button><button class="btn accent" data-ob="name">Continue</button></div>
  </div>`;
}
function obTheme() {
  return `<div class="ob-center wide">
    <h1 class="ob-title">Pick your look${ob.name ? ", " + esc(ob.name) : ""}</h1>
    <p class="ob-sub">Tap a theme to try it. You can change everything later in Settings → Appearance.</p>
    <div class="ob-themes">${BUILTIN_THEMES.map((t, i) => `<div class="theme-card ob-tc ${settings.themeId === t.id ? "on" : ""}" data-obtheme="${t.id}" style="--i:${i}">${themePreview(t)}<div class="check">${IC.check}</div><div class="tc-info"><span>${esc(t.name)}</span></div></div>`).join("")}</div>
    <label class="ob-switch"><label class="switch"><input type="checkbox" id="obDyn" ${settings.dynamic ? "checked" : ""}><i></i></label><span><b>Colours follow the song</b><br><span class="muted">The app takes the colours of each song's cover</span></span></label>
    <div class="ob-actions"><button class="btn ghost" data-ob="back">Back</button><button class="btn accent" data-ob="next">Continue</button></div>
  </div>`;
}
function obAccounts() {
  const card = (k, logo, cls, title, text) => `<button class="ob-acct ${ob.link.has(k) ? "on" : ""}" data-oblink="${k}"><span class="acct-logo ${cls}">${logo}</span><span class="ob-acct-t"><b>${title}</b><span>${text}</span></span><span class="ob-tick">${IC.check}</span></button>`;
  return `<div class="ob-center">
    <h1 class="ob-title">Link your music?</h1>
    <p class="ob-sub">Optional — Nagham works without it. Pick any you use and we'll walk you through linking after the tour.</p>
    <div class="ob-accts">
      ${card("yt", YT_LOGO, "yt", "YouTube Music", "Full songs from YouTube + your playlists")}
      ${card("sp", SP_LOGO, "sp", "Spotify", "Your Spotify playlists and saved songs")}
    </div>
    <div class="ob-actions"><button class="btn ghost" data-ob="back">Back</button><button class="btn accent" data-ob="next">${ob.link.size ? "Continue" : "Skip for now"}</button></div>
  </div>`;
}
function obDone() {
  setTimeout(confetti, 250);
  return `<div class="ob-center">
    <div class="ob-check">${IC.check}</div>
    <h1 class="ob-title">You're all set${ob.name ? ", " + esc(ob.name) : ""}!</h1>
    <p class="ob-sub">Want a quick tour of where everything is?</p>
    <div class="ob-actions"><button class="btn ghost" data-ob="finish">Start listening</button><button class="btn accent" data-ob="tour">Show me around</button></div>
  </div>`;
}
function obFinish(tour) {
  settings.onboarded = true;
  settings.userName = ob.name;
  settings.wantLink = [...ob.link];
  saveUser(); renderMe(); obClose();
  go("home", null, true);
  const after = () => { if (ob.link.size) { go("settings", "accounts"); setTimeout(() => { $$("details.acct").forEach((d, i) => { const isYt = d.innerHTML.includes("YouTube"); if ((isYt && ob.link.has("yt")) || (!isYt && ob.link.has("sp"))) d.open = true; }); }, 120); } };
  if (tour) setTimeout(() => startTour(after), 550); else after();
}
document.addEventListener("click", e => {
  if (!e.target.closest("#onboard")) return;
  const b = e.target.closest("[data-ob]");
  if (b) {
    const a = b.dataset.ob;
    if (a === "next") obNext();
    else if (a === "back") obBack();
    else if (a === "name") { ob.name = ($("#obName").value || "").trim(); obNext(); }
    else if (a === "finish" || a === "skip") obFinish(false);
    else if (a === "tour") obFinish(true);
    return;
  }
  const th = e.target.closest("[data-obtheme]");
  if (th) { useTheme(th.dataset.obtheme); $$("[data-obtheme]").forEach(c => c.classList.toggle("on", c.dataset.obtheme === settings.themeId)); return; }
  const lk = e.target.closest("[data-oblink]");
  if (lk) { const k = lk.dataset.oblink; ob.link.has(k) ? ob.link.delete(k) : ob.link.add(k); lk.classList.toggle("on", ob.link.has(k)); const nb = $('#obCard [data-ob="next"]'); if (nb) nb.textContent = ob.link.size ? "Continue" : "Skip for now"; }
});
document.addEventListener("change", e => { if (e.target.id === "obDyn") { settings.dynamic = e.target.checked; saveUser(); refreshDynamic(); } });
document.addEventListener("keydown", e => {
  if (!$("#onboard.open")) return;
  if (e.key === "Escape") { obFinish(false); return; }
  if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); const p = $('#obCard [data-ob="name"]') || $('#obCard .btn.accent'); p?.click(); }
}, true);

/* confetti burst */
function confetti() {
  const c = document.createElement("canvas"); c.className = "confetti"; document.body.appendChild(c);
  const x = c.getContext("2d"), dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#a970ff";
  const cols = [accent, "#ffd166", "#ff6b9a", "#5eead4", "#ffffff", "#a78bfa"];
  const ps = Array.from({ length: 160 }, () => ({ x: c.width / 2, y: c.height * .42, vx: (Math.random() - .5) * 26 * dpr, vy: (-Math.random() * 22 - 6) * dpr, s: (4 + Math.random() * 6) * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[Math.floor(Math.random() * cols.length)] }));
  let t = 0;
  const tick = () => {
    x.clearRect(0, 0, c.width, c.height);
    for (const p of ps) { p.vy += .55 * dpr; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }
    if (++t < 160) requestAnimationFrame(tick); else c.remove();
  };
  tick();
}

/* ---------------- guided tour ---------------- */
const TOUR = [
  { sel: ".search", title: "Search anything", text: "Find any song, artist or album. Results from your PC and your linked accounts show up together." },
  { sel: '#side [data-nav="home"]', title: "Home", text: "Top songs in your country, new releases and what you played recently." },
  { sel: '#side [data-nav="library"]', title: "Your Library", text: "Your playlists, liked songs and the music on this PC — all in one place." },
  { sel: "#libList", title: "Quick access", text: "Your playlists live here. Drag songs onto one to add them." },
  { sel: "#player", title: "The player", text: "Play, skip, shuffle and repeat. Press F (or the ⤢ button) for the full-screen player." },
  { sel: "#meBtn", title: "Your menu", text: "Open a code from a friend, make colours follow the song, and jump to themes." },
  { sel: '#side [data-nav="settings"]', title: "Settings", text: "Everything else lives here: appearance, music folders, linked accounts and more." },
];
let tourI = 0, tourDone = null;
function startTour(done) {
  tourI = 0; tourDone = done || null;
  let o = $("#tour");
  if (!o) { o = document.createElement("div"); o.id = "tour"; o.innerHTML = '<div class="tour-hole"></div><div class="tour-tip"></div>'; document.body.appendChild(o); }
  o.classList.add("on");
  tourShow();
}
function tourEnd() { $("#tour")?.classList.remove("on"); const d = tourDone; tourDone = null; d?.(); }
function tourShow() {
  const step = TOUR[tourI], el = $(step.sel);
  if (!el || !el.offsetParent) { if (tourI < TOUR.length - 1) { tourI++; return tourShow(); } return tourEnd(); }
  const z = parseFloat(document.body.style.zoom) || 1;
  const r = el.getBoundingClientRect(), pad = 8;
  const hole = $("#tour .tour-hole"), tip = $("#tour .tour-tip");
  Object.assign(hole.style, { left: (r.left - pad) / z + "px", top: (r.top - pad) / z + "px", width: (r.width + pad * 2) / z + "px", height: (r.height + pad * 2) / z + "px" });
  tip.innerHTML = `<div class="tour-n">${tourI + 1} / ${TOUR.length}</div><b>${step.title}</b><p>${step.text}</p>
    <div class="tour-actions"><button class="btn ghost sm" data-tour-act="skip">Skip</button><span style="flex:1"></span>${tourI ? '<button class="btn ghost sm" data-tour-act="back">Back</button>' : ""}<button class="btn accent sm" data-tour-act="next">${tourI === TOUR.length - 1 ? "Done" : "Next"}</button></div>`;
  tip.classList.remove("pop"); void tip.offsetWidth; tip.classList.add("pop");
  const tw = 320 * z, th = tip.offsetHeight * z || 170;
  let left = r.right + 18, top = r.top;
  if (left + tw > innerWidth - 12) left = r.left - tw - 18;
  if (left < 12) { left = Math.min(Math.max(12, r.left), innerWidth - tw - 12); top = r.bottom + 18; if (top + th > innerHeight - 12) top = r.top - th - 18; }
  top = Math.max(12, Math.min(top, innerHeight - th - 12));
  Object.assign(tip.style, { left: left / z + "px", top: top / z + "px" });
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-tour-act]"); if (!b) return;
  const a = b.dataset.tourAct;
  if (a === "skip") return tourEnd();
  if (a === "back") { tourI = Math.max(0, tourI - 1); return tourShow(); }
  if (tourI >= TOUR.length - 1) return tourEnd();
  tourI++; tourShow();
});
addEventListener("resize", () => { if ($("#tour.on")) tourShow(); });
