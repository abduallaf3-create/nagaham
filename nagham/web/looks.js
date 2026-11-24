"use strict";
/* Nagham – look & feel: quick customisation on top of any theme, live preview, reset / restore,
   and the body attributes (card style, icons, transitions, playing animation, player design) the CSS reads. */

const LOOK_CHOICES = [
  ["card", "Card style", [["soft", "Soft"], ["flat", "Flat"], ["outline", "Outline"], ["glass", "Glass"], ["raised", "Raised"]]],
  ["coverShape", "Cover shape", [["rounded", "Rounded"], ["square", "Square"], ["circle", "Circle"]]],
  ["icons", "Icon style", [["normal", "Normal"], ["thin", "Thin"], ["bold", "Bold"], ["sharp", "Sharp"]]],
  ["pg", "Page transition", [["fade", "Fade"], ["slide", "Slide"], ["zoom", "Zoom"], ["none", "None"]]],
  ["pa", "Playing animation", [["default", "Breathe"], ["pulse", "Pulse"], ["bars", "Equaliser"], ["glow", "Glow"], ["none", "None"]]],
  ["ps", "Player bar design", [["bar", "Classic"], ["big", "Big cover"], ["simple", "Simple"], ["blur", "Blurred cover"]]],
  ["glow", "Button glow", [["", "Off"], ["1", "On"]]],
  ["player", "Player position", [["floating", "Floating"], ["docked", "Docked"]]],
  ["sidebar", "Sidebar", [["slim", "Slim"], ["normal", "Normal"], ["wide", "Wide"]]],
  ["tileSize", "Cover size", [["s", "Small"], ["m", "Medium"], ["l", "Large"]]],
  ["density", "Song rows", [["comfortable", "Comfortable"], ["compact", "Compact"]]],
  ["gradient", "Gradient buttons", [["", "Off"], ["1", "On"]]],
];
const LOOK_COLORS = [
  ["accent", "Main colour"], ["accent2", "Second colour"], ["btn", "Buttons"], ["bg1", "Background top"], ["bg2", "Background bottom"],
  ["playerBg", "Player bar"], ["menuBg", "Menus"], ["panel", "Panels"],
];
const LOOK_BOOL = new Set(["glow", "gradient"]);
const LOOK_SWATCHES = ["#a970ff", "#e2558a", "#7dd3fc", "#2ee6a8", "#e8b75c", "#ff8a5b", "#38bdf8", "#f43f5e", "#84cc16", "#fbbf24", "#ffffff", "#6d5dfc", "#14b8a6", "#ef4444"];

/* quick choices (settings.ov) sit on top of whichever theme is active */
function withOverrides(th) {
  const o = settings.ov;
  if (!o || !Object.keys(o).length) return th;
  const r = { ...th, ...o };
  if (r.gradient && !r.accent2) r.accent2 = mixHex(r.accent, "#ff6bd6", .5);
  return r;
}
function themeValue(k) {
  const v = (activeTheme || currentTheme())[k];
  if (LOOK_BOOL.has(k)) return v ? "1" : "";
  if (k === "pa") return v || "default";
  if (k === "coverShape") return v || "rounded";
  if (k === "card") return v || "soft";
  if (k === "icons") return v || "normal";
  if (k === "pg") return v || "fade";
  if (k === "ps") return v || "bar";
  if (k === "player") return v || "floating";
  if (k === "sidebar") return v || "normal";
  if (k === "tileSize") return v || "m";
  if (k === "density") return v || "comfortable";
  return v;
}

/* attributes the stylesheet reads */
function applyLook(th) {
  const b = document.body, r = document.documentElement.style;
  b.dataset.card = th.card || "soft"; b.dataset.icons = th.icons || "normal"; b.dataset.pg = th.pg || "fade";
  b.dataset.pa = th.pa || "default"; b.dataset.ps = th.ps || "bar";
  b.classList.toggle("glow", !!th.glow);
  if (th.btn) { r.setProperty("--btn", th.btn); r.setProperty("--on-btn", luminance(hexToRgb(th.btn)) > .42 ? "#111111" : "#ffffff"); b.classList.add("btn-custom"); }
  else { r.removeProperty("--btn"); r.removeProperty("--on-btn"); b.classList.remove("btn-custom"); }
  if (th.menuBg) r.setProperty("--menu-bg", th.menuBg);
  lookNP();
}
function lookNP() {
  const c = P.current ? coverOf(P.current) : "";
  document.documentElement.style.setProperty("--np-cover", c ? `url("${c}")` : "none");
}
if (typeof renderNP === "function") { const rn = renderNP; renderNP = function (...a) { const r = rn.apply(this, a); try { lookNP(); } catch {} return r; }; }

/* ---------- the page sections ---------- */
const lookSeg = (k, opts, cur) => `<div class="seg" data-ovseg="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(cur) === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
function lookColor(k, label) {
  const th = activeTheme || currentTheme(), v = th[k] || "", own = !!(settings.ov && settings.ov[k]);
  const opt = ["btn", "menuBg", "playerBg"].includes(k);
  return `<label>${label}<span class="color-row"><input type="color" data-ovc="${k}" value="${v || (k === "btn" ? th.accent : "#888888")}">
    <input class="input" type="text" data-ovct="${k}" value="${esc(v)}" placeholder="${opt ? "auto" : ""}" maxlength="7">${own ? `<button class="btn ghost sm" data-ovclear="${k}" title="Back to the theme's colour">×</button>` : ""}</span></label>`;
}
function lookToolbar() {
  const cur = currentTheme(), prev = allThemes().find(t => t.id === settings.prevThemeId);
  return `<div class="settings-sec look-bar"><div class="lbl" style="flex:1;min-width:200px"><b>${esc(cur.name)}</b><span>Your look is saved automatically and stays after you close Nagham.</span></div>
    <div class="look-btns">${prev && prev.id !== cur.id ? `<button class="btn ghost sm" data-lookprev title="Go back to the theme you used before">↶ Previous: ${esc(prev.name)}</button>` : ""}
    <button class="btn ghost sm" data-lookreset>Reset to default</button></div></div>`;
}
function lookPanel() {
  const n = Object.keys(settings.ov || {}).length, th = activeTheme || currentTheme();
  return `<details class="settings-sec look-quick" ${n ? "open" : ""}><summary><b>Customize colours & style</b><span class="muted"> — works on top of any theme${n ? ` · ${n} change${n > 1 ? "s" : ""}` : ""}</span></summary>
    <div class="editor" id="ovEditor" style="margin-top:14px">
      <h4 class="ed-h full">Colours</h4>
      ${LOOK_COLORS.map(([k, l]) => lookColor(k, l)).join("")}
      <label class="full">Quick colours<div class="swatches">${LOOK_SWATCHES.map(c => `<button data-ovsw="${c}" style="background:${c}" title="Main colour ${c}"></button>`).join("")}</div></label>
      <h4 class="ed-h full">Look</h4>
      ${LOOK_CHOICES.map(([k, l, o]) => `<label class="full">${l}${lookSeg(k, o, themeValue(k))}</label>`).join("")}
      <label>Font<select class="input" data-ovsel="font">${Object.entries(FONTS).map(([k, [l]]) => `<option value="${k}" ${(th.font || "default") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Corner roundness <input type="range" data-ovr="radius" min="0" max="30" value="${th.radius ?? 18}"></label>
      <label>Glass blur <input type="range" data-ovr="blur" min="0" max="40" value="${th.blur ?? 18}"></label>
      <label>Text size <input type="range" data-ovr="fontScale" min="85" max="125" value="${th.fontScale || 100}"></label>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn ghost sm" data-ovreset ${n ? "" : "disabled"}>Undo my customizations</button></div></details>`;
}

/* ---------- apply / save ---------- */
let lookRaf = 0;
function lookSet(k, v, repaint) {
  settings.ov = settings.ov || {};
  settings.ov[k] = v;
  cancelAnimationFrame(lookRaf);
  lookRaf = requestAnimationFrame(() => { fxKindReset(k); applyTheme(currentTheme()); });
  saveUser();
  if (repaint) lookRefreshPage();
}
function fxKindReset(k) { if (k === "fx" || k === "fxAmount") fxKind = null; }
function lookRefreshPage() { // refresh the panel without losing scroll or open state
  if (nav.stack[nav.idx]?.view === "settings" || nav.stack[nav.idx]?.view === "themes") { const y = $("#view").scrollTop; render(true); $("#view").scrollTop = y; }
}
$("#view").addEventListener("click", async e => {
  const t = e.target;
  const sg = t.closest("[data-ovseg] button");
  if (sg) {
    const k = sg.parentElement.dataset.ovseg, v = sg.dataset.v;
    lookSet(k, LOOK_BOOL.has(k) ? !!v : v);
    $$("button", sg.parentElement).forEach(b => b.classList.toggle("on", b === sg));
    return;
  }
  const sw = t.closest("[data-ovsw]"); if (sw) { lookSet("accent", sw.dataset.ovsw); lookRefreshPage(); return; }
  const cl = t.closest("[data-ovclear]"); if (cl) { delete settings.ov[cl.dataset.ovclear]; saveUser(); applyTheme(currentTheme()); lookRefreshPage(); return; }
  if (t.closest("[data-ovreset]")) { settings.ov = {}; saveUser(); applyTheme(currentTheme()); lookRefreshPage(); toast("Back to the theme's own look"); return; }
  if (t.closest("[data-lookreset]")) return resetLook();
  if (t.closest("[data-lookprev]")) { endPreview(false); useTheme(settings.prevThemeId); render(true); toast("Back to your previous theme"); return; }
});
$("#view").addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.ovc) { lookSet(t.dataset.ovc, t.value); const tx = $(`[data-ovct="${t.dataset.ovc}"]`); if (tx) tx.value = t.value; }
  else if (t.dataset.ovct) { const v = t.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) { lookSet(t.dataset.ovct, v); const c = $(`[data-ovc="${t.dataset.ovct}"]`); if (c) c.value = v; } }
  else if (t.dataset.ovr) lookSet(t.dataset.ovr, +t.value);
});
$("#view").addEventListener("change", e => {
  if (e.target.dataset.ovsel) lookSet(e.target.dataset.ovsel, e.target.value);
  else if (e.target.dataset.ovc) lookRefreshPage(); // show the little “×” once a colour was changed
});

/* ---------- reset to default ---------- */
async function resetLook() {
  if (!await confirm_("Reset the look to default?", "Theme, colours, style, animations and performance mode go back to the original. Your songs and playlists are not touched.", "Reset")) return;
  endPreview(false);
  if (settings.themeId !== "midnight") settings.prevThemeId = settings.themeId;
  settings.themeId = "midnight"; settings.ov = {}; settings.dynamic = false; settings.effects = true; settings.anim = true; settings.perf = "auto";
  saveUser(); document.body.classList.add("theme-anim"); setTimeout(() => document.body.classList.remove("theme-anim"), 800);
  applyTheme(currentTheme()); detectPerf(); render(true); toast("Back to the default look");
}

/* ---------- live preview before keeping a theme ---------- */
let PREVIEW = null;
function previewTheme(id) {
  const th = allThemes().find(t => t.id === id); if (!th) return;
  if (id === settings.themeId && !PREVIEW) { toast("You're already using this theme"); return; }
  PREVIEW = id;
  document.body.classList.add("theme-anim"); clearTimeout(useTheme.t); useTheme.t = setTimeout(() => document.body.classList.remove("theme-anim"), 800);
  applyTheme(th);
  let bar = $("#prevBar");
  if (!bar) { bar = document.createElement("div"); bar.id = "prevBar"; document.body.appendChild(bar); }
  bar.innerHTML = `<span>Trying <b>${esc(th.name)}</b></span><button class="btn accent sm" id="pvUse">Use this theme</button><button class="btn ghost sm" id="pvCancel">Cancel</button>`;
  requestAnimationFrame(() => bar.classList.add("on"));
  $$(".theme-card[data-theme]").forEach(c => c.classList.toggle("trying", c.dataset.theme === id));
}
function endPreview(keep) {
  if (PREVIEW === null) return;
  const id = PREVIEW; PREVIEW = null;
  $("#prevBar")?.classList.remove("on");
  if (keep) { useTheme(id); toast("Theme saved"); } else applyTheme(currentTheme());
  $$(".theme-card[data-theme]").forEach(c => { c.classList.remove("trying"); c.classList.toggle("on", c.dataset.theme === settings.themeId); });
  if (keep) lookRefreshPage();
}
document.addEventListener("click", e => {
  if (e.target.closest("#pvUse")) endPreview(true);
  else if (e.target.closest("#pvCancel")) endPreview(false);
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && PREVIEW !== null && !$(".modal-bg")) endPreview(false); });
