package main

// "For you" from your own YouTube Music account — without any sign-in callback (no webhook, no keys).
// You sign in to YouTube Music inside Nagham's own window (a hidden YouTube Music page, the same kind
// that plays songs). Nagham then asks that page for your home feed, the same way the YouTube Music
// site asks for it, and shows it. Your password and cookies never leave that page.

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

type acctReq struct {
	Seq  int    `json:"seq"`
	Kind string `json:"kind"` // "home" | "queue" | "status"
	ID   string `json:"id"`   // queue: the playlist id
	V    string `json:"v"`    // queue: a song to start from (optional)
	B    string `json:"b"`    // queue: an album / playlist page, when its playlist id isn't known
	Svc  string `json:"svc"`  // "yt" (YouTube Music, the default) | "sp" (Spotify)
	Type string `json:"type"` // Spotify queue: "playlist" | "album"
}

var (
	acctResMu sync.Mutex
	acctRes   = map[int]json.RawMessage{}
	acctResAt = map[int]time.Time{}
)

// POST /api/yt/acct {open, show, rect, nav, req:{kind,id,v}}
func ytAcctHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Open *bool    `json:"open"`
		Show *bool    `json:"show"`
		Rect *[4]int  `json:"rect"`
		Nav  string   `json:"nav"`
		Req  *acctReq `json:"req"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req)
	native := nativeWindowActive.Load() || os.Getenv("NAGHAM_FAKE_NATIVE") != ""
	wsMu.Lock()
	changed := false
	seq := 0
	if req.Open != nil {
		wsCur.AcctOpen = *req.Open
		changed = true
	}
	if req.Show != nil {
		wsCur.AcctShow = *req.Show
		if *req.Show {
			wsCur.AcctOpen = true
		}
		changed = true
	}
	if req.Rect != nil {
		wsCur.AcctRect = *req.Rect
		changed = true
	}
	if req.Nav != "" {
		wsCur.AcctNav = req.Nav
		wsCur.AcctNavSeq++
		wsCur.AcctOpen = true
		changed = true
	}
	if req.Req != nil && (req.Req.Kind == "home" || req.Req.Kind == "queue" || req.Req.Kind == "status" || req.Req.Kind == "check") {
		wsCur.AcctReqSeq++
		seq = wsCur.AcctReqSeq
		q := *req.Req
		q.Seq = seq
		wsCur.AcctReqs = append(wsCur.AcctReqs, q)
		if n := len(wsCur.AcctReqs); n > 6 {
			wsCur.AcctReqs = append([]acctReq(nil), wsCur.AcctReqs[n-6:]...)
		}
		changed = true
	}
	if changed {
		wsCur.V++
		wsCond.Broadcast()
	}
	wsMu.Unlock()
	writeJSON(w, map[string]any{"ok": true, "native": native, "seq": seq})
}

// GET /api/yt/acct/result?seq=N — the page's answer (or {"wait":true});  POST: the window hands it in
func ytAcctResult(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		var in struct {
			Seq  int             `json:"seq"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&in); err != nil || in.Seq <= 0 {
			http.Error(w, "bad result", 400)
			return
		}
		acctResMu.Lock()
		acctRes[in.Seq], acctResAt[in.Seq] = in.Data, time.Now()
		for k, t := range acctResAt { // keep only recent answers
			if time.Since(t) > 10*time.Minute {
				delete(acctRes, k)
				delete(acctResAt, k)
			}
		}
		acctResMu.Unlock()
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	seq, _ := strconv.Atoi(r.URL.Query().Get("seq"))
	acctResMu.Lock()
	d, ok := acctRes[seq]
	acctResMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if !ok {
		io.WriteString(w, `{"wait":true}`)
		return
	}
	w.Write(d)
}

// runs inside the hidden YouTube Music page. __REQ__ is the request. It starts the work once and
// answers "" until the answer is ready (the window asks again every half second).
const acctJS = `(() => { try {
  const R = __REQ__;
  const S = window.__ngAcct || (window.__ngAcct = {});
  const k = 'r' + R.seq;
  if (S[k]) { if (S[k].done && !S[k].sent) { S[k].sent = 1; return S[k].out; } return ''; }
  const HOST = R.svc === 'sp' ? 'open.spotify.com' : 'music.youtube.com';
  const WANT = R.svc === 'sp' ? (R.kind === 'queue' ? '/' + R.type + '/' + R.id : R.kind === 'home' ? '/' : '') : '';
  if (R.kind === 'status' && location.host !== HOST) return JSON.stringify({ ok: true, loggedIn: false, at: location.host }); // (signing in: never move the page)
  if (location.host !== HOST || (WANT && location.pathname !== WANT)) { // the right site / page first
    if (!window.__ngNavAt || Date.now() - window.__ngNavAt > 15000) { window.__ngNavAt = Date.now(); location.href = 'https://' + HOST + (WANT || '/'); }
    return '';
  }
  if (R.svc === 'sp') {
    const login = document.querySelector('[data-testid="login-button"]'), user = document.querySelector('[data-testid="user-widget-link"]');
    if (!login && !user) return ''; // still loading
    if (R.kind === 'queue' && !document.querySelector('[data-testid="tracklist-row"]')) { window.__ngQ0 = window.__ngQ0 || Date.now(); if (Date.now() - window.__ngQ0 < 20000) return ''; }
    S[k] = { done: false };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const scroller = el => { for (let e = el; e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) return e; return document.scrollingElement; };
    const spRun = async () => {
      const loggedIn = !login && !!user, name = user ? (user.getAttribute('aria-label') || '') : '';
      if (R.kind === 'status' || R.kind === 'check') return { ok: true, loggedIn, name };
      if (R.kind === 'home') {
        if (!loggedIn) return { ok: true, loggedIn: false };
        const sc = scroller(document.querySelector('[data-testid="home-page"]') || document.body);
        for (let i = 0; i < 10; i++) { sc.scrollTop += sc.clientHeight || 800; await sleep(450); } // shelves further down load as they come into view
        sc.scrollTop = 0;
        const shelves = [...document.querySelectorAll('section[data-testid="component-shelf"]')].map(sec => {
          const items = [...sec.querySelectorAll('[data-encore-id="card"]')].map(c => {
            const m = (c.getAttribute('aria-labelledby') || '').match(/card-title-spotify:([a-z]+):([A-Za-z0-9]+)-\d+/); if (!m) return null;
            const tEl = document.getElementById(m[0]), sEl = document.getElementById(m[0].replace('card-title-', 'card-subtitle-'));
            const img = c.querySelector('img[data-testid="card-image"]') || c.querySelector('img');
            const links = sEl ? [...sEl.querySelectorAll('a')].map(x => x.textContent.trim()).filter(Boolean) : []; // (not the "E" explicit badge)
            const o = { title: (tEl ? tEl.textContent : '').trim(), sub: links.length ? links.join(', ') : (sEl ? sEl.textContent : '').trim(), th: img ? img.src : '', sp: m[2] };
            if (!o.title) return null;
            if (m[1] === 'track') return Object.assign(o, { t: 'song', artist: o.sub });
            if (m[1] === 'album' || m[1] === 'playlist' || m[1] === 'artist') return Object.assign(o, { t: m[1] });
            return null;
          }).filter(Boolean).slice(0, 30);
          return { title: ((sec.querySelector('h2') || {}).textContent || '').trim(), items };
        }).filter(x => x.title && x.items.length);
        return { ok: true, loggedIn, name, shelves, at: Date.now() };
      }
      if (R.kind === 'queue') {
        const rows = new Map();
        const grab = () => document.querySelectorAll('[data-testid="tracklist-row"]').forEach(r => {
          const a = r.querySelector('a[data-testid="internal-track-link"]'); if (!a) return;
          const id = ((a.getAttribute('href') || '').split('/track/')[1] || '').split('?')[0]; if (!id || rows.has(id)) return;
          const arts = [...new Set([...r.querySelectorAll('a[href^="/artist/"]')].map(x => x.textContent.trim()).filter(Boolean))];
          const dur = [...r.querySelectorAll('div')].map(d => d.textContent.trim()).find(t => /^\d+:\d\d$/.test(t)) || '';
          const img = r.querySelector('img');
          rows.set(id, { sp: id, title: a.textContent.trim(), artist: arts.join(', '), dur, th: img ? img.src : '' });
        });
        const sc = scroller(document.querySelector('[data-testid="tracklist-row"]') || document.body);
        for (let i = 0; i < 10; i++) { grab(); sc.scrollTop += (sc.clientHeight || 800) * 0.8; await sleep(500); }
        grab();
        return { ok: true, loggedIn: !login, songs: [...rows.values()].slice(0, 150) };
      }
      throw new Error('unknown');
    };
    spRun().then(o => { S[k].out = JSON.stringify(o); S[k].done = true; }, e => { S[k].out = JSON.stringify({ error: String((e && e.message) || e) }); S[k].done = true; });
    return '';
  }
  if (!window.ytcfg || !ytcfg.get || !ytcfg.get('INNERTUBE_API_KEY') || !ytcfg.get('INNERTUBE_CONTEXT')) return '';
  S[k] = { done: false };
  const txt = o => !o ? '' : (o.simpleText || (o.runs || []).map(r => r.text).join(''));
  const find = (o, key, out, d) => { out = out || []; d = d || 0;
    if (!o || typeof o !== 'object' || d > 45) return out;
    if (Array.isArray(o)) { for (const v of o) find(v, key, out, d + 1); return out; }
    for (const kk in o) { if (kk === key) out.push(o[kk]); else if (kk !== 'counterpart') find(o[kk], key, out, d + 1); }
    return out; };
  const thumb = o => { const t = find(o, 'thumbnails').find(a => Array.isArray(a) && a.length); return t ? t[t.length - 1].url : ''; };
  const pageType = e => ((e && e.browseEndpoint && e.browseEndpoint.browseEndpointContextSupportedConfigs && e.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig) || {}).pageType || '';
  const artistOf = t => {
    const runs = (t && t.runs) || [];
    const a = runs.filter(r => pageType(r.navigationEndpoint).includes('ARTIST')).map(r => r.text);
    if (a.length) return a.join(', ');
    const parts = txt(t).split(' • ').map(s => s.trim()).filter(s => s && !/^(song|video|single|album|ep|playlist|أغنية|فيديو)$/i.test(s) && !/views|plays|مشاهد|تشغيل/i.test(s));
    return parts[0] || '';
  };
  const item = it => {
    const two = it.musicTwoRowItemRenderer, row = it.musicResponsiveListItemRenderer;
    if (two) {
      const title = txt(two.title), sub = txt(two.subtitle), th = thumb(two.thumbnailRenderer), ne = two.navigationEndpoint || {};
      if (ne.watchEndpoint && ne.watchEndpoint.videoId) return { t: 'song', v: ne.watchEndpoint.videoId, title, sub, artist: artistOf(two.subtitle), th };
      const be = ne.browseEndpoint; if (!be) return null;
      const pt = pageType(ne);
      if (pt.includes('ARTIST')) return { t: 'artist', title, sub, th, b: be.browseId };
      const play = find(two.thumbnailOverlay, 'playNavigationEndpoint')[0] || {};
      const list = (play.watchPlaylistEndpoint && play.watchPlaylistEndpoint.playlistId) || (play.watchEndpoint && play.watchEndpoint.playlistId) || (String(be.browseId).startsWith('VL') ? be.browseId.slice(2) : '');
      return { t: pt.includes('ALBUM') ? 'album' : 'playlist', title, sub, th, list, b: be.browseId };
    }
    if (row) {
      const cols = (row.flexColumns || []).map(c => (c.musicResponsiveListItemFlexColumnRenderer || {}).text);
      const v = (row.playlistItemData && row.playlistItemData.videoId) || find(row, 'watchEndpoint').map(w => w && w.videoId).find(Boolean);
      if (!v) return null;
      return { t: 'song', v, title: txt(cols[0]), sub: txt(cols[1]), artist: artistOf(cols[1]), th: thumb(row.thumbnail) };
    }
    return null;
  };
  const shelves = data => find(data, 'musicCarouselShelfRenderer').map(sh => {
    const hd = (sh.header && (sh.header.musicCarouselShelfBasicHeaderRenderer || sh.header.musicCarouselShelfHeaderRenderer)) || {};
    return { title: txt(hd.title), strap: txt(hd.strapline), items: (sh.contents || []).map(item).filter(Boolean).slice(0, 30) };
  }).filter(s => s.items.length && s.title);
  const call = async (ep, body, extra) => {
    const ctx = ytcfg.get('INNERTUBE_CONTEXT');
    const h = { 'Content-Type': 'application/json', 'X-Goog-AuthUser': String(ytcfg.get('SESSION_INDEX') || 0), 'X-Origin': location.origin,
      'X-Youtube-Client-Name': String(ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME') || 67), 'X-Youtube-Client-Version': String(ytcfg.get('INNERTUBE_CLIENT_VERSION') || ctx.client.clientVersion) };
    const m = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/);
    if (m && crypto.subtle) {
      const ts = Math.floor(Date.now() / 1000);
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + m[1] + ' ' + location.origin));
      h.Authorization = 'SAPISIDHASH ' + ts + '_' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const r = await fetch('/youtubei/v1/' + ep + '?prettyPrint=false' + (extra || ''), { method: 'POST', credentials: 'include', headers: h, body: JSON.stringify(Object.assign({ context: ctx }, body)) });
    if (!r.ok) throw new Error(ep + ' HTTP ' + r.status);
    return r.json();
  };
  const run = async () => {
    const loggedIn = !!ytcfg.get('LOGGED_IN');
    let name = '';
    if (loggedIn && R.kind !== 'queue') { try { const a = await call('account/account_menu', {}); name = txt(find(a, 'accountName')[0]); } catch (e) {} }
    if (R.kind === 'status' || R.kind === 'check') return { ok: true, loggedIn, name };
    if (R.kind === 'home') {
      let data = await call('browse', { browseId: 'FEmusic_home' });
      let out = shelves(data);
      for (let i = 0; i < 3; i++) { // the home page comes in parts
        const c = find(data, 'nextContinuationData')[0];
        if (!c || !c.continuation) break;
        try { data = await call('browse', {}, '&ctoken=' + encodeURIComponent(c.continuation) + '&continuation=' + encodeURIComponent(c.continuation) + '&type=next'); } catch (e) { break; }
        out = out.concat(shelves(data));
      }
      return { ok: true, loggedIn, name, shelves: out, at: Date.now() };
    }
    if (R.kind === 'queue') {
      let list = R.id;
      if (!list && R.b) { const d = await call('browse', { browseId: R.b }); const w = find(d, 'watchPlaylistEndpoint').find(x => x && x.playlistId); list = w ? w.playlistId : ''; }
      if (!list) throw new Error('no playlist');
      const body = { playlistId: list, isAudioOnly: true };
      if (R.v) body.videoId = R.v;
      const d = await call('next', body);
      const songs = find(d, 'playlistPanelVideoRenderer').map(p => ({ v: p.videoId, title: txt(p.title), artist: artistOf(p.longBylineText) || txt(p.shortBylineText), th: thumb(p.thumbnail), dur: txt(p.lengthText) })).filter(s => s.v);
      return { ok: true, loggedIn, songs };
    }
    throw new Error('unknown');
  };
  run().then(o => { S[k].out = JSON.stringify(o); S[k].done = true; }, e => { S[k].out = JSON.stringify({ error: String((e && e.message) || e) }); S[k].done = true; });
  return '';
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`
