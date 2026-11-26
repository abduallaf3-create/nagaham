"use strict";
/* Nagham – Home suggestions from what you listen to: songs in the same style as your most played
   singers (their songs and similar singers' songs), plus a mix of singers you don't play yet. */
(() => {
  const CHANNEL = /\b(music|lyrics?|vevo|records|official|channel|tv|topic|hits|sounds?|vibes|songs)\b/i;
  // the singer of a song; for YouTube uploads like "Singer - Song (Lyrics)" by a lyrics channel, the part before " - "
  function singerOf(t) {
    if (!t) return "";
    let a = (t.artist || "").split(/,|&| feat\.? | ft\.? | x /i)[0].trim();
    if ((t.youtube || !a || CHANNEL.test(a)) && / [-–—] /.test(t.title || "")) a = t.title.split(/ [-–—] /)[0].trim();
    a = a.replace(/\s*-\s*topic$/i, "").replace(/vevo$/i, "").trim();
    return a.length > 1 && a.length < 60 && !CHANNEL.test(a) ? a : "";
  }
  // your singers, most listened first (recent plays count more than old ones, likes count too)
  function topSingers(n) {
    const score = new Map(), name = new Map();
    const add = (id, w) => { const a = singerOf(T(id)); if (!a) return; const k = a.toLowerCase(); score.set(k, (score.get(k) || 0) + w); if (!name.has(k)) name.set(k, a); };
    (settings.history || []).forEach((id, i) => add(id, 3 - i / 25));
    [...(lib.liked || [])].slice(-60).forEach(id => add(id, 1));
    return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => name.get(k));
  }
  window.topSingers = topSingers;

  window.recsHomeHTML = () => {
    const singers = topSingers(3);
    if (!singers.length) return "";
    const heard = new Set((settings.history || []).map(id => { const t = T(id); return t ? (t.title + "|" + singerOf(t)).toLowerCase() : ""; }));
    const mine = new Set(singers.map(s => s.toLowerCase()));
    let out = "", loading = false;
    const mix = [];
    singers.forEach((s, i) => {
      const c = oLoad("radio:" + s.toLowerCase(), "/api/online/radio?artist=" + encodeURIComponent(s), 3 * 3600e3);
      if (c.loading) { loading = true; return; }
      const tr = (c.data?.tracks || []).filter(t => !heard.has((t.title + "|" + (t.artist || "").split(",")[0].trim()).toLowerCase()));
      if (!tr.length) return;
      for (const t of tr) if (!mine.has((t.artist || "").split(",")[0].trim().toLowerCase())) mix.push(t);
      if (i < 2) {
        const key = "recs" + i, ids = registerOnline(tr.slice(0, 18));
        setList(key, ids, { type: "chart", id: key, name: "More like " + s });
        out += `<h2 class="sec">More like ${esc(s)} <span class="hint">songs in the same style</span></h2><div class="row-scroll">${ids.map((id, j) => songTile(id, key, j)).join("")}</div>`;
      }
    });
    if (mix.length >= 4) {
      const seen = new Set(), pick = [];
      for (let i = 0; i < mix.length && pick.length < 20; i++) { const t = mix[(i * 7) % mix.length]; const k = (t.title + "|" + t.artist).toLowerCase(); if (!seen.has(k)) { seen.add(k); pick.push(t); } }
      const ids = registerOnline(pick);
      setList("recsmix", ids, { type: "chart", id: "recsmix", name: "Suggested for you" });
      out = `<h2 class="sec">Suggested for you <span class="hint">singers you might like</span></h2><div class="row-scroll">${ids.map((id, j) => songTile(id, "recsmix", j)).join("")}</div>` + out;
    }
    if (loading && !out) out = `<h2 class="sec">Suggested for you</h2>${skeletonRow()}`;
    return out;
  };
})();
