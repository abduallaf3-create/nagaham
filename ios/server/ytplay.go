package main

// Playing YouTube songs on the iPhone without YouTube Music (so no ads): yt-dlp finds the song's
// audio file and Nagham passes it to its own player at the same address as the app. Seeking works,
// it keeps playing with the screen locked, and the equalizer / singer volume work too.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ypSrc struct {
	URL     string
	Headers map[string]string
	Mime    string
	Dur     float64
	Exp     time.Time
	Err     string
	ErrAt   time.Time
}

var (
	ypMu      sync.Mutex
	ypCache   = map[string]*ypSrc{}
	ypWait    = map[string]chan struct{}{}
	ypFind    = map[string][]string{}
	ypVidRe   = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	ypClient  = &http.Client{Timeout: 0}
	ypChunk   = int64(1 << 20) // YouTube slows down long open requests, so the file is fetched in pieces
	ypFails   int
	ypFailsAt time.Time
)

func ypResolve(ctx context.Context, vid string) (*ypSrc, error) {
	ytdlp, err := dlEnsureYtdlp()
	if err != nil {
		return nil, err
	}
	cctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	out, err := ytCommand(cctx, ytdlp, "--dump-single-json", "--no-playlist", "--no-warnings", "--ignore-config", "--encoding", "utf-8",
		"-f", "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio[ext=mp4]/bestaudio/best[ext=mp4]/best",
		"--", ypWatchURL(vid)).Output()
	if err != nil {
		msg := strings.TrimSpace(string(ytErrStderr(err)))
		if l := dlLastError(strings.Split(msg, "\n")); l != "" {
			msg = l
		}
		if msg == "" {
			msg = err.Error()
		}
		return nil, errors.New(msg)
	}
	var j struct {
		URL         string            `json:"url"`
		Ext         string            `json:"ext"`
		Duration    float64           `json:"duration"`
		HTTPHeaders map[string]string `json:"http_headers"`
		Protocol    string            `json:"protocol"`
	}
	if err := json.Unmarshal(out, &j); err != nil || j.URL == "" {
		return nil, errors.New("yt-dlp gave no audio address")
	}
	if strings.Contains(j.Protocol, "m3u8") || strings.Contains(j.Protocol, "dash") {
		return nil, errors.New("this song only comes as a live stream")
	}
	s := &ypSrc{URL: j.URL, Headers: j.HTTPHeaders, Dur: j.Duration, Exp: time.Now().Add(4 * time.Hour)}
	if u, err := url.Parse(j.URL); err == nil {
		if e, err := strconv.ParseInt(u.Query().Get("expire"), 10, 64); err == nil && e > 0 {
			if t := time.Unix(e, 0).Add(-10 * time.Minute); t.Before(s.Exp) {
				s.Exp = t
			}
		}
	}
	switch j.Ext {
	case "webm":
		s.Mime = "audio/webm"
	case "mp3":
		s.Mime = "audio/mpeg"
	default:
		s.Mime = "audio/mp4"
	}
	return s, nil
}

// ypGet returns the song's audio address, asking yt-dlp only once at a time per song
func ypGet(ctx context.Context, vid string, fresh bool) (*ypSrc, error) {
	for {
		ypMu.Lock()
		if s := ypCache[vid]; s != nil && !fresh {
			if s.Err != "" && time.Since(s.ErrAt) < 90*time.Second {
				ypMu.Unlock()
				return nil, errors.New(s.Err)
			}
			if s.Err == "" && time.Now().Before(s.Exp) {
				ypMu.Unlock()
				return s, nil
			}
		}
		if ch := ypWait[vid]; ch != nil {
			ypMu.Unlock()
			select {
			case <-ch:
				fresh = false
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		ch := make(chan struct{})
		ypWait[vid] = ch
		ypMu.Unlock()

		start := time.Now()
		s, err := ypResolve(context.Background(), vid)
		log.Printf("yt play: resolve %s in %v err=%v", vid, time.Since(start).Round(time.Millisecond), err)
		ypMu.Lock()
		delete(ypWait, vid)
		close(ch)
		if err != nil {
			ypCache[vid] = &ypSrc{Err: err.Error(), ErrAt: time.Now()}
			ypFails++
			ypFailsAt = time.Now()
		} else {
			ypCache[vid] = s
			ypFails = 0
		}
		if len(ypCache) > 300 {
			for k, v := range ypCache {
				if v.Err != "" || time.Now().After(v.Exp) {
					delete(ypCache, k)
				}
			}
		}
		ypMu.Unlock()
		return s, err
	}
}

func ypUpstream(ctx context.Context, s *ypSrc, from, to int64) (*http.Response, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", s.URL, nil)
	for k, v := range s.Headers {
		if strings.EqualFold(k, "Accept-Encoding") {
			continue
		}
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "Mozilla/5.0")
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", from, to))
	return ypClient.Do(req)
}

var ypRangeRe = regexp.MustCompile(`^bytes=(\d*)-(\d*)$`)

// GET /api/yt/audio/VIDEOID – the song's audio, with seeking (Range) support
func ypAudio(w http.ResponseWriter, r *http.Request) {
	vid := strings.TrimPrefix(r.URL.Path, "/api/yt/audio/")
	if !ypVidRe.MatchString(vid) {
		http.Error(w, "bad id", 400)
		return
	}
	var from, to int64 = 0, -1
	if m := ypRangeRe.FindStringSubmatch(strings.TrimSpace(r.Header.Get("Range"))); m != nil && m[1] != "" {
		from, _ = strconv.ParseInt(m[1], 10, 64)
		if m[2] != "" {
			to, _ = strconv.ParseInt(m[2], 10, 64)
		}
	}
	ctx := r.Context()
	var s *ypSrc
	var resp *http.Response
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		s, err = ypGet(ctx, vid, attempt > 0)
		if err != nil {
			break
		}
		end := from + ypChunk - 1
		if to >= 0 && to < end {
			end = to
		}
		resp, err = ypUpstream(ctx, s, from, end)
		if err == nil && (resp.StatusCode == 403 || resp.StatusCode == 410 || resp.StatusCode >= 500) {
			resp.Body.Close()
			err = fmt.Errorf("YouTube answered HTTP %d", resp.StatusCode)
			continue // the address ran out: ask yt-dlp again
		}
		break
	}
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == 416 {
		w.WriteHeader(416)
		return
	}
	total := int64(-1)
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		if i := strings.LastIndex(cr, "/"); i >= 0 {
			total, _ = strconv.ParseInt(cr[i+1:], 10, 64)
		}
	}
	if resp.StatusCode == 200 { // the server ignored Range: pass the whole file on
		w.Header().Set("Content-Type", s.Mime)
		if resp.ContentLength > 0 {
			w.Header().Set("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
		}
		w.WriteHeader(200)
		io.Copy(w, resp.Body)
		return
	}
	if total <= 0 {
		http.Error(w, "YouTube didn't say the file size", 502)
		return
	}
	last := total - 1
	if to >= 0 && to < last {
		last = to
	}
	if from > last {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", total))
		w.WriteHeader(416)
		return
	}
	h := w.Header()
	h.Set("Content-Type", s.Mime)
	h.Set("Accept-Ranges", "bytes")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", from, last, total))
	h.Set("Content-Length", strconv.FormatInt(last-from+1, 10))
	w.WriteHeader(206)
	if r.Method == "HEAD" {
		return
	}
	pos := from
	body := resp.Body
	for {
		n, err := io.Copy(w, body)
		body.Close()
		pos += n
		if err != nil || pos > last || ctx.Err() != nil {
			return
		}
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		end := pos + ypChunk - 1
		if end > last {
			end = last
		}
		var rr *http.Response
		for attempt := 0; attempt < 2; attempt++ {
			rr, err = ypUpstream(ctx, s, pos, end)
			if err == nil && rr.StatusCode != 206 && rr.StatusCode != 200 {
				rr.Body.Close()
				err = fmt.Errorf("HTTP %d", rr.StatusCode)
				if s2, e2 := ypGet(ctx, vid, true); e2 == nil {
					s = s2
				}
				continue
			}
			break
		}
		if err != nil {
			log.Printf("yt play: %s stopped at %d/%d: %v", vid, pos, total, err)
			return
		}
		body = rr.Body
	}
}

// GET /api/yt/prep?id=VIDEOID – find the next song's audio ahead of time, so skipping is instant
func ypPrep(w http.ResponseWriter, r *http.Request) {
	vid := r.URL.Query().Get("id")
	if !ypVidRe.MatchString(vid) {
		http.Error(w, "bad id", 400)
		return
	}
	if r.URL.Query().Get("wait") == "" {
		go ypGet(context.Background(), vid, false)
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	s, err := ypGet(r.Context(), vid, false)
	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "duration": s.Dur})
}

// GET /api/yt/find?title=&artist=&dur= – the YouTube video of a catalogue song (Deezer / Spotify / Apple)
func ypFindHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	m := dlSpMeta{Title: strings.TrimSpace(q.Get("title")), Artist: strings.TrimSpace(strings.Split(q.Get("artist"), ",")[0])}
	m.Duration, _ = strconv.ParseFloat(q.Get("dur"), 64)
	if m.Title == "" {
		writeJSON(w, map[string]any{"ids": []string{}})
		return
	}
	key := strings.ToLower(m.Artist + "\x00" + m.Title)
	ypMu.Lock()
	ids, ok := ypFind[key]
	ypMu.Unlock()
	if !ok {
		ytdlp, err := dlEnsureYtdlp()
		if err != nil {
			writeJSON(w, map[string]any{"ids": []string{}, "error": err.Error()})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		list, err := dlRankOnYouTube(ctx, ytdlp, m)
		ids = []string{}
		for _, it := range list {
			if id := ytIDFromURL(it.URL); id != "" {
				ids = append(ids, id)
			} else if ypVidRe.MatchString(it.ID) {
				ids = append(ids, it.ID)
			}
		}
		if err == nil && len(ids) > 0 {
			ypMu.Lock()
			ypFind[key] = ids
			ypMu.Unlock()
		}
	}
	if len(ids) > 0 {
		go ypGet(context.Background(), ids[0], false) // get its audio ready right away
	}
	writeJSON(w, map[string]any{"ids": ids})
}

// GET /api/yt/status – can songs play through yt-dlp right now
func ypStatus(w http.ResponseWriter, r *http.Request) {
	_, ok := dlResolve("yt-dlp")
	ypMu.Lock()
	bad := ypFails >= 4 && time.Since(ypFailsAt) < 10*time.Minute
	ypMu.Unlock()
	writeJSON(w, map[string]any{"ready": ok, "struggling": bad, "bridge": bridgeStatus()})
}

func ypWatchURL(vid string) string {
	if t := os.Getenv("NAGHAM_TEST_YTURL"); t != "" { // tests only: a local file instead of YouTube
		return strings.ReplaceAll(t, "{id}", vid)
	}
	return "https://www.youtube.com/watch?v=" + vid
}
