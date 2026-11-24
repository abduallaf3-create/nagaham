"use strict";
/* Nagham mini player: shows what's playing and sends buttons back to Nagham */
const $ = s => document.querySelector(s);
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const HEART = on => `<svg viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`;
let st = {}, got = 0, lastCover = "";
const send = (cmd, val) => fetch("/api/remote/cmd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd, val: val || 0 }) }).catch(() => {});
function render() {
  const r = document.documentElement.style;
  if (st.accent) r.setProperty("--accent", st.accent);
  if (st.bg) r.setProperty("--bg", st.bg);
  $("#t").textContent = st.title || "Nagham";
  $("#a").textContent = st.title ? st.artist : "Nothing playing";
  document.title = st.title ? `${st.title} — ${st.artist}` : "Nagham mini player";
  if (st.cover !== lastCover) {
    lastCover = st.cover;
    $("#art").innerHTML = st.cover ? `<img src="${st.cover.replace(/"/g, "&quot;")}" alt="">` : "";
    $("#bg").style.backgroundImage = st.cover ? `url("${st.cover}")` : "none";
  }
  $("#art").classList.toggle("playing", !!st.playing);
  $("#pp").innerHTML = st.playing ? PAUSE : PLAY;
  $("#like").innerHTML = HEART(st.liked); $("#like").classList.toggle("on", !!st.liked);
}
function tick() {
  const t = Math.min(st.d || 0, (st.t || 0) + (st.playing ? (Date.now() - got) / 1000 : 0));
  $("#fill").style.width = st.d ? (t / st.d * 100) + "%" : "0";
}
setInterval(tick, 250);
(async function follow() {
  let v = -1;
  for (;;) {
    try {
      const r = await (await fetch(`/api/remote/state?v=${v}`)).json();
      v = r.v; st = r.state || {}; got = Date.now(); render(); tick();
    } catch { await new Promise(r => setTimeout(r, 1500)); }
  }
})();
$("#pp").onclick = () => { st.playing = !st.playing; render(); send("toggle"); };
$("#next").onclick = () => send("next");
$("#prev").onclick = () => send("prev");
$("#like").onclick = () => { st.liked = !st.liked; render(); send("like"); };
$("#bar").onclick = e => { if (st.d) send("seek", e.offsetX / e.currentTarget.clientWidth * st.d); };
$("#art").onclick = () => fetch("/api/window/show", { method: "POST" }).catch(() => {});
addEventListener("keydown", e => { if (e.code === "Space") { e.preventDefault(); $("#pp").click(); } });
