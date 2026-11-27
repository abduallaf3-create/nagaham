package main

// Playing YouTube songs in Nagham's own player (no hidden YouTube Music page, so no ads and far less
// memory): yt-dlp finds the song's audio file, Nagham downloads it into a cache in pieces while it
// plays, and serves it to its own player from that file. Played songs start instantly next time.
// If a song can't play this way, the hidden YouTube Music player is still the backup.

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
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ypSrc struct {
	URL     string
	Headers map[string]string
	Ext     string
	Size    int64
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
	ypChunk   = int64(2 << 20) // YouTube slows down long open requests, so the file is fetched in pieces
	ypFails   int
	ypFailsAt time.Time
	ypCacheMax = int64(1500 << 20) // songs kept for instant replay (oldest go first)
)

func ypMime(ext string) string {
	switch ext {
	case "webm":
		return "audio/webm"
	case "mp3":
		return "audio/mpeg"
	}
	return "audio/mp4"
}

func ytIDFromURL(u string) string {
	p, err := url.Parse(u)
	if err != nil {
		return ""
	}
	if v := p.Query().Get("v"); ypVidRe.MatchString(v) {
		return v
	}
	if strings.HasSuffix(p.Host, "youtu.be") {
		if v := strings.Trim(p.Path, "/"); ypVidRe.MatchString(v) {
			return v
		}
	}
	return ""
}

func ypResolve(ctx context.Context, vid string) (*ypSrc, error) {
	ytdlp, err := dlEnsureYtdlp()
	if err != nil {
		return nil, err
	}
	cctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	cmd := hidden(exec.CommandContext(cctx, ytdlp, "--dump-single-json", "--no-playlist", "--no-warnings", "--ignore-config", "--encoding", "utf-8",
		"--socket-timeout", "15",
		"-f", "bestaudio[ext=m4a][protocol^=http]/bestaudio[acodec^=mp4a][protocol^=http]/bestaudio[protocol^=http]/best[ext=mp4][protocol^=http]",
		"--", ypWatchURL(vid)))
	cmd.Env = append(os.Environ(), "PATH="+dlToolsDir()+string(os.PathListSeparator)+os.Getenv("PATH"), "PYTHONIOENCODING=utf-8")
	out, err := cmd.Output()
	if err != nil {
		msg := ""
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			msg = dlLastError(strings.Split(strings.TrimSpace(string(ee.Stderr)), "\n"))
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
		Filesize    int64             `json:"filesize"`
		FilesizeA   float64           `json:"filesize_approx"`
		HTTPHeaders map[string]string `json:"http_headers"`
		Protocol    string            `json:"protocol"`
	}
	if err := json.Unmarshal(out, &j); err != nil || j.URL == "" {
		return nil, errors.New("yt-dlp gave no audio address")
	}
	if strings.Contains(j.Protocol, "m3u8") || strings.Contains(j.Protocol, "dash") {
		return nil, errors.New("this song only comes as a live stream")
	}
	s := &ypSrc{URL: j.URL, Headers: j.HTTPHeaders, Dur: j.Duration, Ext: j.Ext, Size: j.Filesize, Exp: time.Now().Add(4 * time.Hour)}
	if s.Ext == "" || s.Ext == "mp4" {
		s.Ext = "m4a"
	}
	if u, err := url.Parse(j.URL); err == nil {
		if e, err := strconv.ParseInt(u.Query().Get("expire"), 10, 64); err == nil && e > 0 {
			if t := time.Unix(e, 0).Add(-10 * time.Minute); t.Before(s.Exp) {
				s.Exp = t
			}
		}
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
		log.Printf("yt play: found %s in %v err=%v", vid, time.Since(start).Round(time.Millisecond), err)
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

// ---------- the cache: a song's file fills up while it plays

type ypFile struct {
	vid  string
	path string
	ext  string
	mu   sync.Mutex
	cond *sync.Cond
	size int64
	have int64
	done bool
	err  string
	busy bool
}

var (
	ypFilesMu sync.Mutex
	ypFiles   = map[string]*ypFile{}
)

func ypCacheDir() string {
	d := filepath.Join(dataDir, "Cache", "audio")
	os.MkdirAll(d, 0o755)
	return d
}

// a finished song in the cache (name.ext plus name.ext.ok)
func ypCached(vid string) (string, string) {
	for _, ext := range []string{"m4a", "webm", "mp3"} {
		p := filepath.Join(ypCacheDir(), vid+"."+ext)
		if _, err := os.Stat(p + ".ok"); err == nil {
			if st, err := os.Stat(p); err == nil && st.Size() > 10000 {
				return p, ext
			}
		}
	}
	return "", ""
}

// ypOpen: the song's cache file, downloading in the background if it isn't complete yet
func ypOpen(ctx context.Context, vid string) (*ypFile, error) {
	ypFilesMu.Lock()
	f := ypFiles[vid]
	if f == nil {
		f = &ypFile{vid: vid}
		f.cond = sync.NewCond(&f.mu)
		ypFiles[vid] = f
	}
	ypFilesMu.Unlock()
	f.mu.Lock()
	if f.done && f.path != "" {
		if _, err := os.Stat(f.path); err == nil {
			f.mu.Unlock()
			return f, nil
		}
		f.done, f.have = false, 0 // the cache was cleared
	}
	if f.busy { // someone else is getting it: wait until its file exists
		for f.busy && f.path == "" && f.err == "" && ctx.Err() == nil {
			f.cond.Wait()
		}
		path, ferr := f.path, f.err
		f.mu.Unlock()
		if path == "" {
			if ferr == "" {
				ferr = "stopped"
			}
			return nil, errors.New(ferr)
		}
		return f, nil
	}
	if p, ext := ypCached(vid); p != "" {
		st, _ := os.Stat(p)
		f.path, f.ext, f.size, f.have, f.done, f.err = p, ext, st.Size(), st.Size(), true, ""
		f.mu.Unlock()
		now := time.Now()
		os.Chtimes(p, now, now) // recently played: kept longer
		return f, nil
	}
	f.busy, f.err = true, ""
	f.mu.Unlock()

	s, err := ypGet(ctx, vid, false)
	if err == nil && s.Size <= 0 { // yt-dlp didn't say the size: ask YouTube
		var resp *http.Response
		if resp, err = ypUpstream(ctx, s, 0, 1); err == nil {
			resp.Body.Close()
			if cr := resp.Header.Get("Content-Range"); cr != "" {
				if i := strings.LastIndex(cr, "/"); i >= 0 {
					s.Size, _ = strconv.ParseInt(cr[i+1:], 10, 64)
				}
			}
			if s.Size <= 0 {
				err = fmt.Errorf("YouTube didn't say the file size (HTTP %d)", resp.StatusCode)
			}
		}
	}
	f.mu.Lock()
	if err != nil {
		f.busy, f.err = false, err.Error()
		f.cond.Broadcast()
		f.mu.Unlock()
		return nil, err
	}
	f.ext, f.size, f.have, f.done = s.Ext, s.Size, 0, false
	f.path = filepath.Join(ypCacheDir(), vid+"."+s.Ext)
	f.cond.Broadcast()
	f.mu.Unlock()
	go ypDownload(f, s)
	return f, nil
}

func ypDownload(f *ypFile, s *ypSrc) {
	fail := func(msg string) {
		f.mu.Lock()
		f.busy, f.err = false, msg
		f.cond.Broadcast()
		f.mu.Unlock()
		os.Remove(f.path)
		log.Printf("yt play: %s: %s", f.vid, msg)
	}
	out, err := os.Create(f.path)
	if err != nil {
		fail(err.Error())
		return
	}
	defer out.Close()
	start := time.Now()
	var pos int64
	tries := 0
	buf := make([]byte, 64<<10)
	for pos < f.size {
		end := pos + ypChunk - 1
		if end >= f.size {
			end = f.size - 1
		}
		resp, err := ypUpstream(context.Background(), s, pos, end)
		if err == nil && resp.StatusCode != 206 && resp.StatusCode != 200 {
			resp.Body.Close()
			err = fmt.Errorf("YouTube answered HTTP %d", resp.StatusCode)
		}
		got := int64(0)
		if err == nil {
			for {
				n, rerr := resp.Body.Read(buf)
				if n > 0 {
					if _, werr := out.WriteAt(buf[:n], pos); werr != nil {
						err = werr
						break
					}
					pos += int64(n)
					got += int64(n)
					f.mu.Lock()
					f.have = pos
					f.cond.Broadcast()
					f.mu.Unlock()
				}
				if rerr != nil {
					if rerr != io.EOF {
						err = rerr
					}
					break
				}
			}
			resp.Body.Close()
			if err == nil && got == 0 {
				err = errors.New("empty answer")
			}
		}
		if err != nil {
			tries++
			if tries > 4 {
				fail("download stopped: " + err.Error())
				return
			}
			time.Sleep(time.Duration(tries) * 600 * time.Millisecond)
			if s2, e2 := ypGet(context.Background(), f.vid, true); e2 == nil { // the address may have run out
				s = s2
			}
			continue
		}
		tries = 0
	}
	out.Sync()
	os.WriteFile(f.path+".ok", []byte(strconv.FormatInt(f.size, 10)), 0o644)
	f.mu.Lock()
	f.done, f.busy = true, false
	f.cond.Broadcast()
	f.mu.Unlock()
	log.Printf("yt play: %s cached (%d KB in %v)", f.vid, f.size>>10, time.Since(start).Round(100*time.Millisecond))
	go ypTrim()
}

// the cache keeps the most recently played songs, up to ypCacheMax
func ypTrim() {
	ents, err := os.ReadDir(ypCacheDir())
	if err != nil {
		return
	}
	type fi struct {
		p string
		n int64
		t time.Time
	}
	var files []fi
	var total int64
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".ok") || e.IsDir() {
			continue
		}
		if st, err := e.Info(); err == nil {
			files = append(files, fi{filepath.Join(ypCacheDir(), e.Name()), st.Size(), st.ModTime()})
			total += st.Size()
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].t.Before(files[j].t) })
	for _, x := range files {
		if total <= ypCacheMax {
			break
		}
		vid := strings.TrimSuffix(filepath.Base(x.p), filepath.Ext(x.p))
		ypFilesMu.Lock()
		f := ypFiles[vid]
		ypFilesMu.Unlock()
		if f != nil {
			f.mu.Lock()
			busy := f.busy
			f.mu.Unlock()
			if busy {
				continue
			}
		}
		os.Remove(x.p)
		os.Remove(x.p + ".ok")
		total -= x.n
	}
}

var ypRangeRe = regexp.MustCompile(`^bytes=(\d*)-(\d*)$`)

// GET /api/yt/audio/VIDEOID – the song's audio from the cache file (it fills up while it plays), with seeking
func ypAudio(w http.ResponseWriter, r *http.Request) {
	vid := strings.TrimPrefix(r.URL.Path, "/api/yt/audio/")
	if !ypVidRe.MatchString(vid) {
		http.Error(w, "bad id", 400)
		return
	}
	ctx := r.Context()
	f, err := ypOpen(ctx, vid)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	f.mu.Lock()
	size, path, ext, done := f.size, f.path, f.ext, f.done
	f.mu.Unlock()
	if done { // all here: the standard file server (ranges, HEAD…)
		fh, err := os.Open(path)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer fh.Close()
		w.Header().Set("Content-Type", ypMime(ext))
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, "", time.Time{}, fh)
		return
	}
	var from, to int64 = 0, size - 1
	if m := ypRangeRe.FindStringSubmatch(strings.TrimSpace(r.Header.Get("Range"))); m != nil && m[1] != "" {
		from, _ = strconv.ParseInt(m[1], 10, 64)
		if m[2] != "" {
			if v, _ := strconv.ParseInt(m[2], 10, 64); v < to {
				to = v
			}
		}
	}
	if from >= size {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
		w.WriteHeader(416)
		return
	}
	h := w.Header()
	h.Set("Content-Type", ypMime(ext))
	h.Set("Accept-Ranges", "bytes")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", from, to, size))
	h.Set("Content-Length", strconv.FormatInt(to-from+1, 10))
	w.WriteHeader(206)
	if r.Method == "HEAD" {
		return
	}
	// wake the waiting below when the player goes away
	go func() {
		<-ctx.Done()
		f.mu.Lock()
		f.cond.Broadcast()
		f.mu.Unlock()
	}()
	var fh *os.File
	defer func() {
		if fh != nil {
			fh.Close()
		}
	}()
	pos := from
	buf := make([]byte, 128<<10)
	for pos <= to {
		f.mu.Lock()
		for f.have <= pos && !f.done && f.err == "" && ctx.Err() == nil {
			f.cond.Wait()
		}
		have, ferr := f.have, f.err
		f.mu.Unlock()
		if ctx.Err() != nil || (ferr != "" && have <= pos) {
			return
		}
		if fh == nil {
			if fh, err = os.Open(path); err != nil {
				return
			}
		}
		n := have - pos
		if n > int64(len(buf)) {
			n = int64(len(buf))
		}
		if pos+n > to+1 {
			n = to + 1 - pos
		}
		k, err := fh.ReadAt(buf[:n], pos)
		if k > 0 {
			if _, werr := w.Write(buf[:k]); werr != nil {
				return
			}
			pos += int64(k)
			if fl, ok := w.(http.Flusher); ok {
				fl.Flush()
			}
		}
		if err != nil && err != io.EOF {
			return
		}
	}
}

// GET /api/yt/prep?id=VIDEOID – get the next song ready ahead of time, so skipping is instant
func ypPrep(w http.ResponseWriter, r *http.Request) {
	vid := r.URL.Query().Get("id")
	if !ypVidRe.MatchString(vid) {
		http.Error(w, "bad id", 400)
		return
	}
	go ypOpen(context.Background(), vid) // finds it and starts filling the cache
	writeJSON(w, map[string]any{"ok": true})
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
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		list, err := dlRankOnYouTube(ctx, "", m) // the fast search; yt-dlp only if it doesn't answer
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
	if len(ids) > 0 && q.Get("prep") != "0" {
		go ypOpen(context.Background(), ids[0]) // get its audio ready right away
	}
	writeJSON(w, map[string]any{"ids": ids})
}

// GET /api/yt/status – can songs play through yt-dlp right now
func ypStatus(w http.ResponseWriter, r *http.Request) {
	_, ok := dlResolve("yt-dlp")
	ypMu.Lock()
	bad := ypFails >= 4 && time.Since(ypFailsAt) < 10*time.Minute
	ypMu.Unlock()
	writeJSON(w, map[string]any{"ready": ok, "struggling": bad})
}

func ypWatchURL(vid string) string {
	if t := os.Getenv("NAGHAM_TEST_YTURL"); t != "" { // tests only: a local file instead of YouTube
		return strings.ReplaceAll(t, "{id}", vid)
	}
	return "https://music.youtube.com/watch?v=" + vid
}
