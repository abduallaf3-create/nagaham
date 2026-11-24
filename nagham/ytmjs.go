package main

import "net/http"

// reads what the YouTube Music page is doing; also stops YouTube Music's own
// autoplay from running on into another song once ours has ended, and starts the
// top result when Nagham only had a search to go on.
const ytmStateJS = `(() => { try {
  const v = document.querySelector('video'), mp = document.querySelector('#movie_player');
  const VOL = __VOL__; window.__ngVol = VOL;
  if (v && VOL >= 0) { if (Math.abs(v.volume - VOL) > .004) v.volume = VOL; if (VOL === 0 && !v.muted) { v.muted = true; window.__ngMuted = 1; } else if (VOL > 0 && window.__ngMuted && v.muted) { v.muted = false; window.__ngMuted = 0; } }
  const q = new URLSearchParams(location.search), ad = !!(mp && mp.classList.contains('ad-showing'));
  if (v && !v.__ng) { v.__ng = 1;
    v.addEventListener('volumechange', () => { const w = window.__ngVol; if (w >= 0 && Math.abs(v.volume - w) > .004) v.volume = w; });
    v.addEventListener('ended', () => { const p = document.querySelector('#movie_player'); if (p && p.classList.contains('ad-showing')) return; window.__ngEnd = 1; window.__ngEndVid = new URLSearchParams(location.search).get('v'); });
    v.addEventListener('playing', () => { if (window.__ngEnd && new URLSearchParams(location.search).get('v') !== window.__ngEndVid) { v.pause(); } });
  }
  if (location.pathname === '/search' && !window.__ngClick) {
    const a = document.querySelector('ytmusic-card-shelf-renderer a[href*="watch?v="]') || document.querySelector('ytmusic-shelf-renderer a[href*="watch?v="]') || document.querySelector('#contents a[href*="watch?v="]');
    if (a) { window.__ngClick = 1; location.href = a.href; }
    else if (!window.__ngT0) window.__ngT0 = Date.now();
  }
  try { // media keys / the Windows media panel skip songs in Nagham, not inside YouTube Music
    const ms = navigator.mediaSession;
    ms.setActionHandler('nexttrack', () => { window.__ngAct = 'next'; });
    ms.setActionHandler('previoustrack', () => { window.__ngAct = 'prev'; });
  } catch (e) {}
  if (!window.__ngTag) { const t0 = q.get('nagham'); if (t0) window.__ngTag = t0; }
  const act = window.__ngAct || ''; window.__ngAct = '';
  const tt = document.querySelector('ytmusic-player-bar .title');
  return { fx: window.__ngFxS || '', act: act, ok: !!v, t: v ? v.currentTime : 0, d: v && isFinite(v.duration) ? v.duration : 0, p: v ? v.paused : true, e: !!window.__ngEnd, ad: ad,
    vid: q.get('v') || '', ng: window.__ngTag || '', path: location.pathname, vol: v ? v.volume : -1, rs: v ? v.readyState : 0, title: tt ? tt.textContent : '' };
} catch (e) { return { err: String(e) }; } })()`

// GET /api/ytm/js – the same script for the iPhone app's YouTube Music player (it fills in __VOL__ itself)
func ytmJSHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(ytmStateJS))
}
