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
  if (ad && v) { // an ad got through anyway: silent, skipped to its end, Skip pressed
    try { v.muted = true; window.__ngAdMute = 1; if (isFinite(v.duration) && v.duration > 0) v.currentTime = Math.max(0, v.duration - 0.1); v.playbackRate = 16; } catch (e) {}
    const sk = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[class*="skip"]'); if (sk) sk.click();
  } else if (v && window.__ngAdMute) { window.__ngAdMute = 0; v.playbackRate = 1; if (!window.__ngMuted) v.muted = false; }
  const pop = document.querySelector('ytmusic-mealbar-promo-renderer'); if (pop) { const b = pop.querySelector('#dismiss-button button, #dismiss-button, yt-button-renderer:last-child button'); if (b) try { b.click(); } catch (e) {} } // "try Premium" banners
  if (mp && mp.setPlaybackQualityRange && window.__ngQ !== q.get('v')) { // the video is never seen: the smallest picture (much less work for the PC)
    try { mp.setPlaybackQualityRange('tiny', 'tiny'); if (mp.setPlaybackQuality) mp.setPlaybackQuality('tiny'); window.__ngQ = q.get('v'); } catch (e) {}
  }
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

// runs in the hidden YouTube Music page before YouTube's own code: takes the ads out of what YouTube
// sends (the same way ad blockers do), so ads are never even scheduled. The state script above skips
// any that still get through.
const ytmAdJS = `(() => { try {
  if (window.__ngNoAds) return; window.__ngNoAds = 1;
  const KEYS = ['playerAds', 'adPlacements', 'adSlots', 'adBreakHeartbeatParams', 'adParams', 'adBreakParams'];
  const prune = o => { try {
      if (!o || typeof o !== 'object') return o;
      for (const k of KEYS) if (k in o) delete o[k];
      if (o.playerResponse) prune(o.playerResponse);
      if (Array.isArray(o)) for (const x of o) if (x && x.playerResponse) prune(x.playerResponse);
    } catch (e) {} return o; };
  const jp = JSON.parse; JSON.parse = function () { return prune(jp.apply(this, arguments)); };
  const rj = Response.prototype.json; Response.prototype.json = function () { return rj.apply(this, arguments).then(prune); };
  let ip; try { Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get: () => ip, set: v => { ip = prune(v); } }); } catch (e) {}
} catch (e) {} })();`

// GET /api/ytm/adjs – the same for the Mac app's player
func ytmAdJSHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Write([]byte(ytmAdJS))
}

// GET /api/ytm/js – the same script for the iPhone app's YouTube Music player (it fills in __VOL__ itself)
func ytmJSHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(ytmStateJS))
}
