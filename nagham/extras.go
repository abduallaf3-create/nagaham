package main

// Lyrics (LRCLIB, free, synced when available), "radio" (similar songs when a
// queue runs out) and a same-origin stream proxy (so the equalizer and
// crossfade can work on online songs too).

import (
	"encoding/json"
	"errors"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var lrclibBase = envOr("NAGHAM_LRCLIB", "https://lrclib.net")

type lyricsResult struct {
	Synced       string `json:"synced"`
	Plain        string `json:"plain"`
	Instrumental bool   `json:"instrumental"`
	Found        bool   `json:"found"`
}

var (
	lyrMu    sync.Mutex
	lyrCache = map[string]lyricsResult{}
)

type lrcItem struct {
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	Duration     float64 `json:"duration"`
	Instrumental bool    `json:"instrumental"`
	PlainLyrics  string  `json:"plainLyrics"`
	SyncedLyrics string  `json:"syncedLyrics"`
}

func lrcGet(u string) (*http.Response, error) {
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("User-Agent", "Nagham/"+appVersion+" (https://github.com/abduallaf3-create/nagaham)")
	return httpc.Do(req)
}

var junkBrackets = regexp.MustCompile(`(?i)[\(\[\{][^\)\]\}]*(official|lyric|lyrics|audio|video|visuali[sz]er|hd|hq|4k|remaster|explicit|clip|mv|m/v|music video|topic|full song|karaoke|live)[^\)\]\}]*[\)\]\}]`)
var junkTail = regexp.MustCompile(`(?i)\s*[-|–—]\s*(official\s.*|lyrics?\s*(video)?|audio|video|topic)\s*$`)

// "Suki Waterhouse - Good Looking [OFFICIAL LYRIC VIDEO]" -> artist "Suki Waterhouse", title "Good Looking"
func cleanSongTitle(title, artist string) (string, string) {
	t := strings.TrimSpace(junkBrackets.ReplaceAllString(title, " "))
	t = strings.TrimSpace(junkTail.ReplaceAllString(t, ""))
	t = strings.Join(strings.Fields(t), " ")
	artist = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(artist), " - Topic"))
	for _, sep := range []string{" - ", " – ", " — "} {
		if i := strings.Index(t, sep); i > 0 {
			left, right := strings.TrimSpace(t[:i]), strings.TrimSpace(t[i+len(sep):])
			if left != "" && right != "" {
				return right, left // the title usually carries the real artist in front
			}
		}
	}
	return t, artist
}

// GET /api/lyrics?title=&artist=&album=&dur=
func lyricsHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	title, artist := strings.TrimSpace(q.Get("title")), strings.TrimSpace(q.Get("artist"))
	if i := strings.Index(artist, ","); i > 0 {
		artist = strings.TrimSpace(artist[:i])
	}
	dur, _ := strconv.ParseFloat(q.Get("dur"), 64)
	if title == "" {
		http.Error(w, "missing title", 400)
		return
	}
	key := normKey(artist) + "|" + normKey(title)
	lyrMu.Lock()
	if c, ok := lyrCache[key]; ok {
		lyrMu.Unlock()
		writeJSON(w, c)
		return
	}
	lyrMu.Unlock()
	// the plain lookup and the "cleaned-up YouTube title" lookups run at the same time, best match wins
	type try struct {
		t, a, al string
		d        float64
	}
	tries := []try{{title, artist, q.Get("album"), dur}}
	if ct, ca := cleanSongTitle(title, artist); ct != title || ca != artist {
		tries = append(tries, try{ct, ca, "", dur}, try{ct, "", "", 0})
	}
	type out struct {
		r   lyricsResult
		err error
	}
	chans := make([]chan out, len(tries))
	for i, tr := range tries {
		chans[i] = make(chan out, 1)
		go func(i int, tr try) {
			r, err := lyricsFind(tr.t, tr.a, tr.al, tr.d)
			chans[i] <- out{r, err}
		}(i, tr)
	}
	res := lyricsResult{}
	var firstErr error
	got := false
	for i := range tries {
		var o out
		select {
		case o = <-chans[i]:
		case <-time.After(10 * time.Second):
			o = out{err: errors.New("the lyrics service is slow")}
		}
		if o.err != nil {
			if firstErr == nil {
				firstErr = o.err
			}
			continue
		}
		got = true
		if o.r.Found {
			res = o.r
			break
		}
	}
	if !got {
		http.Error(w, firstErr.Error(), 502)
		return
	}
	lyrMu.Lock()
	if len(lyrCache) > 500 {
		lyrCache = map[string]lyricsResult{}
	}
	lyrCache[key] = res
	lyrMu.Unlock()
	writeJSON(w, res)
}

func lyricsFind(title, artist, album string, dur float64) (lyricsResult, error) {
	var best *lrcItem
	// exact match first (fast), then a search
	if dur > 0 {
		v := url.Values{"track_name": {title}, "artist_name": {artist}, "duration": {strconv.Itoa(int(dur + .5))}}
		if album != "" {
			v.Set("album_name", album)
		}
		if resp, err := lrcGet(lrclibBase + "/api/get?" + v.Encode()); err == nil {
			if resp.StatusCode == 200 {
				var it lrcItem
				if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&it) == nil {
					best = &it
				}
			}
			resp.Body.Close()
		}
	}
	if best == nil {
		v := url.Values{"track_name": {title}}
		if artist != "" {
			v.Set("artist_name", artist)
		}
		resp, err := lrcGet(lrclibBase + "/api/search?" + v.Encode())
		if err != nil {
			return lyricsResult{}, errors.New("couldn't reach the lyrics service")
		}
		var list []lrcItem
		json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&list)
		resp.Body.Close()
		score := func(it lrcItem) float64 {
			s := 0.0
			if it.SyncedLyrics != "" {
				s += 4
			}
			if it.PlainLyrics != "" || it.Instrumental {
				s += 1
			}
			if normKey(it.TrackName) == normKey(title) {
				s += 3
			}
			if artist != "" && strings.Contains(normKey(it.ArtistName), normKey(artist)) {
				s += 3
			}
			if dur > 0 {
				d := it.Duration - dur
				if d < 0 {
					d = -d
				}
				if d < 3 {
					s += 3
				} else if d > 20 {
					s -= 4
				}
			}
			return s
		}
		bs := 3.0
		for i := range list {
			if sc := score(list[i]); sc > bs {
				bs, best = sc, &list[i]
			}
		}
	}
	res := lyricsResult{}
	if best != nil {
		res = lyricsResult{Synced: best.SyncedLyrics, Plain: best.PlainLyrics, Instrumental: best.Instrumental, Found: true}
	}
	return res, nil
}

// GET /api/online/radio?artist=&title=  → songs similar to this one (Deezer)
func onlineRadio(w http.ResponseWriter, r *http.Request) {
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	if i := strings.Index(artist, ","); i > 0 {
		artist = strings.TrimSpace(artist[:i])
	}
	if artist == "" {
		http.Error(w, "missing artist", 400)
		return
	}
	var sr struct {
		Data []dzArtist `json:"data"`
	}
	if err := fetchJSON(apiBase["deezer"]+"/search/artist?limit=1&q="+url.QueryEscape(artist), 24*time.Hour, &sr); err != nil || len(sr.Data) == 0 {
		http.Error(w, "artist not found", 404)
		return
	}
	id := sr.Data[0].ID.String()
	var rel struct {
		Data []dzArtist `json:"data"`
	}
	fetchJSON(apiBase["deezer"]+"/artist/"+id+"/related?limit=10", 24*time.Hour, &rel)
	ids := []string{id}
	for _, a := range rel.Data {
		ids = append(ids, a.ID.String())
	}
	if len(ids) > 7 {
		rand.Shuffle(len(ids)-1, func(i, j int) { ids[i+1], ids[j+1] = ids[j+1], ids[i+1] })
		ids = ids[:7]
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	var out []OTrack
	for i, aid := range ids {
		n := 4
		if i == 0 {
			n = 6
		}
		wg.Add(1)
		go func(aid string, n int) {
			defer wg.Done()
			t, err := dzTracks("/artist/"+aid+"/top?limit="+strconv.Itoa(n), 6*time.Hour)
			if err == nil {
				mu.Lock()
				out = append(out, t...)
				mu.Unlock()
			}
		}(aid, n)
	}
	wg.Wait()
	rand.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	writeJSON(w, map[string]any{"tracks": out})
}

// a client for long audio streams: no overall time limit, but don't wait forever for a start
var streamClient = &http.Client{Transport: &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	DialContext:           (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
	ResponseHeaderTimeout: 20 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
}}

// proxyStream copies an online audio stream through Nagham (keeps seeking working)
func proxyStream(w http.ResponseWriter, r *http.Request, u string) {
	req, _ := http.NewRequestWithContext(r.Context(), "GET", u, nil)
	req.Header.Set("User-Agent", "Nagham/"+appVersion)
	if rg := r.Header.Get("Range"); rg != "" {
		req.Header.Set("Range", rg)
	}
	resp, err := streamClient.Do(req)
	if err != nil {
		http.Redirect(w, r, u, http.StatusFound) // fall back to the old way
		return
	}
	defer resp.Body.Close()
	for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
