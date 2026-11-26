"use strict";
/* Nagham – Vocal control (singer volume) + Karaoke mode.

   HOW THE VOCAL CONTROL WORKS (and what it can't do):
   Nagham has no AI source-separation model, so it can't truly split a song into "voice" and "music" stems.
   Instead it uses the classic stereo "centre extraction": lead vocals are almost always mixed dead-centre, so
   (L+R)/2 holds the singer plus anything else in the centre. That centre signal is limited to the vocal band
   (everything between a low and a high cut-off) and subtracted from / added to the song:
        out = music·song + (vocal − music)·centre_band
   Bass and drums that sit in the centre outside the vocal band are kept, but bass-drum hits, snare and
   centre-panned instruments inside the band are reduced too, and reverb / stereo backing vocals stay.
   Mono songs have no side information, so nothing can be removed from them (Nagham tells you). */

const VOC_MODES = {
  original: { v: 1, m: 1, lo: 180, hi: 6000, label: "Original" },
  karaoke: { v: .15, m: 1, lo: 170, hi: 6500, label: "Karaoke" },
  instrumental: { v: 0, m: 1, lo: 120, hi: 9000, label: "Instrumental" },
};
var KAR_STATE = { open: false };
const VOC = { g: null, ms: 0, ss: 0, seen: 0, state: "idle", mono: false, supported: false, timer: 0 };
/* two separate settings: the normal player keeps its own, Karaoke has its own (music only by default).
   Changing the singer volume inside Karaoke never touches normal listening. */
const vocSet = () => {
  if (!settings.vocSplit) { settings.vocSplit = 1; settings.vocal = { mode: "original", v: 1, m: 1 }; } // older versions leaked the Karaoke choice into the normal player
  if (typeof KAR_STATE !== "undefined" && KAR_STATE.open) return (settings.kVocal ||= { mode: "instrumental", v: 0, m: 1 });
  return (settings.vocal ||= { mode: "original", v: 1, m: 1 });
};
const vocIsOn = () => { const s = vocSet(); return s.mode !== "original" || Math.abs(s.v - 1) > .01 || Math.abs(s.m - 1) > .01; };
const vocLocal = () => E.mode === "audio" && !!audio.src;
/* songs from YouTube Music play in a hidden page — the same processing runs inside that page (see ytmFxPage). Spotify's own player can't be processed,
   so while an effect is on, Spotify songs are played through YouTube Music instead (startEngine checks fxWanted). */
const vocYtm = () => E.mode === "external" && EXT.embedded;
function vocSupportedNow() { const t = T(P.current); return !!t && (vocLocal() || vocYtm() || (E.mode === "spotify" && !!EXT.native)); }
const vocWanted = () => vocIsOn() && vocSupportedNow();
const vocActive = () => !!VOC.g && vocWanted() && vocLocal() && !VOC.mono;

/* the audio graph (built once, together with the equalizer chain; "original" is a straight wire) */
function vocBuild(ctx, src) {
  const g = {};
  g.out = ctx.createGain();
  g.bypass = ctx.createGain(); src.connect(g.bypass); g.bypass.connect(g.out);       // untouched sound
  g.pre = ctx.createGain(); g.pre.channelCount = 2; g.pre.channelCountMode = "explicit"; g.pre.channelInterpretation = "speakers"; // mono → L=R
  src.connect(g.pre);
  const sp = ctx.createChannelSplitter(2); g.pre.connect(sp);
  const mid = ctx.createGain(); mid.gain.value = .5; sp.connect(mid, 0); sp.connect(mid, 1);       // (L+R)/2
  const side = ctx.createGain(); const sL = ctx.createGain(), sR = ctx.createGain(); sL.gain.value = .5; sR.gain.value = -.5;
  sp.connect(sL, 0); sp.connect(sR, 1); sL.connect(side); sR.connect(side);                         // (L−R)/2
  // vocal band = centre − lowpass(centre) − highpass(centre): bass and "air" stay, no phase mismatch
  const mk = (type, f) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = .707; return b; };
  g.lp = [mk("lowpass", 170), mk("lowpass", 170)]; g.hp = [mk("highpass", 6000), mk("highpass", 6000)];
  mid.connect(g.lp[0]); g.lp[0].connect(g.lp[1]); mid.connect(g.hp[0]); g.hp[0].connect(g.hp[1]);
  const band = ctx.createGain();
  const neg1 = ctx.createGain(); neg1.gain.value = -1; const neg2 = ctx.createGain(); neg2.gain.value = -1;
  mid.connect(band); g.lp[1].connect(neg1); neg1.connect(band); g.hp[1].connect(neg2); neg2.connect(band);
  g.vocal = ctx.createGain(); band.connect(g.vocal);
  const merger = ctx.createChannelMerger(2);
  g.mL = ctx.createGain(); g.mR = ctx.createGain(); sp.connect(g.mL, 0); sp.connect(g.mR, 1);
  g.mL.connect(merger, 0, 0); g.mR.connect(merger, 0, 1);
  g.vocal.connect(merger, 0, 0); g.vocal.connect(merger, 0, 1);
  // With the centre gone, what's left in the vocal band is pure "side" sound: opposite in the two speakers. That sounds hollow
  // and disappears completely on a mono speaker (phones!). So when the singer is turned far down, the right channel's side part
  // is flipped (classic karaoke): the band becomes mono but solid.  right_band = −side + 2·side = +side
  const sLp = [mk("lowpass", 170), mk("lowpass", 170)], sHp = [mk("highpass", 6000), mk("highpass", 6000)];
  side.connect(sLp[0]); sLp[0].connect(sLp[1]); side.connect(sHp[0]); sHp[0].connect(sHp[1]);
  const sBand = ctx.createGain(), n3 = ctx.createGain(), n4 = ctx.createGain(); n3.gain.value = n4.gain.value = -1;
  side.connect(sBand); sLp[1].connect(n3); n3.connect(sBand); sHp[1].connect(n4); n4.connect(sBand);
  g.sfix = ctx.createGain(); g.sfix.gain.value = 0; sBand.connect(g.sfix); g.sfix.connect(merger, 0, 1);
  g.lp.push(...sLp); g.hp.push(...sHp);
  g.proc = ctx.createGain(); g.proc.gain.value = 0; merger.connect(g.proc); g.proc.connect(g.out);
  g.aMid = ctx.createAnalyser(); g.aSide = ctx.createAnalyser(); g.aMid.fftSize = g.aSide.fftSize = 2048;
  mid.connect(g.aMid); side.connect(g.aSide);
  g.buf = new Float32Array(2048);
  VOC.g = g;
  return g.out;
}
/* ---------- the same effects inside the hidden YouTube Music page ----------
   This function is never run here: its text is sent to the YouTube Music page and runs there (together with vocBuild). */
function ytmFxPage(c, vocBuild, VOC) {
  try {
    var W = window, v = document.querySelector("video"); if (!v) return;
    var F = W.__ngF;
    if (!F || F.v !== v) {
      if (!c.eq && !c.on) { W.__ngFxS = "0"; return; }                                   // nothing switched on: leave the page alone
      if (!/^blob:/.test(v.currentSrc || v.src || "")) { W.__ngFxS = "x"; return; }      // a stream the browser won't let anyone process (it would go silent)
      var ctx = W.__ngCtx || (W.__ngCtx = new (W.AudioContext || W.webkitAudioContext)());
      if (ctx.state !== "running") { try { ctx.resume(); } catch (e) {} W.__ngFxS = "s"; return; } // never reroute the sound into an engine that isn't running
      var src = ctx.createMediaElementSource(v), node = vocBuild(ctx, src), g = VOC.g;
      var eq = c.f.map(function (f, i) { var n = ctx.createBiquadFilter(); n.type = i === 0 ? "lowshelf" : i === c.f.length - 1 ? "highshelf" : "peaking"; n.frequency.value = f; n.Q.value = 1; n.gain.value = 0; return n; });
      eq.forEach(function (n) { node.connect(n); node = n; }); node.connect(ctx.destination);
      F = W.__ngF = { v: v, ctx: ctx, g: g, eq: eq, tail: node, ms: 0, ss: 0, seen: 0, mono: false };
      F.apply = function () {
        var c = F.c, g = F.g, t = F.ctx.currentTime, on = c.on && !F.mono;
        g.lp.forEach(function (f) { f.frequency.setTargetAtTime(c.lo, t, .05); }); g.hp.forEach(function (f) { f.frequency.setTargetAtTime(c.hi, t, .05); });
        g.bypass.gain.setTargetAtTime(on ? 0 : 1, t, .04); g.proc.gain.setTargetAtTime(on ? 1 : 0, t, .04);
        g.mL.gain.setTargetAtTime(c.m, t, .05); g.mR.gain.setTargetAtTime(c.m, t, .05);
        g.vocal.gain.setTargetAtTime(c.v - c.m, t, .05); g.sfix.gain.setTargetAtTime(c.v < .5 ? 2 * c.m : 0, t, .05);
        F.eq.forEach(function (n, i) { n.gain.setTargetAtTime(c.g[i] || 0, t, .05); });
        W.__ngFxS = !c.on ? "k" : F.seen < 8 ? "a" : F.mono ? "m" : "k";
      };
      setInterval(function () { // is the song really stereo? a mono song has nothing to separate
        var cs = F.v.currentSrc || ""; if (cs !== F.src) { F.src = cs; F.ms = F.ss = F.seen = 0; F.skip = 3; if (F.mono) { F.mono = false; F.apply(); } } // another song in the same page: measure again
        if (F.v.paused || !F.c || !F.c.on) return;
        if (F.ctx.state !== "running") { try { F.ctx.resume(); } catch (e) {} return; }
        var rms = function (a) { g[a].getFloatTimeDomainData(g.buf); var x = 0; for (var i = 0; i < g.buf.length; i++) x += g.buf[i] * g.buf[i]; return x / g.buf.length; };
        var m = rms("aMid"), sd = rms("aSide"); if (m < 1e-7) return;
        if (F.skip > 0) { F.skip--; return; } // the first moments can still hold the previous song
        F.ms = F.ms * .9 + m * .1; F.ss = F.ss * .9 + sd * .1; F.seen++;
        if (F.seen >= 8) { var mono = F.ss / F.ms < 1e-4; if (mono !== F.mono || F.seen === 8) { F.mono = mono; F.apply(); } }
      }, 250);
    }
    F.c = c; F.apply();
  } catch (e) { window.__ngFxS = "e:" + String(e).slice(0, 80); }
}
const fxEqOn = () => typeof eqGains === "function" && eqGains().some(x => x);
const fxWanted = () => fxEqOn() || vocIsOn();
function ytmFxCfg() {
  const s = vocSet(), cfg = VOC_MODES[s.mode] || VOC_MODES.karaoke;
  return { f: EQ_FREQS, g: eqGains(), eq: fxEqOn(), on: vocIsOn(), v: s.v, m: s.m, lo: cfg.lo, hi: cfg.hi };
}
/* (re)sends the effects to the YouTube Music page: when they change, when a new song's page is up, and again while the page hasn't confirmed */
function ytmFxSend(force) {
  if (!vocYtm() || !EXT.st || !EXT.st.ok) return;
  if (!force && Date.now() - (EXT.fxSentAt || 0) < 150) { clearTimeout(EXT.fxT); EXT.fxT = setTimeout(() => ytmFxSend(), 160); return; } // dragging a slider
  const c = ytmFxCfg(), key = EXT.tag + JSON.stringify(c), fx = EXT.st.fx || "";
  const confirmed = fx === "k" || fx === "m" || fx === "a" || fx === "x" || (fx === "0" && !c.eq && !c.on);
  if (!force && key === EXT.fxKey && (confirmed || Date.now() - (EXT.fxAt || 0) < 2500)) return;
  if (key !== EXT.fxKey) EXT.fxTries = 0;
  if ((EXT.fxTries = (EXT.fxTries || 0) + 1) > 12 && !force) return; // the page never answered: stop asking
  EXT.fxKey = key; EXT.fxAt = EXT.fxSentAt = Date.now();
  if (EXT.fxTries === 1 && (c.eq || c.on)) postLog(`ytm fx send #${EXT.tag} eq=${c.eq} vocal=${c.on ? c.v + "/" + c.m : "off"}`);
  ytmCmd(`(function(){var VOC={};${vocBuild.toString()};(${ytmFxPage.toString()})(${JSON.stringify(c)},vocBuild,VOC)})()`);
}
let fxSwitchAt = 0;
/* an effect was switched on while Spotify's own player has the song: play it through YouTube Music, where it can be processed */
function fxEngineCheck() {
  if (E.mode !== "spotify" || !fxWanted() || !EXT.native || !P.current || Date.now() - fxSwitchAt < 6000) return;
  fxSwitchAt = Date.now();
  const id = P.current, at = Math.max(0, E.time || 0);
  postLog("fx: moving the Spotify song to the YouTube Music player");
  toast("Switching this song to the YouTube Music player so the sound effects can work…");
  P.loaded = null; startEngine(id, at > 3 ? at : 0);
}
function vocApply() {
  const s = vocSet(), ok = vocSupportedNow();
  VOC.supported = ok;
  fxEngineCheck();
  if (!vocLocal()) { // YouTube Music page (or nothing playable): the local graph is left as it is
    if (vocYtm()) { const fx = EXT.st?.fx || ""; VOC.ymono = fx === "m"; ytmFxSend(); }
    vocUI(); return;
  }
  if (!VOC.g && !(vocIsOn() && ok)) { vocUI(); return; }
  if (!VOC.g) { // building the graph reroutes the sound through Web Audio: only after the user has clicked something (else it could stay silent)
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (!eqInit()) { VOC.state = "error"; vocUI(); return; }
  }
  const g = VOC.g, ctx = eqCtx, cfg = VOC_MODES[s.mode] || VOC_MODES.karaoke, t = ctx.currentTime;
  const on = vocIsOn() && ok && !VOC.mono;
  g.lp.forEach(f => f.frequency.setTargetAtTime(cfg.lo, t, .05)); g.hp.forEach(f => f.frequency.setTargetAtTime(cfg.hi, t, .05));
  g.bypass.gain.setTargetAtTime(on ? 0 : 1, t, .04); g.proc.gain.setTargetAtTime(on ? 1 : 0, t, .04);
  g.mL.gain.setTargetAtTime(s.m, t, .05); g.mR.gain.setTargetAtTime(s.m, t, .05);
  g.vocal.gain.setTargetAtTime(s.v - s.m, t, .05);
  g.sfix.gain.setTargetAtTime(s.v < .5 ? 2 * s.m : 0, t, .05);
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  if (vocIsOn() && ok) vocWatchStereo();
  vocUI();
}
/* is the song really stereo? (a mono song has nothing to separate) */
function vocWatchStereo() {
  if (VOC.timer || !VOC.g) return;
  VOC.state = VOC.seen > 12 ? VOC.state : "analysing";
  VOC.timer = setInterval(() => {
    const g = VOC.g; if (!g || !vocWanted() || !vocLocal()) { clearInterval(VOC.timer); VOC.timer = 0; return; }
    if (audio.paused) return;
    const rms = a => { g[a].getFloatTimeDomainData(g.buf); let x = 0; for (const v of g.buf) x += v * v; return x / g.buf.length; };
    const m = rms("aMid"), sd = rms("aSide");
    if (m < 1e-7) return; // silence
    VOC.ms = VOC.ms * .9 + m * .1; VOC.ss = VOC.ss * .9 + sd * .1; VOC.seen++;
    if (VOC.seen >= 8) {
      const mono = VOC.ss / VOC.ms < 1e-4; // side is >40 dB below the centre
      const state = mono ? "mono" : "ok";
      if (mono !== VOC.mono || state !== VOC.state) { VOC.mono = mono; VOC.state = state; vocApply(); }
    }
  }, 250);
}
function vocReset() { VOC.ms = VOC.ss = VOC.seen = 0; VOC.mono = false; VOC.state = "idle"; }
function vocSetMode(m) {
  const s = vocSet(), c = VOC_MODES[m]; if (!c) return;
  s.mode = m; s.v = c.v; s.m = c.m; saveUser(); vocApply();
  toast(vocSupportedNow() ? `Vocal: ${c.label}` : `${c.label} saved — it will apply when a song plays`);
}
function vocSetLevels(v, m) {
  const s = vocSet();
  if (v != null) s.v = v; if (m != null) s.m = m;
  const same = Object.entries(VOC_MODES).find(([, c]) => Math.abs(c.v - s.v) < .005 && Math.abs(c.m - s.m) < .005);
  s.mode = same ? same[0] : "custom";
  saveUser(); vocApply();
}
/* song changed / engine changed: re-check support */
let vocLastFx = "";
setInterval(() => {
  const fx = vocYtm() ? (EXT.st?.fx || "") + "|" + EXT.tag : E.mode;
  if (VOC.supported !== vocSupportedNow() || fx !== vocLastFx) { vocLastFx = fx; vocApply(); }
  else if (vocYtm()) ytmFxSend();
}, 1000);
if (typeof playId === "function") { const p0 = playId; playId = function (...a) { vocReset(); const r = p0.apply(this, a); setTimeout(vocApply, 200); return r; }; }

/* ---------- Vocal volume popover ---------- */
function vocStatusText() {
  if (!vocSupportedNow()) return { cls: "warn", t: P.current ? "This song's player can't be processed here." : "Play a song first." };
  if (!vocIsOn()) return { cls: "", t: "Original sound." };
  if (E.mode === "spotify") return { cls: "busy", t: "Switching to the YouTube Music player…" };
  if (vocYtm()) {
    const fx = EXT.st?.fx || "";
    if (fx === "k") return { cls: "ok", t: "Stereo song — processing in real time (YouTube Music player)." };
    if (fx === "m") return { cls: "warn", t: "This song is (almost) mono — there's no stereo information, so the singer can't be separated. Playing the original." };
    if (fx === "x") return { cls: "warn", t: "YouTube sent this song in a form that can't be processed. Playing the original." };
    if (fx.startsWith("e:")) return { cls: "warn", t: "Couldn't start the audio processor in the YouTube Music player." };
    return { cls: "busy", t: EXT.sawPlay ? "Analysing the song…" : "Waiting for the song to start…" };
  }
  if (VOC.state === "analysing" || (VOC.state === "idle" && VOC.g)) return { cls: "busy", t: "Analysing the song…" };
  if (VOC.mono) return { cls: "warn", t: "This song is (almost) mono — there's no stereo information, so the singer can't be separated. Playing the original." };
  if (VOC.state === "error") return { cls: "warn", t: "Couldn't start the audio processor." };
  return { cls: "ok", t: "Stereo song — processing in real time." };
}
const vocChips = () => `<div class="voc-chips">${["original", "karaoke", "instrumental"].map(m => `<button data-vm="${m}" class="${vocSet().mode === m ? "on" : ""}">${VOC_MODES[m].label}</button>`).join("")}${vocSet().mode === "custom" ? '<button class="on" disabled>Custom</button>' : ""}</div>`;
function vocHTML() {
  const s = vocSet(), st = vocStatusText();
  return `<div class="voc-h"><b>Vocal volume</b><button class="icon-btn" data-vclose title="Close">${IC.x || "✕"}</button></div>${vocChips()}
    <label class="voc-row"><span>Singer</span><input type="range" id="vocV" min="0" max="200" value="${Math.round(s.v * 100)}"><em>${Math.round(s.v * 100)}%</em></label>
    <label class="voc-row"><span>Music</span><input type="range" id="vocM" min="0" max="150" value="${Math.round(s.m * 100)}"><em>${Math.round(s.m * 100)}%</em></label>
    <div class="voc-st ${st.cls}">${st.cls === "busy" ? '<i class="spin"></i>' : ""}${esc(st.t)}</div>
    <details class="voc-how"><summary>How good is it?</summary><p>Nagham has no AI that splits a song into voice and music. It reduces what's in the <b>centre</b> of the stereo mix, where lead singers usually are. It works best on stereo studio songs: the voice gets much quieter but never perfectly gone, and drums or instruments in the centre get a little quieter too. Mono songs can't be processed.</p></details>
    <button class="btn ghost sm" data-vreset style="margin-top:8px">Back to original</button>`;
}
function vocUI() {
  const on = vocIsOn() && vocSupportedNow();
  for (const b of [$("#vocBtn"), $("#fVoc")]) b?.classList.toggle("on", on);
  const pop = $("#vocPop"); if (pop && pop.classList.contains("on")) { const keep = document.activeElement?.id; pop.innerHTML = vocHTML(); if (keep) $("#" + keep, pop)?.focus(); }
  KAR.sync && KAR.sync();
}
function vocPopover(anchor) {
  let pop = $("#vocPop");
  if (!pop) { pop = document.createElement("div"); pop.id = "vocPop"; document.body.appendChild(pop); }
  if (pop.classList.contains("on")) { pop.classList.remove("on"); return; }
  pop.innerHTML = vocHTML(); pop.classList.add("on");
  const r = anchor.getBoundingClientRect();
  pop.style.right = Math.max(12, innerWidth - r.right - 20) + "px"; pop.style.bottom = Math.max(12, innerHeight - r.top + 10) + "px";
}
document.addEventListener("click", e => {
  const pop = $("#vocPop");
  const vm = e.target.closest("[data-vm]"); if (vm) return vocSetMode(vm.dataset.vm);
  if (e.target.closest("[data-vreset]")) return vocSetMode("original");
  if (e.target.closest("[data-vclose]")) return pop?.classList.remove("on");
  const b = e.target.closest("#vocBtn, #fVoc"); if (b) { vocPopover(b); return; }
  if (pop?.classList.contains("on") && !e.target.closest("#vocPop")) pop.classList.remove("on");
});
document.addEventListener("input", e => {
  if (e.target.id === "vocV") { vocSetLevels(+e.target.value / 100, null); e.target.nextElementSibling.textContent = e.target.value + "%"; }
  else if (e.target.id === "vocM") { vocSetLevels(null, +e.target.value / 100); e.target.nextElementSibling.textContent = e.target.value + "%"; }
  else if (e.target.id === "kVocV") vocSetLevels(+e.target.value / 100, null);
});

/* ============================================================ KARAOKE MODE */
const KAR = { open: false, id: null, sig: "", idx: -1, raf: 0, moved: 0, userScroll: 0, pal: null, palFor: "", sync: null };
const karSet = () => (settings.kar ||= { hi: "", bg: "", size: 100, clean: false });
const KAR_HTML = `
  <div class="kar-bg"><i></i><i></i><i></i></div>
  <div class="kar-top">
    <div class="kar-info"><b id="kTitle"></b><span id="kArtist"></span></div>
    <div class="kar-tools">
      <div class="voc-chips" id="kModes"></div>
      <button class="kbtn" data-kar="sm" title="Smaller words">A−</button><button class="kbtn" data-kar="lg" title="Bigger words">A+</button>
      <label class="kcol" title="Colour of the sung words"><span>Words</span><input type="color" id="kHi"></label>
      <label class="kcol" title="Background colour"><span>Back</span><input type="color" id="kBg"></label>
      <button class="kbtn" data-kar="auto" title="Use the colours of the cover">Auto</button>
      <span class="kbtn kbtn-sync"><button data-kar="syncm" title="Words too early? Nudge them later">−</button><em id="kSync"></em><button data-kar="syncp" title="Words too late? Nudge them earlier">+</button></span>
      <button class="kbtn" data-kar="clean" title="Hide the buttons (H)">Hide buttons</button>
      <button class="kbtn" data-kar="fs" title="Full screen">⛶</button>
      <button class="kbtn" data-kar="close" title="Close (Esc)">✕</button>
    </div>
  </div>
  <div class="kar-stage" id="kStage"></div>
  <div class="kar-bottom">
    <div class="kar-ctrls">
      <button class="icon-btn" data-kc="prev" title="Previous"></button><button class="pp" data-kc="pp" id="kPP"></button><button class="icon-btn" data-kc="next" title="Next"></button>
      <label class="kvoc" title="Singer volume"><span>Singer</span><input type="range" id="kVocV" min="0" max="200"><em id="kVocT"></em></label>
      <span class="kar-note" id="kNote"></span>
    </div>
    <div class="kar-prog"><span id="kCur">0:00</span><div class="kar-bar" id="kBar"><i id="kFill"></i></div><span id="kDur">0:00</span></div>
  </div>`;
function karEl() {
  let el = $("#karaoke");
  if (!el) { el = document.createElement("div"); el.id = "karaoke"; el.innerHTML = KAR_HTML; document.body.appendChild(el); }
  return el;
}
function karOpen(on) {
  on = on ?? !KAR.open;
  if (on && !P.current) return toast("Play something first");
  const el = karEl();
  KAR.open = KAR_STATE.open = on; el.classList.toggle("on", on);
  try { vocApply(); } catch {} // Karaoke has its own singer-volume setting; leaving it brings the normal one back document.body.classList.toggle("kar-open", on);
  for (const b of [$("#karBtn"), $("#fKar")]) b?.classList.toggle("on", on);
  if (on) {
    if ($("#full").classList.contains("open")) toggleFull(false);
    el.classList.toggle("clean", !!karSet().clean); KAR.sig = ""; KAR.id = null; KAR.idx = -1;
    karColors(); karLoop();
  } else { cancelAnimationFrame(KAR.raf); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); }
  if (typeof placeYtMini === "function") requestAnimationFrame(placeYtMini);
}
/* colours: from the cover unless you picked your own */
let karTok = 0;
async function karColors() {
  const tok = ++karTok, k = karSet(), el = karEl(), r = el.style;
  r.setProperty("--ks", (k.size || 100) / 100);
  let c1, c2, c3;
  if (k.bg) { c1 = mixHex(k.bg, "#000000", .35); c2 = k.bg; c3 = mixHex(k.bg, "#ffffff", .18); }
  else {
    const src = coverOf(P.current);
    const p = KAR.palFor === src && KAR.pal ? KAR.pal : (KAR.pal = await palette(src), KAR.palFor = src, KAR.pal);
    if (tok !== karTok) return; // a newer colour change already won
    const base = p?.vibrant ? p : { main: activeTheme?.accent || "#a970ff", second: activeTheme?.bg1 || "#160b2e", third: activeTheme?.accent2 || activeTheme?.accent || "#6d28d9" };
    c1 = mixHex(base.second, "#000000", .55); c2 = mixHex(base.main, "#000000", .38); c3 = mixHex(base.third, "#000000", .3);
  }
  r.setProperty("--k1", c1); r.setProperty("--k2", c2); r.setProperty("--k3", c3);
  const hi = k.hi || "#ffffff"; r.setProperty("--khi", hi);
  r.setProperty("--klo", rgba(k.hi ? mixHex(hi, "#000000", .55) : "#ffffff", k.hi ? .9 : .32));
  $("#kHi", el).value = hi; $("#kBg", el).value = k.bg || c2; $("#kSync", el).textContent = lyrOffTxt();
}
/* the stage: big lyrics, one line lit at a time, words filling as they're sung */
const kWords = text => String(text || "").split(/\s+/).filter(Boolean);
function karBuild() {
  const box = $("#kStage"), t = T(P.current);
  KAR.sig = `${LYR.id}|${LYR.state}|${LYR.lines.length}`; KAR.idx = -1;
  if (LYR.state === "loading" || LYR.id !== P.current) { box.innerHTML = `<div class="k-note"><i class="spin"></i>Finding the lyrics…</div>`; return; }
  if (LYR.state === "synced") {
    box.innerHTML = `<div class="k-lines"><div class="k-pad"></div>${LYR.lines.map((l, i) => {
      const ws = kWords(l.text), total = ws.reduce((a, w) => a + w.length + 1, 0) || 1; let acc = 0;
      return `<p class="kl" data-i="${i}" data-t="${l.t}" data-n="${total}">${ws.length ? ws.map(w => { const a = acc / total; acc += w.length + 1; return `<span class="kw" data-a="${a.toFixed(3)}" data-b="${(acc / total).toFixed(3)}">${esc(w)}</span>`; }).join(" ") : '<span class="k-dots">• • •</span>'}</p>`;
    }).join("")}<div class="k-pad"></div></div>`;
  } else if (LYR.state === "plain") box.innerHTML = `<div class="k-plainbox"><div class="k-nosync">These lyrics have no timing, so they can't follow the song</div><div class="k-plain">${esc(LYR.plain).replace(/\n/g, "<br>")}</div></div>`;
  else if (LYR.state === "instrumental") box.innerHTML = `<div class="k-note">♪ This one's instrumental</div>`;
  else if (LYR.state === "error") box.innerHTML = `<div class="k-note">Couldn't get the lyrics — check your connection<button class="btn ghost sm" data-karretry>Try again</button></div>`;
  else box.innerHTML = `<div class="k-note">No lyrics found for this song<small>Nagham never makes lyrics up — only real ones from the lyrics service are shown.</small></div>`;
}
function karLoop() {
  cancelAnimationFrame(KAR.raf);
  const el = karEl(); let lastCur = "", lastPP = null;
  const frame = () => {
    if (!KAR.open) return;
    const t = T(P.current);
    if (!t) { karOpen(false); return; }
    if (KAR.id !== P.current) { KAR.id = P.current; KAR.idx = -1; $("#kTitle", el).textContent = t.title; $("#kArtist", el).textContent = t.artist + (t.album ? " • " + t.album : ""); loadLyrics(P.current); karColors(); }
    const sig = `${LYR.id}|${LYR.state}|${LYR.lines.length}`; if (sig !== KAR.sig) karBuild();
    // transport
    const d = E.duration || t.duration || 0, now = E.time || 0;
    const paused = E.paused; if (paused !== lastPP) { lastPP = paused; $("#kPP", el).innerHTML = paused ? IC.play : IC.pause; el.classList.toggle("paused", paused); }
    const cur = fmt(now).replace("–:––", "0:00"); if (cur !== lastCur) { lastCur = cur; $("#kCur", el).textContent = cur; $("#kDur", el).textContent = settings.remain ? "-" + fmt(Math.max(0, d - now)) : fmt(d); }
    $("#kFill", el).style.transform = `scaleX(${d ? Math.min(1, now / d) : 0})`;
    // lyrics
    if (LYR.state === "synced" && LYR.id === P.current) {
      const tt = now + lyrOff(); let i = -1;
      for (let k = Math.max(0, KAR.idx - 1); k < LYR.lines.length; k++) { if (LYR.lines[k].t <= tt) i = k; else break; }
      if (i < 0 || (KAR.idx > i)) { i = -1; for (let k = 0; k < LYR.lines.length; k++) { if (LYR.lines[k].t <= tt) i = k; else break; } }
      const lines = $$(".kl", el);
      if (i !== KAR.idx) {
        KAR.idx = i;
        lines.forEach((p, k) => { p.classList.toggle("on", k === i); p.classList.toggle("past", k < i); p.classList.toggle("near", k === i + 1 || k === i + 2); if (k !== i) p.querySelectorAll(".kw").forEach(w => w.style.removeProperty("--f")); });
        const c = lines[i], sc = $(".k-lines", el);
        if (c && sc && Date.now() - KAR.userScroll > 3500) sc.scrollTo({ top: c.offsetTop - sc.clientHeight / 2 + c.offsetHeight / 2, behavior: "smooth" });
      }
      // words fill in across the line (estimated from the line's length — the lyrics service only times whole lines)
      const c = lines[KAR.idx];
      if (c) {
        const L = LYR.lines[KAR.idx], nx = LYR.lines[KAR.idx + 1], slot = nx ? nx.t - L.t : 4;
        const span = Math.max(.8, Math.min(+c.dataset.n / 12, slot * .95));
        const p = Math.max(0, Math.min(1, (tt - L.t) / span));
        c.querySelectorAll(".kw").forEach(w => { const a = +w.dataset.a, b = +w.dataset.b, f = Math.max(0, Math.min(1, (p - a) / Math.max(.001, b - a))); const fs = f.toFixed(2); if (w.dataset.f !== fs) { w.dataset.f = fs; w.style.setProperty("--f", fs); } });
      }
    }
    el.classList.toggle("show", Date.now() - KAR.moved < 3200);
    KAR.raf = requestAnimationFrame(frame);
  };
  KAR.sync = () => {
    if (!KAR.open) return;
    const s = vocSet(), st = vocStatusText();
    $("#kModes", el).innerHTML = vocChips();
    $("#kVocV", el).value = Math.round(s.v * 100); $("#kVocT", el).textContent = Math.round(s.v * 100) + "%";
    const inst = window.SING?.on && SING.inst && SING.pid === P.current; // Karaoke Studio found a real music-only release
    $("#kNote", el).textContent = inst ? "Playing a music-only version of this song." : vocIsOn() || !vocSupportedNow() ? st.t : "";
    $("#kNote", el).className = "kar-note " + (inst ? "ok" : st.cls);
    $("#kSync", el).textContent = lyrOffTxt();
  };
  KAR.sync();
  KAR.raf = requestAnimationFrame(frame);
}
document.addEventListener("click", e => {
  if (e.target.closest("#karBtn, #fKar")) { karOpen(); return; }
  if (!KAR.open) return;
  const t = e.target, el = $("#karaoke");
  if (!el.contains(t)) return;
  const kc = t.closest("[data-kc]");
  if (kc) { ({ prev: () => $("#prev").click(), next: () => $("#next").click(), pp: () => $("#pp").click() })[kc.dataset.kc](); return; }
  if (t.closest("[data-karretry]")) { loadLyrics(P.current, true); return; }
  const k = t.closest("[data-kar]");
  if (k) {
    const s = karSet(), a = k.dataset.kar;
    if (a === "close") karOpen(false);
    else if (a === "sm" || a === "lg") { s.size = Math.max(60, Math.min(170, (s.size || 100) + (a === "lg" ? 10 : -10))); saveUser(); karColors(); }
    else if (a === "auto") { s.hi = ""; s.bg = ""; saveUser(); karColors(); }
    else if (a === "clean") { s.clean = true; saveUser(); el.classList.add("clean"); KAR.moved = 0; toast("Buttons hidden — move the mouse to see them, or press H"); }
    else if (a === "fs") { if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => toast("This window can't go any bigger — Karaoke already fills it")); }
    else if (a === "syncm" || a === "syncp") { settings.lyrOffset = Math.max(-3, Math.min(3, Math.round(((settings.lyrOffset || 0) + (a === "syncp" ? .1 : -.1)) * 10) / 10)); saveUser(); KAR.idx = -1; KAR.sync(); }
    return;
  }
  const bar = t.closest("#kBar");
  if (bar) { const r = bar.getBoundingClientRect(), d = E.duration; if (d) E.time = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d; return; }
  const kl = t.closest(".kl[data-t]"); if (kl) { E.time = +kl.dataset.t; KAR.userScroll = 0; }
});
document.addEventListener("input", e => {
  if (!KAR.open) return;
  const s = karSet();
  if (e.target.id === "kHi") { s.hi = e.target.value; saveUser(); karColors(); }
  else if (e.target.id === "kBg") { s.bg = e.target.value; saveUser(); karColors(); }
});
document.addEventListener("mousemove", () => { KAR.moved = Date.now(); }, { passive: true });
document.addEventListener("wheel", e => { if (KAR.open && e.target.closest?.("#kStage")) KAR.userScroll = Date.now(); }, { passive: true });
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(document.activeElement?.tagName || "") && document.activeElement.type !== "range" && document.activeElement.type !== "color") return;
  const k = e.key.toLowerCase();
  if (k === "k" && kbdOn("letters")) { e.preventDefault(); karOpen(); }
  else if (k === "h" && KAR.open) { const s = karSet(); s.clean = !s.clean; saveUser(); $("#karaoke").classList.toggle("clean", s.clean); }
});
/* Esc closes Karaoke first (one press at a time, like everything else) */
if (typeof escapeStep === "function") { const es = escapeStep; escapeStep = function (typing, target) { if (KAR.open) { if (document.fullscreenElement) { document.exitFullscreen?.(); return true; } karOpen(false); return true; } if ($("#vocPop.on")) { $("#vocPop").classList.remove("on"); return true; } return es.call(this, typing, target); }; }
$("#karBtn").title = $("#fKar").title = "Karaoke mode (K)";

/* ============================================================ full-screen player extras + small player-bar additions */
function upNextList() {
  const out = [];
  P.upNext.slice(0, 4).forEach((id, i) => out.push({ id, kind: "u", i }));
  for (let k = P.opos + 1; k < P.order.length && out.length < 5; k++) out.push({ id: P.ctx[P.order[k]], kind: "o", i: k });
  return out.filter(o => T(o.id));
}
function renderFullExtra() {
  const t = T(P.current); if (!t) return;
  $("#fArtist").textContent = t.artist + (t.album ? " • " + t.album : "");
  const list = upNextList();
  $("#fUp").innerHTML = list.length ? `<div class="fup-h">Up next</div>` + list.map((o, n) => { const x = T(o.id); return `<div class="fup-row" data-fup="${o.kind}:${o.i}"><div class="art">${trackArt(o.id, true)}</div><div class="m"><b>${esc(x.title)}</b><span>${esc(x.artist)}</span></div></div>`; }).join("") : "";
}
if (typeof renderFull === "function") { const rf = renderFull; renderFull = function (...a) { const r = rf.apply(this, a); try { renderFullExtra(); } catch {} return r; }; }
$("#fUp").addEventListener("click", e => {
  const r = e.target.closest("[data-fup]"); if (!r) return;
  const [kind, i] = r.dataset.fup.split(":"), n = +i;
  if (kind === "u") { const id = P.upNext[n]; P.upNext.splice(0, n + 1); playId(id, true); }
  else { P.opos = n; playId(P.ctx[P.order[n]]); }
});
/* time left instead of the song length (click the length) */
if (typeof renderTime === "function") {
  const rt = renderTime;
  renderTime = function (...a) { const r = rt.apply(this, a); if (settings.remain) { const d = E.duration || T(P.current)?.duration || 0; if (d) $("#dur").textContent = $("#fDur").textContent = "-" + fmt(Math.max(0, d - (E.time || 0))); } return r; };
}
for (const id of ["#dur", "#fDur"]) { const el = $(id); el.style.cursor = "pointer"; el.title = "Click to switch between the song length and the time left"; el.addEventListener("click", () => { settings.remain = !settings.remain; saveUser(); renderTime(true); }); }
/* “add to playlist” right in the player bar */
if (typeof renderNP === "function") {
  const rn = renderNP;
  renderNP = function (...a) {
    const r = rn.apply(this, a);
    if (T(P.current)) $("#np").insertAdjacentHTML("beforeend", `<button class="icon-btn" id="npPl" title="Add to a playlist">${IC.plus}</button>`);
    return r;
  };
}
$("#np").addEventListener("click", e => {
  const b = e.target.closest("#npPl"); if (!b) return;
  const id = P.current; if (!T(id)) return;
  const r = b.getBoundingClientRect();
  menu(r.left, Math.max(8, r.top - 40 - Math.min(5, lib.playlists.length + 1) * 38), [
    { label: "New playlist", icon: IC.plus, act: () => newPlaylist([id]) }, "-",
    ...lib.playlists.map(p => ({ label: p.name, act: () => addToPlaylist(p.id, [id]) })),
  ]);
});
try { vocApply(); renderNP(); } catch {}
