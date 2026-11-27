package main

// Playing YouTube songs in Nagham's own player (no hidden YouTube Music page, so no ads and far less
// memory): yt-dlp finds the song's audio file, Nagham downloads it into a cache in pieces while it
// plays, and serves it to its own player from that file. Played songs start instantly next time.
// If a song can't play this way, the hidden YouTube Music player is still the backup.

import (
	"context"
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

var (
	ypMu       sync.Mutex
	ypFind     = map[string][]string{}
	ypVidRe    = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	ypFails    int
	ypFailsAt  time.Time
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

// ---------- the cache: a song's file fills up while it plays

type ypFile struct {
	vid   string
	path  string
	ext   string
	mu    sync.Mutex
	cond  *sync.Cond
	size  int64
	have  int64
	done  bool
	err   string
	errAt time.Time
	busy  bool
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
	// a finished song whose file was busy when it finished keeps its download name (.dl); its note says the type
	if b, err := os.ReadFile(filepath.Join(ypCacheDir(), vid+".dl.ok")); err == nil {
		p := filepath.Join(ypCacheDir(), vid+".dl")
		if st, err := os.Stat(p); err == nil && st.Size() > 10000 {
			ext := "m4a"
			if i := strings.Index(string(b), "|"); i >= 0 {
				ext = strings.TrimSpace(string(b)[i+1:])
			}
			return p, ext
		}
	}
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
// ypOpen: the song's cache file; if it isn't there yet, yt-dlp downloads it into the file now
// (yt-dlp itself does the downloading: YouTube cuts off other programs after the first ~30 seconds)
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
	defer f.mu.Unlock()
	if f.done && f.path != "" {
		if _, err := os.Stat(f.path); err == nil {
			return f, nil
		}
		f.done, f.have = false, 0 // the cache was cleared
	}
	if !f.busy {
		if p, ext := ypCached(vid); p != "" {
			st, _ := os.Stat(p)
			f.path, f.ext, f.size, f.have, f.done, f.err = p, ext, st.Size(), st.Size(), true, ""
			now := time.Now()
			os.Chtimes(p, now, now) // recently played: kept longer
			return f, nil
		}
		if f.err != "" && time.Since(f.errAt) < 60*time.Second {
			return nil, errors.New(f.err)
		}
		f.busy, f.err, f.size, f.have, f.path = true, "", 0, 0, ""
		go ypDownload(f)
	}
	// wait until the file has started (we know its size), or it failed
	stop := context.AfterFunc(ctx, func() { f.mu.Lock(); f.cond.Broadcast(); f.mu.Unlock() })
	defer stop()
	for f.busy && f.size == 0 && f.err == "" && ctx.Err() == nil {
		f.cond.Wait()
	}
	if f.path == "" || (f.err != "" && f.have == 0) {
		if f.err != "" {
			return nil, errors.New(f.err)
		}
		return nil, errors.New("stopped")
	}
	return f, nil
}

var ypMetaRe = regexp.MustCompile(`^\s*([0-9.]+|NA|None)?\|([a-z0-9]+)\|`)

// ypDownload: first the quick way (a YouTube client that needs no JavaScript work: starts seconds sooner),
// then yt-dlp's normal way if that gave nothing
func ypDownload(f *ypFile) {
	if (os.Getenv("NAGHAM_TEST_YTURL") == "" || os.Getenv("NAGHAM_TEST_QUICK") != "") && ypDownloadTry(f, true) {
		return
	}
	ypDownloadTry(f, false)
}

var (
	ypQuickBad   time.Time // the quick way stopped working: skip it for a while
	ypQuickFails int
)

func ypDownloadTry(f *ypFile, quick bool) bool {
	if quick {
		ypMu.Lock()
		bad := time.Since(ypQuickBad) < 30*time.Minute
		ypMu.Unlock()
		if bad {
			return false
		}
	}
	vid := f.vid
	fail := func(msg string) {
		f.mu.Lock()
		f.busy, f.err, f.errAt = false, msg, time.Now()
		path := f.path
		f.cond.Broadcast()
		f.mu.Unlock()
		if path != "" {
			os.Remove(path)
		}
		ypMu.Lock()
		ypFails++
		ypFailsAt = time.Now()
		ypMu.Unlock()
		log.Printf("yt play: %s: %s", vid, msg)
	}
	ytdlp, err := dlEnsureYtdlp()
	if err != nil {
		fail(err.Error())
		return true
	}
	dir := ypCacheDir()
	meta := filepath.Join(dir, vid+".meta")
	os.Remove(meta)
	defer os.Remove(meta)
	tmp := filepath.Join(dir, vid+".dl")
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	args := []string{"--no-playlist", "--no-warnings", "--ignore-config", "--encoding", "utf-8",
		"--socket-timeout", "15", "--retries", "5", "--fragment-retries", "5", "--no-part", "--no-mtime", "--no-simulate",
		"-f", "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio[ext=webm]/bestaudio/best[ext=mp4]/best",
		"--print-to-file", "%(filesize)s|%(ext)s|%(duration)s", meta}
	url := ypWatchURL(vid)
	if quick {
		// visionos needs no YouTube player script, so no deno work: seconds sooner
		args = append(args, "--extractor-args", "youtube:player_client=visionos",
			// plain files only (Apple clients also offer HLS, which doesn't stream well here)
			"-f", "bestaudio[ext=m4a][protocol^=http]/bestaudio[protocol^=http]/best[ext=mp4][protocol^=http]")
		url = "https://www.youtube.com/watch?v=" + vid
	}
	args = append(args, "-o", "-", "--", url)
	cmd := hidden(exec.CommandContext(ctx, ytdlp, args...))
	cmd.Env = append(os.Environ(), "PATH="+dlToolsDir()+string(os.PathListSeparator)+os.Getenv("PATH"), "PYTHONIOENCODING=utf-8")
	out, err := cmd.StdoutPipe()
	if err != nil {
		fail(err.Error())
		return true
	}
	var stderr strings.Builder
	cmd.Stderr = &ypLimitWriter{w: &stderr, n: 64 << 10}
	if err := cmd.Start(); err != nil {
		fail(err.Error())
		return true
	}
	file, err := os.Create(tmp)
	if err != nil {
		cmd.Process.Kill()
		fail(err.Error())
		return true
	}
	// the size / type note arrives before the sound: watch for it
	gotMeta := make(chan struct{})
	ended := make(chan struct{})
	go func() {
		defer close(gotMeta)
		for i := 0; i < 900 && ctx.Err() == nil; i++ {
			select {
			case <-ended: // yt-dlp is done: one last look below, then stop
				i = 899
			default:
			}
			if b, err := os.ReadFile(meta); err == nil {
				if m := ypMetaRe.FindStringSubmatch(string(b)); m != nil {
					size, _ := strconv.ParseFloat(m[1], 64)
					ext := m[2]
					if ext == "mp4" {
						ext = "m4a"
					}
					f.mu.Lock()
					f.ext = ext
					if size > 0 {
						f.size = int64(size)
					} else {
						f.size = -1 // not known until it's all here
					}
					f.path = tmp
					f.cond.Broadcast()
					f.mu.Unlock()
					log.Printf("yt play: found %s in %v (%s, %d KB)", vid, time.Since(start).Round(time.Millisecond), ext, int64(size)>>10)
					return
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
	}()
	buf := make([]byte, 64<<10)
	var pos int64
	var werr error
	for {
		n, rerr := out.Read(buf)
		if n > 0 {
			if _, werr = file.WriteAt(buf[:n], pos); werr != nil {
				break
			}
			pos += int64(n)
			f.mu.Lock()
			f.have = pos
			if f.path == "" { // the sound came first: the note is late
				f.path, f.size = tmp, -1
			}
			f.cond.Broadcast()
			f.mu.Unlock()
		}
		if rerr != nil {
			break
		}
	}
	file.Close()
	err = cmd.Wait()
	close(ended)
	<-gotMeta
	if werr != nil || err != nil || pos < 10000 {
		if quick && pos == 0 && werr == nil { // nothing came the quick way: the normal way
			log.Printf("yt play: %s: quick way gave nothing (%s), trying the normal way", vid, strings.TrimSpace(dlLastError(strings.Split(strings.TrimSpace(stderr.String()), "\n"))))
			ypMu.Lock()
			if ypQuickFails++; ypQuickFails >= 3 { // one song can be special; three in a row is YouTube
				ypQuickBad, ypQuickFails = time.Now(), 0
			}
			ypMu.Unlock()
			f.mu.Lock()
			f.path, f.size, f.ext = "", 0, ""
			f.mu.Unlock()
			os.Remove(tmp)
			return false
		}
		msg := dlLastError(strings.Split(strings.TrimSpace(stderr.String()), "\n"))
		if msg == "" && werr != nil {
			msg = werr.Error()
		}
		if msg == "" && err != nil {
			msg = err.Error()
		}
		if msg == "" {
			msg = "no sound came"
		}
		fail(msg)
		os.Remove(tmp)
		return true
	}
	f.mu.Lock()
	ext := f.ext
	if ext == "" {
		ext = "m4a"
	}
	final := filepath.Join(dir, vid+"."+ext)
	f.mu.Unlock()
	// players still reading the .dl file keep their handle; the finished song gets its real name
	if err := os.Rename(tmp, final); err != nil {
		final = tmp
	}
	os.WriteFile(final+".ok", []byte(strconv.FormatInt(pos, 10)+"|"+ext), 0o644)
	f.mu.Lock()
	f.path, f.size, f.have, f.done, f.busy = final, pos, pos, true, false
	f.cond.Broadcast()
	f.mu.Unlock()
	ypMu.Lock()
	ypFails = 0
	ypMu.Unlock()
	how := "normal way"
	if quick {
		how = "quick way"
		ypMu.Lock()
		ypQuickFails = 0
		ypMu.Unlock()
	}
	log.Printf("yt play: %s ready (%d KB in %v, %s)", vid, pos>>10, time.Since(start).Round(100*time.Millisecond), how)
	go ypTrim()
	return true
}

type ypLimitWriter struct {
	w io.Writer
	n int
}

func (l *ypLimitWriter) Write(p []byte) (int, error) {
	if l.n > 0 {
		k := len(p)
		if k > l.n {
			k = l.n
		}
		l.w.Write(p[:k])
		l.n -= k
	}
	return len(p), nil
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
	if size < 0 { // the size isn't known yet: the sound as it arrives (seeking works once it's all here)
		h := w.Header()
		h.Set("Content-Type", ypMime(ext))
		h.Set("Cache-Control", "no-store")
		w.WriteHeader(200)
		if r.Method == "HEAD" {
			return
		}
		size = 1 << 62
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
	streaming := size == 1<<62
	if streaming {
		from = 0
	} else if from >= size {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
		w.WriteHeader(416)
		return
	}
	if !streaming {
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
		have, ferr, fdone := f.have, f.err, f.done
		f.mu.Unlock()
		if ctx.Err() != nil || (ferr != "" && have <= pos) || (fdone && have <= pos) {
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
