"use strict";
/* Nagham – Karaoke Studio: pick a song, sing into your microphone, get a score, show your friends.
   HOW THE SCORE WORKS (be honest about it): Nagham listens to your microphone while the lyrics scroll.
   For every timed lyric line it checks (1) did you actually sing during that line and (2) was your voice steady (held notes, not noise).
   It does NOT compare your notes to the singer's melody — there is no reference melody to compare to — so it is a "did you sing along" score, not a pitch-perfect judge. */
(() => {
  const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const keyOf = (title, artist) => norm(title) + "|" + norm(String(artist || "").split(",")[0]);
  const scores = () => (settings.kScores = settings.kScores || {});
  const keyOfId = id => { const t = T(id); return t ? keyOf(t.title, t.artist === "Unknown artist" ? "" : t.artist) : null; };
  const stars = s => s >= 90 ? 5 : s >= 75 ? 4 : s >= 55 ? 3 : s >= 35 ? 2 : s >= 15 ? 1 : 0;
  const grade = s => s >= 90 ? "Superstar!" : s >= 75 ? "Great singing" : s >= 55 ? "Good job" : s >= 35 ? "Nice try" : "Keep practising";
  const starStr = s => "★".repeat(stars(s)) + "☆".repeat(5 - stars(s));

  /* ---------------------------------------------------------------- scoring session */
  const SING = { on: false, id: null, stream: null, ctx: null, an: null, buf: null, iv: 0, floor: .012, lines: {}, level: 0, noMic: false, scoring: false, done: false, lastHz: 0, token: 0, pid: null, rec: null, cam: null, hasCam: false };
  window.SING = SING; window.pitchOf = pitchOf;

  /* pitch by autocorrelation; returns {hz, clarity} */
  function pitchOf(buf, sr) {
    const n = buf.length, minLag = Math.floor(sr / 900), maxLag = Math.min(Math.floor(sr / 75), n >> 1);
    let r0 = 0; for (let i = 0; i < n; i++) r0 += buf[i] * buf[i];
    if (r0 < 1e-7) return { hz: 0, clarity: 0 };
    const r = new Float32Array(maxLag + 2); let best = 0, bl = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0; for (let i = 0; i < n - lag; i += 2) s += buf[i] * buf[i + lag];
      r[lag] = (s * 2 / r0) * (n / (n - lag)); if (r[lag] > best) { best = r[lag]; bl = lag; }
    }
    if (best < .3) return { hz: 0, clarity: best };
    // the strongest peak is often a whole number of periods — walk down to the shortest one that is nearly as strong
    for (const d of [4, 3, 2]) {
      const c = Math.round(bl / d); if (c < minLag) continue;
      let m = 0, ml = 0; for (let l = Math.max(minLag, c - 3); l <= Math.min(maxLag, c + 3); l++) if (r[l] > m) { m = r[l]; ml = l; }
      if (m >= best * .8) { bl = ml; break; }
    }
    return { hz: sr / bl, clarity: best };
  }

  const textLines = () => LYR.lines.map((l, i) => ({ i, ...l })).filter(l => String(l.text || "").replace(/[♪♫\s•.-]/g, ""));
  function lineSpan(i) {
    const L = LYR.lines[i], nx = LYR.lines[i + 1], slot = nx ? nx.t - L.t : 4;
    const total = String(L.text).split(/\s+/).filter(Boolean).reduce((a, w) => a + w.length + 1, 0) || 1;
    return Math.max(.8, Math.min(total / 12, slot * .95));
  }

  function tick() {
    if (!SING.on || !SING.an) return;
    SING.an.getFloatTimeDomainData(SING.buf);
    let s = 0; for (let i = 0; i < SING.buf.length; i++) s += SING.buf[i] * SING.buf[i];
    const rms = Math.sqrt(s / SING.buf.length); SING.level = rms;
    const p = rms > SING.floor ? pitchOf(SING.buf, SING.ctx.sampleRate) : { hz: 0, clarity: 0 };
    const voiced = p.hz > 0 && p.clarity > .5;
    if (!SING.scoring || E.paused || LYR.state !== "synced" || LYR.id !== SING.pid) { hud(); return; }
    const t = E.time || 0; let i = -1;
    for (let k = 0; k < LYR.lines.length; k++) { if (LYR.lines[k].t <= t) i = k; else break; }
    if (i < 0) { hud(); return; }
    const L = LYR.lines[i], rec = (SING.lines[i] ||= { v: 0, st: 0, prev: 0, span: lineSpan(i) });
    if (t - L.t <= rec.span + .7) {
      if (voiced) {
        rec.v += .08;
        if (rec.prev && Math.abs(12 * Math.log2(p.hz / rec.prev)) < 1.6) rec.st += .08;
        rec.prev = p.hz;
      }
    }
    hud();
  }
  const lineScore = rec => {
    if (!rec) return 0;
    const cov = Math.min(1, rec.v / (rec.span * .55));
    const steady = rec.v > .25 ? Math.min(1, rec.st / rec.v) : 0;
    return Math.round(100 * (.75 * cov + .25 * steady * cov));
  };
  function result() {
    const tl = textLines(); if (!tl.length) return null;
    const last = Math.max(...Object.keys(SING.lines).map(Number), -1);
    const reached = tl.filter(l => l.i <= last);
    const per = tl.map(l => l.i <= last ? lineScore(SING.lines[l.i]) : null);
    const used = per.filter(x => x != null);
    return { score: used.length ? Math.round(used.reduce((a, b) => a + b, 0) / used.length) : 0, reached: reached.length, total: tl.length, per };
  }

  /* ---------------------------------------------------------------- HUD: countdown, live meter, stop */
  function hudEl() {
    let h = $("#singHud");
    if (!h) { h = document.createElement("div"); h.id = "singHud"; document.body.appendChild(h); }
    return h;
  }
  function hud(msg) {
    const h = hudEl();
    if (!SING.on) { h.classList.remove("on"); return; }
    h.classList.add("on");
    if (msg != null) h.dataset.msg = msg;
    const res = SING.scoring ? result() : null;
    const lv = Math.min(1, SING.level * 6);
    h.innerHTML = `<span class="sh-mic ${SING.noMic ? "off" : ""}">${MIC}</span>
      ${SING.noMic ? `<span class="sh-t">No microphone — singing without a score</span>`
        : `<span class="sh-bar"><i style="transform:scaleX(${lv.toFixed(2)})"></i></span><span class="sh-t">${h.dataset.msg || (SING.scoring ? "Score so far <b>" + (res ? res.score : 0) + "</b>" : "No timed lyrics for this song — sing for fun, no score")}</span>`}
      <button class="btn ghost sm" data-singstop>Stop</button>`;
  }

  const recWanted = () => settings.kRec !== false;
  async function micOpen(local) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This window can't use a microphone");
    // songs from the PC are mixed into the video digitally, so the mic can cancel the speakers.
    // streamed songs can't be captured — with recording on, the mic is left open so it also hears the music from your speakers.
    const audioC = { echoCancellation: local || !recWanted(), noiseSuppression: false, autoGainControl: false };
    let stream = null; SING.hasCam = false;
    if (recWanted()) {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: audioC, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } }); SING.hasCam = stream.getVideoTracks().length > 0; }
      catch (e) { stream = null; SING.camErr = e; }
    }
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioC });
      if (recWanted()) toast("No camera (or it's blocked) — singing without a video");
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const an = ctx.createAnalyser(); an.fftSize = 2048; ctx.createMediaStreamSource(stream).connect(an); // not connected to the speakers → no echo
    Object.assign(SING, { stream, ctx, an, buf: new Float32Array(an.fftSize) });
  }
  function micClose() {
    clearInterval(SING.iv); SING.iv = 0;
    try { SING.stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { SING.ctx?.close(); } catch {}
    Object.assign(SING, { stream: null, ctx: null, an: null, buf: null });
  }

  /* ---------------------------------------------------------------- video of you singing
     camera + the current lyric line are drawn on a canvas; the sound is your microphone, plus the song itself when it
     plays from your iPhone (streamed songs can't be captured, the microphone just hears them from the speakers). */
  function recStart(title, artist) {
    if (!SING.hasCam || !window.MediaRecorder) return;
    const W = 1280, H = 720;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; cv.id = "singCam"; document.body.appendChild(cv);
    const vid = document.createElement("video"); vid.muted = true; vid.playsInline = true; vid.srcObject = new MediaStream(SING.stream.getVideoTracks()); vid.play().catch(() => {});
    const g = cv.getContext("2d"), R = { cv, vid, chunks: [], raf: 0, nodes: [], started: Date.now() };
    const wrap = (text, maxW) => { const out = []; let line = ""; for (const w of String(text).split(/\s+/)) { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out.slice(0, 3); };
    const draw = () => {
      if (SING.rec !== R) return;
      g.fillStyle = "#0b0b14"; g.fillRect(0, 0, W, H);
      const vw = vid.videoWidth, vh = vid.videoHeight;
      if (vw && vh) { const sc = Math.max(W / vw, H / vh), dw = vw * sc, dh = vh * sc; g.drawImage(vid, (W - dw) / 2, (H - dh) / 2, dw, dh); }
      let gr = g.createLinearGradient(0, H * .5, 0, H); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.82)"); g.fillStyle = gr; g.fillRect(0, H * .5, W, H * .5);
      gr = g.createLinearGradient(0, 0, 0, 120); gr.addColorStop(0, "rgba(0,0,0,.6)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, 120);
      g.textBaseline = "top"; g.textAlign = "left"; g.fillStyle = "#fff"; g.font = "700 30px Inter, 'Segoe UI', sans-serif"; g.fillText(title, 32, 24, W - 320);
      g.font = "500 20px Inter, 'Segoe UI', sans-serif"; g.fillStyle = "rgba(255,255,255,.75)"; g.fillText(artist, 32, 62, W - 320);
      g.textAlign = "right"; g.font = "700 20px Inter, 'Segoe UI', sans-serif"; g.fillStyle = "rgba(255,255,255,.8)"; g.fillText("Nagham Karaoke", W - 32, 26);
      if (SING.scoring) { const r = result(); g.font = "800 34px Inter, 'Segoe UI', sans-serif"; g.fillStyle = "#ffc94a"; g.fillText("★ " + (r ? r.score : 0), W - 32, 54); }
      // lyrics: the line being sung, and the next one
      const pid = SING.pid;
      if (LYR.state === "synced" && LYR.id === pid) {
        const t = (E.time || 0) + (typeof lyrOff === "function" ? lyrOff() : 0); let i = -1;
        for (let k = 0; k < LYR.lines.length; k++) { if (LYR.lines[k].t <= t) i = k; else break; }
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        const cur = i >= 0 ? LYR.lines[i].text : "", nxt = LYR.lines[i + 1]?.text || "";
        g.font = "800 46px Inter, 'Segoe UI', sans-serif"; const ls = wrap(cur || "• • •", W - 140); let y = H - 96 - (ls.length - 1) * 54;
        g.shadowColor = "rgba(0,0,0,.8)"; g.shadowBlur = 12; g.fillStyle = "#fff"; for (const l of ls) { g.fillText(l, W / 2, y); y += 54; }
        g.font = "600 26px Inter, 'Segoe UI', sans-serif"; g.fillStyle = "rgba(255,255,255,.6)"; if (nxt) g.fillText(wrap(nxt, W - 200)[0], W / 2, H - 40);
        g.shadowBlur = 0;
      }
      R.raf = requestAnimationFrame(draw);
    };
    // sound for the video
    let audioTrack = null;
    try {
      if (E.mode === "audio" && typeof eqInit === "function" && eqInit() && window.eqTail) {
        const dest = eqCtx.createMediaStreamDestination(); window.eqTail.connect(dest);
        const mic = eqCtx.createMediaStreamSource(new MediaStream(SING.stream.getAudioTracks())), mg = eqCtx.createGain(); mg.gain.value = 1.4; mic.connect(mg); mg.connect(dest);
        R.nodes.push(() => { try { window.eqTail.disconnect(dest); } catch {} try { mic.disconnect(); mg.disconnect(); } catch {} }); R.mixed = true;
        if (eqCtx.state !== "running") eqCtx.resume().catch(() => {});
        audioTrack = dest.stream.getAudioTracks()[0];
      }
    } catch (e) { postLog("karaoke mix: " + e); }
    if (!audioTrack) audioTrack = SING.stream.getAudioTracks()[0];
    const out = new MediaStream([cv.captureStream(30).getVideoTracks()[0], ...(audioTrack ? [audioTrack] : [])]);
    const mime = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(m => MediaRecorder.isTypeSupported(m)) || "";
    try { R.mr = new MediaRecorder(out, { mimeType: mime || undefined, videoBitsPerSecond: 2500000, audioBitsPerSecond: 160000 }); }
    catch (e) { postLog("karaoke recorder: " + e); cv.remove(); toast("This PC can't record video here — singing without a video"); return; }
    R.mime = R.mr.mimeType || mime || "video/webm";
    R.mr.ondataavailable = e => { if (e.data && e.data.size) R.chunks.push(e.data); };
    SING.rec = R; R.mr.start(1000); draw();
  }
  /* stops the recorder and gives back the finished video (or null) */
  function recStop(discard) {
    const R = SING.rec; SING.rec = null;
    if (!R) return Promise.resolve(null);
    cancelAnimationFrame(R.raf);
    return new Promise(res => {
      const fin = () => {
        R.nodes.forEach(f => f()); try { R.vid.srcObject = null; } catch {} R.cv.remove();
        const secs = (Date.now() - R.started) / 1000;
        res(discard || !R.chunks.length || secs < 4 ? null : { blob: new Blob(R.chunks, { type: R.mime.split(";")[0] }), ext: /mp4/.test(R.mime) ? "mp4" : "webm", mixed: !!R.mixed, secs });
      };
      if (R.mr.state === "inactive") return fin();
      R.mr.onstop = fin; try { R.mr.stop(); } catch { fin(); }
      setTimeout(fin, 3000);
    });
  }

  /* streamed songs can't have the singer removed, so Nagham looks for a real instrumental release of the same song */
  async function findInstrumental(id) {
    const t = T(id); if (!t || !t.online) return null;
    try {
      const artist = String(t.artist || "").split(",")[0];
      const r = await Promise.race([api("/api/online/search?country=" + settings.country + "&q=" + encodeURIComponent(`${artist} ${t.title} instrumental`)), sleep(7000).then(() => null)]);
      const want = norm(t.title), d0 = t.fullDuration || t.duration || 0;
      const c = (r?.tracks || []).find(x => { const n = norm(x.title); return /\b(instrumental|karaoke)\b/.test(n) && n.includes(want) && (!d0 || !x.duration || Math.abs(x.duration - d0) <= 3); });
      if (!c) return null;
      registerOnline([c]);
      return c.id;
    } catch { return null; }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function singStart(id) {
    const t = T(id); if (!t) return;
    if (SING.on) singStop(true);
    const my = ++SING.token;
    Object.assign(SING, { on: true, id, pid: id, lines: {}, level: 0, noMic: false, scoring: false, done: false, hasCam: false, inst: false });
    const local = !t.online;
    hud(recWanted() ? "Getting the microphone and camera ready…" : "Getting the microphone ready…");
    try { await micOpen(local); }
    catch (e) {
      SING.noMic = true;
      const denied = /denied|NotAllowed|permission/i.test(e?.name + " " + e?.message);
      toast(denied ? "Microphone is blocked — allow it for Nagham in Windows Settings → Privacy → Microphone. Singing without a score." : "No microphone found — singing without a score");
    }
    if (my !== SING.token) return;
    if (!SING.noMic) {
      hud("Stay quiet for a second…");
      const vals = []; const end = Date.now() + 1200;
      SING.iv = setInterval(() => { SING.an.getFloatTimeDomainData(SING.buf); let s = 0; for (const x of SING.buf) s += x * x; vals.push(Math.sqrt(s / SING.buf.length)); }, 60);
      await sleep(Math.max(0, end - Date.now())); clearInterval(SING.iv); SING.iv = 0;
      if (my !== SING.token) return;
      vals.sort((a, b) => a - b);
      SING.floor = Math.max(.006, (vals[Math.floor(vals.length * .9)] || .003) * 2.6);
    }
    // music only: songs on the PC get the singer removed live; for streamed songs look for an instrumental release
    let pid = id;
    SING.pid = pid;
    for (let c = 3; c >= 1; c--) { hud("Get ready… " + c); await sleep(700); if (my !== SING.token) return; }
    KAR_STATE.open = true; // Karaoke's own "music only" setting must already count when the player is chosen for this song
    playContext([pid], 0, { type: "karaoke", id: "sing", name: "Karaoke" });
    karOpen(true);
    hud("");
    if (SING.hasCam) { await sleep(350); if (my !== SING.token) return; recStart(t.title, t.artist); } // the song's sound engine needs a moment to be chosen
    // timed lyrics needed for a score
    loadLyrics(pid);
    for (let w = 0; w < 48 && (LYR.id !== pid || LYR.state === "loading" || LYR.state === "idle"); w++) { await sleep(250); if (my !== SING.token) return; }
    SING.scoring = !SING.noMic && LYR.state === "synced" && LYR.id === pid;
    if (!SING.noMic && !SING.scoring) toast("This song has no timed lyrics, so it can't be scored — sing for fun!");
    if (!SING.noMic) SING.iv = setInterval(() => { tick(); finishCheck(); }, 80);
    else SING.iv = setInterval(finishCheck, 500);
    hud("");
  }
  function finishCheck() {
    if (!SING.on || SING.done) return;
    if (P.current !== SING.pid) { singStop(false, "You changed the song"); return; }
    const d = E.duration || 0;
    if (d && (E.time || 0) >= d - 1.2) singStop(false);
  }
  function singStop(silent, why) {
    if (!SING.on) return;
    SING.done = true; SING.token++;
    const res = SING.scoring ? result() : null, id = SING.id;
    clearInterval(SING.iv); SING.iv = 0;
    const video = recStop(silent); // needs the camera for one more moment
    video.then(() => micClose());
    SING.on = false; hud();
    if (silent) return;
    if (why) toast(why);
    video.then(v => { if (res || v) showResult(id, res, v); if (KAR.open) karOpen(false); });
  }

  /* ---------------------------------------------------------------- result */
  function showResult(id, res, video) {
    const t = T(id); if (!t) return;
    const enough = !!res && res.reached / res.total >= .6 && res.reached >= 3;
    let best = false, prevBest = 0;
    if (enough) {
      const k = keyOfId(id), cur = scores()[k] || { best: 0, plays: 0 };
      prevBest = cur.best; best = res.score > cur.best;
      scores()[k] = { t: t.title, a: t.artist === "Unknown artist" ? "" : t.artist, best: Math.max(cur.best, res.score), last: res.score, plays: cur.plays + 1, ts: Date.now(), ref: songRef(id) };
      saveUser();
    }
    const bars = res ? res.per.map(p => `<i style="height:${p == null ? 4 : Math.max(6, p * .5)}px;opacity:${p == null ? .25 : 1}"></i>`).join("") : "";
    $("#singRes")?.remove();
    const el = document.createElement("div"); el.id = "singRes";
    const url = video ? URL.createObjectURL(video.blob) : "";
    el.innerHTML = `<div class="sr-card ${video ? "wide" : ""}">
      <div class="sr-song"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>
      ${video ? `<video class="sr-video" src="${url}" controls playsinline></video><div class="sr-vst" id="srVst"><i class="spin"></i>Saving your video…</div>` : ""}
      ${enough ? `<div class="sr-score" data-to="${res.score}">0</div><div class="sr-stars">${starStr(res.score)}</div><div class="sr-grade">${grade(res.score)}${best ? ' <em>New best!</em>' : prevBest ? ` <small>(best ${prevBest})</small>` : ""}</div>`
        : res ? `<div class="sr-grade" style="margin:16px 0">You stopped early (${res.reached} of ${res.total} lines) — not enough to give a score, so no score was saved.</div>`
        : `<div class="sr-grade" style="margin:12px 0">No score for this one (it needs timed lyrics and a microphone)</div>`}
      ${res ? `<div class="sr-bars" title="Each bar is one line of the song">${bars}</div>
      <p class="sr-note">The score shows how much you sang along and how steady your voice was on each lyric line. It doesn't compare your notes to the singer's melody. Headphones give a fairer score.</p>` : ""}
      <div class="sr-btns"><button class="btn ghost" data-srclose>Close</button>${video ? `<button class="btn ghost" data-sropen>Open videos folder</button>` : ""}<button class="btn ghost" data-srshare>Send score to friends</button><button class="btn accent" data-srsing="${esc(id)}">Sing again</button></div></div>`;
    el._url = url;
    document.body.appendChild(el);
    if (enough) { const n = $(".sr-score", el); let c = 0; const iv = setInterval(() => { c = Math.min(res.score, c + Math.max(1, Math.round(res.score / 30))); n.textContent = c; if (c >= res.score) clearInterval(iv); }, 30); }
    requestAnimationFrame(() => el.classList.add("on"));
    if (video) {
      const name = `${t.title}${t.artist && t.artist !== "Unknown artist" ? " - " + t.artist.split(",")[0] : ""}`;
      fetch(`/api/karaoke/save?ext=${video.ext}&name=${encodeURIComponent(name)}`, { method: "POST", body: video.blob })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
        .then(j => { const s = $("#srVst"); if (s) s.innerHTML = `Video saved in <b>${esc(j.dir)}</b>${video.mixed ? "" : "<br><small>This song is streamed, so the video's sound is only what your microphone heard.</small>"}`; })
        .catch(e => { const s = $("#srVst"); if (s) { s.classList.add("warn"); s.textContent = "Couldn't save the video: " + (e.message || e); } });
    }
  }
  const closeRes = () => { const el = $("#singRes"); if (!el) return; try { $("video", el)?.pause(); if (el._url) URL.revokeObjectURL(el._url); } catch {} el.remove(); };

  /* ---------------------------------------------------------------- the Karaoke page */
  const allIds = () => {
    const s = new Set(lib.tracks.map(t => t.id));
    lib.liked.forEach(id => s.add(id));
    lib.playlists.forEach(p => p.tracks.forEach(id => s.add(id)));
    return [...s].filter(id => T(id));
  };
  const rowHTML = id => {
    const t = T(id), sc = scores()[keyOfId(id)];
    const local = !t.online;
    return `<div class="sg-row" data-sgid="${esc(id)}"><div class="art">${trackArt(id, true)}</div>
      <div class="m"><b>${esc(t.title)}</b><span>${esc(t.artist)}${local ? "" : " · streamed"}</span></div>
      ${sc ? `<span class="sg-best" title="Your best score">${starStr(sc.best)} <b>${sc.best}</b></span>` : ""}
      <button class="btn accent sm" data-singgo="${esc(id)}">${MIC}Sing</button></div>`;
  };
  function listHTML(q) {
    let ids = allIds(); const n = norm(q || "");
    if (n) ids = ids.filter(id => { const t = T(id); return norm(t.title + " " + t.artist).includes(n); });
    ids.sort((a, b) => (scores()[keyOfId(b)]?.ts || 0) - (scores()[keyOfId(a)]?.ts || 0) || T(a).title.localeCompare(T(b).title));
    return ids.length ? ids.slice(0, 120).map(rowHTML).join("") + (ids.length > 120 ? `<p class="muted" style="text-align:center">Type to find more of your ${ids.length} songs</p>` : "")
      : `<div class="empty" style="padding:30px 0"><p>${n ? "No song matches" : "Add songs to your library first, then come back to sing"}</p></div>`;
  }
  function boardHTML() {
    const me = scores(), friends = settings.friends || [], map = new Map();
    const put = (k, title, artist, who, s, ref) => { if (!map.has(k)) map.set(k, { title, artist, ref, rows: [] }); map.get(k).rows.push({ who, s }); };
    Object.entries(me).forEach(([k, v]) => put(k, v.t, v.a, settings.userName || "You", v.best, v.ref));
    friends.forEach(f => (f.k || []).forEach(x => put(keyOf(x[0], x[1]), x[0], x[1], f.name, x[2], x[4])));
    const items = [...map.entries()].filter(([, v]) => v.rows.length).sort((a, b) => b[1].rows.length - a[1].rows.length || Math.max(...b[1].rows.map(r => r.s)) - Math.max(...a[1].rows.map(r => r.s))).slice(0, 30);
    if (!items.length) return `<div class="empty" style="padding:24px 0"><p>No scores yet — sing a song above, then send your code to friends from <b>Friends</b>.</p></div>`;
    return items.map(([k, v]) => {
      v.rows.sort((a, b) => b.s - a.s);
      return `<div class="sg-board"><div class="sg-bh"><b>${esc(v.title)}</b><span class="muted">${esc(v.artist || "")}</span><button class="btn ghost sm" data-singref="${esc(k)}">${MIC}Sing</button></div>
        ${v.rows.map((r, i) => `<div class="sg-brow ${r.who === (settings.userName || "You") ? "me" : ""}"><span class="sg-rk">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span><span class="sg-bn">${esc(r.who)}</span><span class="sg-bs">${starStr(r.s)}</span><b>${r.s}</b></div>`).join("")}</div>`;
    }).join("");
  }
  VIEWS_EXTRA.sing = () => `<div class="pad fade-in sg-page">
    <div class="sg-hero"><div class="sg-ic">${MIC}</div><div><h1 class="greet" style="margin:0">Karaoke Studio <span class="muted" style="font-size:16px">كاريوكي</span></h1>
      <p class="muted" style="margin:6px 0 0">Pick a song, sing into your microphone and get a score. Your friends see your songs and scores when you send them your code.</p></div></div>
    <div class="sg-tips"><span>🎧 Headphones give a fairer score</span><span>🎵 Karaoke plays the music only — your normal listening isn't changed</span><span>📜 Scoring needs songs that have timed lyrics</span><span>💻 Songs on your iPhone give the cleanest result</span></div>
    <div class="sg-rec"><label><input type="checkbox" id="singRec" ${settings.kRec !== false ? "checked" : ""}><b>Record a video of me singing</b><span class="muted">camera + the lyrics, saved in Videos › Nagham Karaoke</span></label><button class="btn ghost sm" data-singvids>My videos</button></div>
    <div class="field" style="margin:14px 0"><input class="input" id="singQ" placeholder="Search your songs…" autocomplete="off" spellcheck="false"></div>
    <div id="singList" class="sg-list">${listHTML("")}</div>
    <h3 style="margin:30px 0 10px">Scoreboard</h3><div id="singBoard">${boardHTML()}</div>
    <p class="muted" style="font-size:13px;margin-top:18px">Nagham has no server, so friends' scores update when they send you a new code (your name → Friends → Share my profile).</p></div>`;

  /* ---------------------------------------------------------------- friends integration */
  window.karaokeShareList = () => Object.values(scores()).filter(v => !isPrivateRef(v)).sort((a, b) => b.ts - a.ts).slice(0, 40).map(v => [v.t, v.a, v.best, v.ts, v.ref]);
  function isPrivateRef(v) { return lib.tracks.some(t => (settings.privateIds || []).includes(t.id) && keyOf(t.title, t.artist) === keyOf(v.t, v.a)); }

  /* ---------------------------------------------------------------- wiring */
  document.addEventListener("click", async e => {
    const t = e.target;
    const go_ = t.closest("[data-singgo]"); if (go_) return singStart(go_.dataset.singgo);
    if (t.closest("[data-singstop]")) return singStop(false);
    const sr = t.closest("[data-srsing]"); if (sr) { closeRes(); return singStart(sr.dataset.srsing); }
    if (t.closest("[data-srclose]")) { closeRes(); return; }
    if (t.closest("[data-sropen]")) { api("/api/karaoke/open").catch(() => {}); return; }
    if (t.closest("[data-singvids]")) { api("/api/karaoke/open").catch(() => {}); return; }
    if (t.closest("[data-srshare]")) { closeRes(); return typeof shareProfileDialog === "function" && shareProfileDialog(); }
    const rf = t.closest("[data-singref]");
    if (rf) {
      const k = rf.dataset.singref; const mine = allIds().find(id => keyOfId(id) === k);
      if (mine) return singStart(mine);
      const f = (settings.friends || []).find(f => (f.k || []).some(x => keyOf(x[0], x[1]) === k)), x = f?.k.find(x => keyOf(x[0], x[1]) === k);
      const b = rf; b.disabled = true;
      try { const id = x && await resolveRef(x[4] || [x[0], x[1]]); if (id) singStart(id); else toast("Couldn't find that song — check your internet"); } finally { b.disabled = false; }
    }
  });
  document.addEventListener("change", e => { if (e.target.id === "singRec") { settings.kRec = e.target.checked; saveUser(); } });
  document.addEventListener("input", e => { if (e.target.id === "singQ") { $("#singList").innerHTML = listHTML(e.target.value); } });
  // the result card closes with Esc like everything else
  if (typeof escapeStep === "function") { const es = escapeStep; escapeStep = function (typing, target) { if ($("#singRes")) { closeRes(); return true; } if (SING.on) { singStop(false); return true; } return es.call(this, typing, target); }; }

  /* ---------- menu entry + styles */
  const settingsLink = $('[data-nav="settings"]');
  IC.mic = MIC; // Karaoke lives in the menu under your name (top right), next to Friends
  const st = document.createElement("style");
  st.textContent = `
.sg-hero{display:flex;gap:18px;align-items:center;margin-bottom:14px}.sg-ic{width:64px;height:64px;border-radius:20px;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 40%,#ff4f9a));color:#fff;flex:none}.sg-ic svg{width:32px;height:32px}
.sg-tips{display:flex;flex-wrap:wrap;gap:8px}.sg-tips span{font-size:13px;padding:6px 12px;border-radius:999px;background:var(--input)}
.sg-list{display:flex;flex-direction:column;gap:4px}.sg-row{display:flex;gap:12px;align-items:center;padding:8px 10px;border-radius:12px}.sg-row:hover{background:var(--input)}
.sg-row .art{width:44px;height:44px;border-radius:8px;overflow:hidden;flex:none}.sg-row .art>*{width:100%;height:100%;object-fit:cover}.sg-row .m{flex:1;min-width:0;display:flex;flex-direction:column}.sg-row .m b,.sg-row .m span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sg-row .m span{font-size:13px;color:var(--muted)}
.sg-best{font-size:13px;color:#ffc94a;white-space:nowrap}.sg-best b{color:var(--text)}.sg-row .btn svg,.sg-bh .btn svg{width:15px;height:15px;margin-inline-end:5px}
.sg-board{padding:12px 14px;border-radius:16px;background:var(--input);margin-bottom:12px}.sg-bh{display:flex;gap:10px;align-items:center;margin-bottom:8px}.sg-bh b{flex:none}.sg-bh span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg-brow{display:flex;gap:10px;align-items:center;padding:5px 4px;border-radius:8px}.sg-brow.me{background:color-mix(in srgb,var(--accent) 18%,transparent)}.sg-rk{width:28px;text-align:center}.sg-bn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sg-bs{color:#ffc94a;font-size:13px}
#singHud{position:fixed;left:50%;bottom:104px;transform:translate(-50%,20px);z-index:130;display:none;align-items:center;gap:12px;padding:10px 14px;border-radius:999px;background:rgba(20,16,36,.88);backdrop-filter:blur(10px);color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.4);opacity:0;transition:.25s}
body.kar-open #singHud{bottom:auto;top:84px}
#singHud.on{display:flex;opacity:1;transform:translate(-50%,0)}.sh-mic{width:22px;height:22px;color:#ff6b9a}.sh-mic.off{opacity:.4}.sh-mic svg{width:100%;height:100%}
.sh-bar{width:90px;height:8px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden}.sh-bar i{display:block;height:100%;background:linear-gradient(90deg,#4ade80,#ffd24a,#ff6b81);transform-origin:left;transition:transform .08s}.sh-t{font-size:14px}
.sg-rec{display:flex;gap:12px;align-items:center;margin-top:14px;padding:10px 14px;border-radius:14px;background:var(--input)}.sg-rec label{flex:1;display:flex;gap:10px;align-items:center;cursor:pointer;flex-wrap:wrap}.sg-rec input{width:18px;height:18px;accent-color:var(--accent)}.sg-rec span{font-size:13px}
#singCam{position:fixed;right:22px;bottom:118px;width:260px;height:auto;aspect-ratio:16/9;border-radius:14px;z-index:131;box-shadow:0 10px 40px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.25);pointer-events:none}
.sr-card{max-height:94vh;overflow:auto}.sr-card.wide{width:min(600px,94vw)}.sr-video{width:100%;border-radius:14px;margin-top:12px;background:#000;max-height:44vh}.sr-vst{font-size:13px;opacity:.85;margin-top:8px;display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap}.sr-vst.warn{color:#ff8a9c}.sr-card.wide .sr-score{font-size:60px}
#singRes{position:fixed;inset:0;z-index:160;display:grid;place-items:center;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);opacity:0;transition:opacity .3s}#singRes.on{opacity:1}
.sr-card{width:min(440px,92vw);padding:26px;border-radius:24px;background:linear-gradient(160deg,#2a1b4d,#120c24);color:#fff;text-align:center;transform:scale(.92);transition:transform .35s cubic-bezier(.2,1.3,.4,1)}#singRes.on .sr-card{transform:none}
.sr-song b{display:block;font-size:19px}.sr-song span{opacity:.7;font-size:14px}.sr-score{font-size:84px;font-weight:900;line-height:1.1;margin-top:10px;background:linear-gradient(135deg,#fff,#ffc94a);-webkit-background-clip:text;color:transparent}
.sr-stars{font-size:28px;color:#ffc94a;letter-spacing:4px}.sr-grade{font-size:18px;font-weight:700;margin-top:4px}.sr-grade em{font-style:normal;color:#4ade80;margin-inline-start:6px}.sr-grade small{opacity:.6;font-weight:400}
.sr-bars{display:flex;align-items:flex-end;gap:3px;height:52px;margin:16px 4px 6px;justify-content:center}.sr-bars i{flex:1;max-width:14px;border-radius:3px;background:linear-gradient(0deg,#a970ff,#ff6b9a)}
.sr-note{font-size:12px;opacity:.6;margin:10px 0 16px}.sr-btns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}`;
  document.head.appendChild(st);
})();
