package main

// Download a song from a link (YouTube, SoundCloud, ...) straight into one of Nagham's music folders.
// Uses yt-dlp + ffmpeg, which Nagham fetches by itself the first time (Windows).

import (
	"archive/zip"
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	dlYtdlpURL  = dlEnv("NAGHAM_DL_YTDLP", "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
	dlFfmpegURL = dlEnv("NAGHAM_DL_FFMPEG", "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip")
	dlDenoURL   = dlEnv("NAGHAM_DL_DENO", "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip")
)

func dlEnv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type dlJob struct {
	ID     string  `json:"id"`
	URL    string  `json:"url"`
	Status string  `json:"status"` // queued, tools, downloading, converting, done, error, cancelled
	Phase  string  `json:"phase"`
	Pct    float64 `json:"pct"`
	Title  string  `json:"title"`
	File   string  `json:"file"`
	Folder string  `json:"folder"`
	Track  string  `json:"track"` // Nagham track id of the saved song
	Error  string  `json:"error"`
	Batch  string  `json:"batch,omitempty"` // part of a whole album / playlist download
	cancel context.CancelFunc
	q      *dlQuery
}

// a song to find by name (albums from the catalogue, playlists of songs that aren't on YouTube)
type dlQuery struct {
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album"`
	Duration float64 `json:"duration"`
	N        int     `json:"n"`               // track number on the album
	URL      string  `json:"url,omitempty"`   // a known YouTube video for this song: no searching
	Cover    string  `json:"cover,omitempty"` // the album cover from the catalogue: put into the file instead of a video picture
}

// at most three songs download at the same time (more makes YouTube refuse some): a 60-song playlist doesn't start 60 downloads at once
var dlSlots = make(chan struct{}, 3)

var (
	dlMu     sync.Mutex
	dlJobs   = map[string]*dlJob{}
	dlOrder  []string
	dlToolMu sync.Mutex
)

func dlSet(j *dlJob, f func(*dlJob)) { dlMu.Lock(); f(j); dlMu.Unlock() }
func dlCopy(j *dlJob) dlJob          { dlMu.Lock(); defer dlMu.Unlock(); c := *j; c.cancel = nil; return c }

func dlExe(n string) string {
	if runtime.GOOS == "windows" {
		return n + ".exe"
	}
	return n
}
func dlToolsDir() string         { return filepath.Join(dataDir, "tools") }
func dlToolPath(n string) string { return filepath.Join(dlToolsDir(), dlExe(n)) }

func dlResolve(n string) (string, bool) {
	if st, err := os.Stat(dlToolPath(n)); err == nil && st.Size() > 0 {
		return dlToolPath(n), true
	}
	if p, err := exec.LookPath(n); err == nil {
		return p, true
	}
	return dlToolPath(n), false
}

func dlFetch(u, dst string, pct func(float64)) error {
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("User-Agent", "Nagham/3.4")
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed (HTTP %d)", resp.StatusCode)
	}
	f, err := os.Create(dst + ".part")
	if err != nil {
		return err
	}
	var done int64
	buf := make([]byte, 64*1024)
	for {
		n, er := resp.Body.Read(buf)
		if n > 0 {
			if _, ew := f.Write(buf[:n]); ew != nil {
				f.Close()
				return ew
			}
			done += int64(n)
			if resp.ContentLength > 0 {
				pct(float64(done) * 100 / float64(resp.ContentLength))
			}
		}
		if er == io.EOF {
			break
		}
		if er != nil {
			f.Close()
			os.Remove(dst + ".part")
			return er
		}
	}
	f.Close()
	os.Remove(dst)
	return os.Rename(dst+".part", dst)
}

func dlUnzip(zp string, want map[string]string) error {
	zr, err := zip.OpenReader(zp)
	if err != nil {
		return err
	}
	defer zr.Close()
	found := 0
	for _, f := range zr.File {
		out, ok := want[strings.ToLower(filepath.Base(f.Name))]
		if !ok || f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		w, err := os.Create(out + ".part")
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(w, rc)
		w.Close()
		rc.Close()
		if err != nil {
			return err
		}
		os.Remove(out)
		if err := os.Rename(out+".part", out); err != nil {
			return err
		}
		found++
	}
	if found == 0 {
		return errors.New("nothing useful inside the zip")
	}
	return nil
}

func dlEnsureTools(j *dlJob) error {
	dlToolMu.Lock()
	defer dlToolMu.Unlock()
	if err := os.MkdirAll(dlToolsDir(), 0o755); err != nil {
		return err
	}
	step := func(label string, f func(func(float64)) error) error {
		dlSet(j, func(j *dlJob) { j.Status = "tools"; j.Phase = label; j.Pct = 0 })
		return f(func(p float64) { dlSet(j, func(j *dlJob) { j.Pct = p }) })
	}
	if _, ok := dlResolve("yt-dlp"); !ok {
		if err := step("Getting the downloader (one time)…", func(cb func(float64)) error {
			return dlFetch(dlYtdlpURL, dlToolPath("yt-dlp"), cb)
		}); err != nil {
			return fmt.Errorf("couldn't get yt-dlp: %w", err)
		}
		os.Chmod(dlToolPath("yt-dlp"), 0o755)
	}
	if _, ok := dlResolve("ffmpeg"); !ok {
		if err := step("Getting the audio converter (one time, ~100 MB)…", func(cb func(float64)) error {
			z := filepath.Join(dlToolsDir(), "ffmpeg.zip")
			if err := dlFetch(dlFfmpegURL, z, cb); err != nil {
				return err
			}
			defer os.Remove(z)
			return dlUnzip(z, map[string]string{dlExe("ffmpeg"): dlToolPath("ffmpeg"), dlExe("ffprobe"): dlToolPath("ffprobe")})
		}); err != nil {
			return fmt.Errorf("couldn't get ffmpeg: %w", err)
		}
	}
	if runtime.GOOS == "windows" {
		if _, ok := dlResolve("deno"); !ok { // lets yt-dlp solve YouTube's checks; not fatal if it fails
			_ = step("Getting a helper for YouTube (one time)…", func(cb func(float64)) error {
				z := filepath.Join(dlToolsDir(), "deno.zip")
				if err := dlFetch(dlDenoURL, z, cb); err != nil {
					return err
				}
				defer os.Remove(z)
				return dlUnzip(z, map[string]string{dlExe("deno"): dlToolPath("deno")})
			})
		}
	}
	return nil
}

var dlPctRe = regexp.MustCompile(`\[download\]\s+([\d.]+)%`)

func dlValidURL(s string) (string, error) {
	s = strings.TrimSpace(s)
	if len(s) > 2000 {
		return "", errors.New("that link is too long")
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("that doesn't look like a web link")
	}
	return u.String(), nil
}

// a fixed value for yt-dlp's --parse-metadata: "#" keeps a one-word value from being read as a field name
// (that wrote "NA" as the title), "%" and ":" are escaped so they stay as they are
func dlLiteral(v string) string {
	v = strings.Join(strings.Fields(v), " ")
	return "#" + strings.NewReplacer("%", "%%", ":", "\\:").Replace(v)
}

// puts a picture from the catalogue into the song file as its cover (replacing any picture already there)
func dlEmbedCover(ctx context.Context, ffmpeg, file, coverURL string, meta ...string) error {
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, "GET", coverURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
	resp, err := httpc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode != 200 || !(strings.HasPrefix(ct, "image/jpeg") || strings.HasPrefix(ct, "image/png") || strings.HasPrefix(ct, "image/jpg")) {
		return fmt.Errorf("cover: %d %s", resp.StatusCode, ct)
	}
	img, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil || len(img) < 100 {
		return errors.New("cover: empty")
	}
	ext := filepath.Ext(file)
	picExt := ".jpg"
	if strings.HasPrefix(ct, "image/png") {
		picExt = ".png"
	}
	pic := strings.TrimSuffix(file, ext) + ".cover" + picExt
	out := strings.TrimSuffix(file, ext) + ".withcover" + ext
	if err := os.WriteFile(pic, img, 0o644); err != nil {
		return err
	}
	defer os.Remove(pic)
	args := []string{"-y", "-v", "error", "-i", file, "-i", pic, "-map", "0:a", "-map", "1:v", "-c", "copy"}
	if strings.EqualFold(ext, ".mp3") {
		args = append(args, "-id3v2_version", "3", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)")
	}
	for i := 0; i+1 < len(meta); i += 2 { // new tags (name, value pairs)
		args = append(args, "-metadata", meta[i]+"="+meta[i+1])
	}
	args = append(args, "-disposition:v:0", "attached_pic", out)
	cmd := hidden(exec.CommandContext(cctx, ffmpeg, args...))
	if b, err := cmd.CombinedOutput(); err != nil {
		os.Remove(out)
		return fmt.Errorf("ffmpeg: %v %s", err, strings.TrimSpace(string(b)))
	}
	if st, err := os.Stat(out); err != nil || st.Size() < 1000 {
		os.Remove(out)
		return errors.New("ffmpeg made no file")
	}
	return os.Rename(out, file)
}

// one run of yt-dlp; "" when it worked, otherwise the error to show
func dlOnce(ctx context.Context, j *dlJob, ytdlp string, args []string, named bool, format string) string {
	dlSet(j, func(j *dlJob) { j.File = "" })
	// the finished file's path also goes into a small file (always UTF-8): Windows' console encoding drops Arabic,
	// Russian, … letters from what yt-dlp prints, which made finished downloads look like failures
	pf, perr := os.CreateTemp("", "nagham-dl-*.txt")
	pathFile := ""
	if perr == nil {
		pathFile = pf.Name()
		pf.Close()
		defer os.Remove(pathFile)
		for i, a := range args {
			if a == "--" {
				args = append(append(append([]string{}, args[:i]...), "--print-to-file", "after_move:%(filepath)s", pathFile), args[i:]...)
				break
			}
		}
	}
	started := time.Now()
	cmd := hidden(exec.CommandContext(ctx, ytdlp, args...))
	cmd.Env = append(os.Environ(), "PATH="+dlToolsDir()+string(os.PathListSeparator)+os.Getenv("PATH"), "PYTHONIOENCODING=utf-8")
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return "couldn't start the downloader: " + err.Error()
	}
	var errLines []string
	var emu sync.Mutex
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			emu.Lock()
			errLines = append(errLines, sc.Text())
			emu.Unlock()
		}
	}()
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "TITLE="):
			if !named {
				dlSet(j, func(j *dlJob) { j.Title = strings.TrimPrefix(line, "TITLE=") })
			}
		case strings.HasPrefix(line, "FILE="):
			dlSet(j, func(j *dlJob) { j.File = strings.TrimPrefix(line, "FILE=") })
		case strings.Contains(line, "[download]"):
			if m := dlPctRe.FindStringSubmatch(line); m != nil {
				p, _ := strconv.ParseFloat(m[1], 64)
				dlSet(j, func(j *dlJob) { j.Status, j.Phase, j.Pct = "downloading", "Downloading…", p })
			}
		case strings.Contains(line, "[ExtractAudio]") || strings.Contains(line, "[Metadata]") || strings.Contains(line, "[EmbedThumbnail]"):
			dlSet(j, func(j *dlJob) {
				j.Status, j.Phase, j.Pct = "converting", "Saving as "+strings.ToUpper(format)+"…", 100
			})
		}
	}
	wg.Wait()
	err := cmd.Wait()
	if ctx.Err() != nil {
		return "cancelled"
	}
	if err != nil {
		emu.Lock()
		defer emu.Unlock()
		return dlLastError(errLines)
	}
	ok := func(f string) bool { st, e := os.Stat(f); return f != "" && e == nil && !st.IsDir() }
	if f := dlCopy(j).File; ok(f) {
		return ""
	}
	if b, err := os.ReadFile(pathFile); err == nil && pathFile != "" {
		lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(string(b), "\r", "")), "\n")
		if f := strings.TrimSpace(lines[len(lines)-1]); ok(f) {
			dlSet(j, func(j *dlJob) { j.File = f })
			return ""
		}
	}
	// last resort: the newest song file that appeared in the folder during this download
	if ents, err := os.ReadDir(dlCopy(j).Folder); err == nil {
		best, bestT := "", started.Add(-2*time.Second)
		for _, e := range ents {
			ext := strings.ToLower(filepath.Ext(e.Name()))
			if e.IsDir() || (ext != ".mp3" && ext != ".m4a" && ext != ".opus" && ext != ".webm") {
				continue
			}
			if inf, err := e.Info(); err == nil && inf.ModTime().After(bestT) {
				best, bestT = filepath.Join(dlCopy(j).Folder, e.Name()), inf.ModTime()
			}
		}
		if best != "" {
			dlSet(j, func(j *dlJob) { j.File = best })
			return ""
		}
	}
	return "the download finished but no file was created"
}

// errors that mean "this yt-dlp is too old for YouTube right now"
func dlLooksBroken(msg string) bool {
	m := strings.ToLower(msg)
	for _, k := range []string{"unable to extract", "nsig", "signature", "requested format is not available", "sign in to confirm", "http error 403", "player", "precondition", "unsupported url", "only images are available"} {
		if strings.Contains(m, k) {
			return true
		}
	}
	return false
}

var (
	dlUpdMu   sync.Mutex
	dlUpdLast time.Time
)

// keeps yt-dlp current (YouTube changes often; an old yt-dlp is the most common reason downloads fail).
// Every 12 hours (checked hourly while Nagham runs), and at most every 30 minutes when downloads keep failing.
func dlUpdateYtdlp(ytdlp string, now bool) {
	dlUpdMu.Lock()
	defer dlUpdMu.Unlock()
	stamp := filepath.Join(dlToolsDir(), "yt-dlp.updated")
	if !now {
		if st, err := os.Stat(stamp); err == nil && time.Since(st.ModTime()) < 12*time.Hour {
			return
		}
	} else if time.Since(dlUpdLast) < 30*time.Minute {
		return
	}
	dlUpdLast = time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := hidden(exec.CommandContext(ctx, ytdlp, "-U", "--no-warnings"))
	cmd.Env = append(os.Environ(), "PATH="+dlToolsDir()+string(os.PathListSeparator)+os.Getenv("PATH"))
	out, err := cmd.CombinedOutput()
	log.Printf("yt-dlp update: %s %v", strings.TrimSpace(strings.ReplaceAll(string(out), "\n", " | ")), err)
	if err == nil {
		os.WriteFile(stamp, []byte(time.Now().Format(time.RFC3339)), 0o644)
	}
}

// checks right after Nagham starts, then every hour; it really updates when the last update is 12+ hours old
// (so it keeps itself current even when Nagham stays open for days)
func dlUpdateStart() {
	go func() {
		time.Sleep(30 * time.Second)
		for {
			if ytdlp, ok := dlResolve("yt-dlp"); ok {
				dlUpdateYtdlp(ytdlp, false)
			}
			time.Sleep(time.Hour)
		}
	}()
}

func dlLastError(lines []string) string {
	cut := func(l string) string {
		if len(l) > 300 {
			return l[:300]
		}
		return l
	}
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); strings.HasPrefix(l, "ERROR:") {
			return cut(strings.TrimSpace(strings.TrimPrefix(l, "ERROR:")))
		}
	}
	if len(lines) > 0 {
		return cut(lines[len(lines)-1])
	}
	return "the download failed"
}

func dlRun(j *dlJob, ctx context.Context, format string) {
	fail := func(msg string) {
		dlSet(j, func(j *dlJob) {
			if j.Status != "cancelled" {
				j.Status, j.Error = "error", msg
			}
		})
	}
	if err := dlEnsureTools(j); err != nil {
		fail(err.Error())
		return
	}
	if err := os.MkdirAll(j.Folder, 0o755); err != nil {
		fail("couldn't use that folder: " + err.Error())
		return
	}
	dlSet(j, func(j *dlJob) { j.Status, j.Phase = "queued", "Waiting for the other downloads…" })
	select {
	case dlSlots <- struct{}{}:
	case <-ctx.Done():
		dlSet(j, func(j *dlJob) { j.Status, j.Phase = "cancelled", "Cancelled" })
		return
	}
	defer func() { <-dlSlots }()
	dlSet(j, func(j *dlJob) { j.Status, j.Phase, j.Pct = "downloading", "Downloading…", 0 })
	ytdlp, _ := dlResolve("yt-dlp")
	ffmpeg, _ := dlResolve("ffmpeg")
	var spMeta *dlSpMeta
	var alts []string       // other videos of the same song, tried when one fails
	if q := j.q; q != nil { // a song by name: find it on YouTube Music, name and tag the file like the catalogue does
		dlSet(j, func(j *dlJob) { j.Phase = "Finding the song…" })
		m := dlSpMeta{Title: q.Title, Artist: q.Artist, Duration: q.Duration}
		it := dlItem{URL: q.URL}
		if it.URL == "" {
			l, err := dlRankOnYouTube(ctx, ytdlp, m)
			if err != nil {
				fail(err.Error())
				return
			}
			it = l[0]
			for _, x := range l[1:] {
				alts = append(alts, x.URL)
			}
		}
		spMeta = &m
		dlSet(j, func(j *dlJob) {
			j.URL = it.URL
			j.Title = strings.TrimSpace(strings.Trim(m.Artist+" - "+m.Title, " -"))
		})
	} else if id := dlSpotifyID(j.URL); id != "" { // Spotify link: look the song up, then take the audio from YouTube Music
		dlSet(j, func(j *dlJob) { j.Phase = "Finding the song…" })
		m, err := dlSpotifyMeta(ctx, id)
		if err != nil {
			fail(err.Error())
			return
		}
		l, err := dlRankOnYouTube(ctx, ytdlp, m)
		if err != nil {
			fail(err.Error())
			return
		}
		it := l[0]
		for _, x := range l[1:] {
			alts = append(alts, x.URL)
		}
		spMeta = &m
		dlSet(j, func(j *dlJob) { j.URL = it.URL; j.Title = strings.TrimSpace(m.Artist + " - " + m.Title) })
	}
	if format != "m4a" {
		format = "mp3"
	}
	args := []string{
		"--no-playlist", "--newline", "--progress", "--no-warnings", "--no-simulate", "--encoding", "utf-8",
		"--windows-filenames", "--no-mtime", "--ignore-config",
		"--embed-metadata", "--concurrent-fragments", "4",
		"--ffmpeg-location", filepath.Dir(ffmpeg),
		"--print", "before_dl:TITLE=%(title)s",
		"--print", "after_move:FILE=%(filepath)s",
		"-x", "--audio-format", format, "--audio-quality", "0",
		"-o", filepath.Join(j.Folder, "%(artist,uploader&{} - |)s%(title)s.%(ext)s"),
	}
	cover := ""
	if j.q != nil {
		cover = j.q.Cover
	}
	if cover == "" && spMeta != nil {
		cover = spMeta.Thumb
	}
	if cover == "" { // the video's picture, cut to a square like an album cover
		args = append(args, "--embed-thumbnail", "--convert-thumbnails", "jpg",
			"--ppa", `ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`)
	}
	if spMeta != nil { // name and tag the file the way the catalogue names the song
		args = append(args, "--parse-metadata", dlLiteral(spMeta.Title)+":#%(meta_title)s")
		if spMeta.Artist != "" {
			args = append(args, "--parse-metadata", dlLiteral(spMeta.Artist)+":#%(meta_artist)s")
		}
		if q := j.q; q != nil && q.Album != "" {
			args = append(args, "--parse-metadata", dlLiteral(q.Album)+":#%(meta_album)s")
			if q.N > 0 {
				args = append(args, "--parse-metadata", dlLiteral(strconv.Itoa(q.N))+":#%(meta_track)s")
			}
		}
		for i, a := range args {
			if a == "-o" {
				name := strings.TrimSpace(spMeta.Artist + " - " + spMeta.Title)
				if spMeta.Artist == "" {
					name = spMeta.Title
				}
				name = strings.TrimRight(strings.TrimSpace(dlBadName.ReplaceAllString(name, " ")), ". ")
				if r := []rune(name); len(r) > 150 {
					name = string(r[:150])
				}
				args[i+1] = filepath.Join(j.Folder, strings.ReplaceAll(name, "%", "%%")+".%(ext)s")
			}
		}
	}
	tries := append([]string{j.URL}, alts...)
	if len(tries) < 2 {
		tries = append(tries, j.URL) // the same video once more (YouTube often fails just once)
	}
	var lastErr string
	for try, u := range tries {
		if try > 0 {
			if dlLooksBroken(lastErr) { // YouTube changed something: a newer yt-dlp usually fixes it
				dlSet(j, func(j *dlJob) { j.Phase = "Updating the downloader…" })
				dlUpdateYtdlp(ytdlp, true)
			}
			dlSet(j, func(j *dlJob) {
				j.Status, j.Phase, j.Pct, j.URL = "downloading", fmt.Sprintf("Trying again (%d)…", try+1), 0, u
			})
			select {
			case <-time.After(time.Duration(1500*try) * time.Millisecond):
			case <-ctx.Done():
			}
		}
		lastErr = dlOnce(ctx, j, ytdlp, append(append([]string{}, args...), "--", u), spMeta != nil, format)
		if ctx.Err() != nil {
			dlSet(j, func(j *dlJob) { j.Status, j.Phase = "cancelled", "Cancelled" })
			return
		}
		if lastErr == "" {
			break
		}
		log.Printf("download try %d failed: %s — %s (%s)", try+1, dlCopy(j).Title, lastErr, u)
	}
	if lastErr != "" {
		fail(lastErr)
		return
	}
	snap := dlCopy(j)
	if st, e := os.Stat(snap.File); snap.File == "" || e != nil || st.IsDir() {
		fail("the download finished but no file was created")
		return
	}
	if cover != "" { // the real album cover (not a picture from the video)
		dlSet(j, func(j *dlJob) { j.Phase = "Adding the cover…" })
		if err := dlEmbedCover(ctx, ffmpeg, snap.File, cover); err != nil {
			log.Printf("cover for %s: %v", filepath.Base(snap.File), err)
		}
	}
	dlSet(j, func(j *dlJob) {
		j.Status, j.Phase, j.Pct, j.Track = "done", "Done", 100, trackID(filepath.Clean(snap.File))
	})
	go scanAll() // the folder is already one of Nagham's: the song shows up
}

// same-origin guard: refuse requests that come from another website
func dlSameOrigin(w http.ResponseWriter, r *http.Request) bool {
	if o := r.Header.Get("Origin"); o != "" {
		u, err := url.Parse(o)
		if err != nil || u.Host != r.Host {
			http.Error(w, "forbidden", http.StatusForbidden)
			return false
		}
	}
	return true
}

func dlInfo(w http.ResponseWriter, r *http.Request) {
	if !dlSameOrigin(w, r) {
		return
	}
	_, y := dlResolve("yt-dlp")
	_, f := dlResolve("ffmpeg")
	spMu.Lock()
	linked := sp.RefreshToken != ""
	spMu.Unlock()
	out := map[string]any{"ready": y && f, "spotify": linked}
	if p := dlCopy(dlPrep); p.Status != "" {
		out["prep"] = map[string]any{"phase": p.Phase, "pct": p.Pct, "status": p.Status, "error": p.Error}
	}
	writeJSON(w, out)
}

// the tools are fetched in the background soon after Nagham opens (first time ~200 MB), so the first song
// doesn't have to wait for them
var dlPrep = &dlJob{ID: "prep"}

func dlPrepareStart() {
	go func() {
		time.Sleep(8 * time.Second)
		for {
			_, y := dlResolve("yt-dlp")
			_, f := dlResolve("ffmpeg")
			_, d := dlResolve("deno")
			if y && f && (d || runtime.GOOS != "windows") {
				dlSet(dlPrep, func(j *dlJob) { j.Status = "" })
				return
			}
			dlSet(dlPrep, func(j *dlJob) { j.Status, j.Error = "tools", "" })
			err := dlEnsureTools(dlPrep)
			dlSet(dlPrep, func(j *dlJob) {
				j.Status = ""
				if err != nil {
					j.Status, j.Error = "error", err.Error()
				}
			})
			if err != nil {
				log.Printf("preparing the downloader failed: %v", err)
				time.Sleep(5 * time.Minute)
				continue
			}
			log.Printf("downloader ready")
			return
		}
	}()
}

// GET /api/report — a short text to send when something doesn't work: version, tools, and the log's recent lines
func dlReport(w http.ResponseWriter, r *http.Request) {
	if !dlSameOrigin(w, r) {
		return
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Nagham %s — %s/%s\n", appVersion, runtime.GOOS, runtime.GOARCH)
	for _, t := range []string{"yt-dlp", "ffmpeg", "deno"} {
		p, ok := dlResolve(t)
		v := "missing"
		if ok {
			v = "ok"
			if t == "yt-dlp" {
				ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
				if out, err := hidden(exec.CommandContext(ctx, p, "--version")).Output(); err == nil {
					v = strings.TrimSpace(string(out))
				}
				cancel()
			}
		}
		fmt.Fprintf(&b, "%s: %s\n", t, v)
	}
	if lb, err := os.ReadFile(filepath.Join(dataDir, "nagham.log")); err == nil {
		lines := strings.Split(strings.TrimSpace(string(lb)), "\n")
		keep := []string{}
		for _, l := range lines {
			if !strings.Contains(l, "songfix:") { // long and not useful here
				keep = append(keep, l)
			}
		}
		if len(keep) > 60 {
			keep = keep[len(keep)-60:]
		}
		b.WriteString("--- log ---\n" + strings.Join(keep, "\n") + "\n")
	}
	dlMu.Lock()
	n := 0
	for i := len(dlOrder) - 1; i >= 0 && n < 15; i-- {
		if j := dlJobs[dlOrder[i]]; j != nil && j.Status == "error" {
			fmt.Fprintf(&b, "failed: %s — %s\n", j.Title, j.Error)
			n++
		}
	}
	dlMu.Unlock()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	io.WriteString(w, b.String())
}

// songs live inside Nagham's own data folder; it is added to the library automatically
var dlBadName = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]+`)

// a safe folder name for an album or playlist (empty = straight into Songs)
func dlFolderName(s string) string {
	s = strings.TrimSpace(dlBadName.ReplaceAllString(s, " "))
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 80 {
		s = strings.TrimSpace(string(r[:80]))
	}
	s = strings.Trim(s, ". ")
	switch strings.ToUpper(s) {
	case "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3":
		s = "_" + s
	}
	return s
}

func dlSongsDir() (string, error) {
	d := filepath.Join(dataDir, "Songs")
	if err := os.MkdirAll(d, 0o755); err != nil {
		return "", err
	}
	if err := addFolder(d); err != nil {
		return "", err
	}
	return d, nil
}

func dlStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" || !dlSameOrigin(w, r) {
		http.Error(w, "POST only", 405)
		return
	}
	var in struct {
		URL    string   `json:"url"`
		Format string   `json:"format"`
		Query  *dlQuery `json:"query"`
		Folder string   `json:"folder"` // album / playlist name: its songs go in their own folder
		Batch  string   `json:"batch"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	var u string
	var err error
	if in.Query != nil {
		in.Query.Title = strings.TrimSpace(in.Query.Title)
		in.Query.Artist = strings.TrimSpace(in.Query.Artist)
		if in.Query.Title == "" || len(in.Query.Title)+len(in.Query.Artist)+len(in.Query.Album) > 900 {
			http.Error(w, "missing song name", 400)
			return
		}
		u = "song:" + strings.Trim(in.Query.Artist+" - "+in.Query.Title, " -")
	} else if u, err = dlValidURL(in.URL); err != nil {
		http.Error(w, err.Error(), 400)
		return
	} else if q, err := dlLinkSong(u, country(r)); err != nil { // Deezer / Apple Music song links: found on YouTube Music by name
		http.Error(w, err.Error(), 400)
		return
	} else if q != nil {
		in.Query = q
		u = "song:" + strings.Trim(q.Artist+" - "+q.Title, " -")
	}
	folder, err := dlSongsDir()
	if err != nil {
		http.Error(w, "couldn't prepare the songs folder: "+err.Error(), 500)
		return
	}
	if sub := dlFolderName(in.Folder); sub != "" {
		folder = filepath.Join(folder, sub)
	}
	b := make([]byte, 6)
	rand.Read(b)
	ctx, cancel := context.WithCancel(context.Background())
	j := &dlJob{ID: hex.EncodeToString(b), URL: u, Status: "queued", Phase: "Starting…", Folder: folder, cancel: cancel, q: in.Query, Batch: in.Batch}
	if in.Query != nil {
		j.Title = strings.Trim(in.Query.Artist+" - "+in.Query.Title, " -")
	}
	dlMu.Lock()
	dlJobs[j.ID] = j
	dlOrder = append(dlOrder, j.ID)
	if len(dlOrder) > 600 {
		delete(dlJobs, dlOrder[0])
		dlOrder = dlOrder[1:]
	}
	dlMu.Unlock()
	go func() { defer cancel(); dlRun(j, ctx, in.Format) }()
	writeJSON(w, map[string]string{"id": j.ID})
}

var (
	dlDzTrackRe   = regexp.MustCompile(`(?i)deezer\.com/(?:[a-z]{2}/)?track/(\d+)`)
	dlAppleSongRe = regexp.MustCompile(`(?i)music\.apple\.com/.*(?:[?&]i=|/song/[^/?#]*/)(\d+)`)
)

// a song link from a store whose audio can't be downloaded directly (Deezer, Apple Music):
// its name, artist, album and cover, so the song is taken from YouTube Music and tagged properly
func dlLinkSong(u, cc string) (*dlQuery, error) {
	if m := dlDzTrackRe.FindStringSubmatch(u); m != nil {
		var t struct {
			dzErr
			dzTrack
		}
		if err := fetchJSON(apiBase["deezer"]+"/track/"+m[1], time.Hour, &t); err != nil || t.Error != nil || t.Title == "" {
			return nil, errors.New("couldn't find that song on Deezer")
		}
		return &dlQuery{Title: t.Title, Artist: t.Artist.Name, Album: t.Album.Title, Duration: t.Duration, Cover: firstNonEmpty(t.Album.CoverXL, t.Album.CoverMedium)}, nil
	}
	if m := dlAppleSongRe.FindStringSubmatch(u); m != nil {
		var res struct {
			Results []struct {
				Kind   string  `json:"kind"`
				Track  string  `json:"trackName"`
				Artist string  `json:"artistName"`
				Album  string  `json:"collectionName"`
				TimeMs float64 `json:"trackTimeMillis"`
				Art    string  `json:"artworkUrl100"`
			} `json:"results"`
		}
		if err := fetchJSON(apiBase["itunes"]+"/lookup?country="+url.QueryEscape(cc)+"&id="+m[1], time.Hour, &res); err != nil {
			return nil, errors.New("couldn't find that song on Apple Music")
		}
		for _, x := range res.Results {
			if x.Kind == "song" && x.Track != "" {
				return &dlQuery{Title: x.Track, Artist: x.Artist, Album: x.Album, Duration: x.TimeMs / 1000, Cover: strings.Replace(x.Art, "100x100", "600x600", 1)}, nil
			}
		}
		return nil, errors.New("couldn't find that song on Apple Music")
	}
	return nil, nil
}

func dlJobGet(w http.ResponseWriter, r *http.Request) {
	if !dlSameOrigin(w, r) {
		return
	}
	dlMu.Lock()
	j := dlJobs[r.URL.Query().Get("id")]
	dlMu.Unlock()
	if j == nil {
		http.Error(w, "unknown download", 404)
		return
	}
	writeJSON(w, dlCopy(j))
}

func dlCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" || !dlSameOrigin(w, r) {
		http.Error(w, "POST only", 405)
		return
	}
	dlMu.Lock()
	j := dlJobs[r.URL.Query().Get("id")]
	dlMu.Unlock()
	if j != nil && j.cancel != nil {
		dlSet(j, func(j *dlJob) { j.Status = "cancelled" })
		j.cancel()
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------- search (typo-friendly)

type dlItem struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Channel  string  `json:"channel"`
	Duration float64 `json:"duration"`
	Thumb    string  `json:"thumb"`
	URL      string  `json:"url"`
	score    float64
	order    int
}

var (
	dlSuggestURL = dlEnv("NAGHAM_DL_SUGGEST", "https://suggestqueries.google.com/complete/search")
	dlCacheMu    sync.Mutex
	dlSugCache   = map[string]dlCacheEnt{}
	dlResCache   = map[string]dlCacheEnt{}
)

type dlCacheEnt struct {
	at   time.Time
	data any
}

func dlCacheGet(m map[string]dlCacheEnt, k string, ttl time.Duration) (any, bool) {
	dlCacheMu.Lock()
	defer dlCacheMu.Unlock()
	if e, ok := m[k]; ok && time.Since(e.at) < ttl {
		return e.data, true
	}
	return nil, false
}
func dlCachePut(m map[string]dlCacheEnt, k string, v any) {
	dlCacheMu.Lock()
	if len(m) > 200 {
		for kk := range m {
			delete(m, kk)
			break
		}
	}
	m[k] = dlCacheEnt{time.Now(), v}
	dlCacheMu.Unlock()
}

// suggestions: what people type for this start (also fixes spelling mistakes)
func dlSuggest(ctx context.Context, q string) []string {
	key := strings.ToLower(q)
	if v, ok := dlCacheGet(dlSugCache, key, 30*time.Minute); ok {
		return v.([]string)
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	u := dlSuggestURL + "?client=firefox&ds=yt&hl=en&q=" + url.QueryEscape(q)
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var raw []json.RawMessage
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<18)).Decode(&raw) != nil || len(raw) < 2 {
		return nil
	}
	var sug []string
	json.Unmarshal(raw[1], &sug)
	if len(sug) > 8 {
		sug = sug[:8]
	}
	dlCachePut(dlSugCache, key, sug)
	return sug
}

// edit distance where swapping two neighbouring letters counts as one mistake
func dlLev(a, b []rune) int {
	d := make([][]int, len(a)+1)
	for i := range d {
		d[i] = make([]int, len(b)+1)
		d[i][0] = i
	}
	for j := 0; j <= len(b); j++ {
		d[0][j] = j
	}
	for i := 1; i <= len(a); i++ {
		for j := 1; j <= len(b); j++ {
			c := 1
			if a[i-1] == b[j-1] {
				c = 0
			}
			d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+c)
			if i > 1 && j > 1 && a[i-1] == b[j-2] && a[i-2] == b[j-1] {
				d[i][j] = min(d[i][j], d[i-2][j-2]+1)
			}
		}
	}
	return d[len(a)][len(b)]
}

var dlWordRe = regexp.MustCompile(`[\p{L}\p{N}]+`)

func dlWords(s string) []string {
	var out []string
	for _, w := range dlWordRe.FindAllString(strings.ToLower(s), -1) {
		if len([]rune(w)) > 1 {
			out = append(out, w)
		}
	}
	return out
}

// how many of the wanted words appear (allowing small typos) in the text
func dlMatch(want []string, text string) float64 {
	if len(want) == 0 {
		return 0
	}
	have := dlWords(text)
	hit := 0.0
	for _, w := range want {
		wr := []rune(w)
		tol := 0
		if len(wr) >= 7 {
			tol = 2
		} else if len(wr) >= 4 {
			tol = 1
		}
		for _, h := range have {
			if h == w || (len(wr) >= 4 && strings.Contains(h, w)) || (tol > 0 && dlLev(wr, []rune(h)) <= tol) {
				hit++
				break
			}
		}
	}
	return hit / float64(len(want))
}

func dlYtSearch(ctx context.Context, ytdlp, q string) []dlItem {
	cctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	cmd := hidden(exec.CommandContext(cctx, ytdlp, "--flat-playlist", "--dump-json", "--no-warnings", "--ignore-config", "--encoding", "utf-8", "--playlist-end", "10", "ytsearch10:"+q))
	cmd.Env = append(os.Environ(), "PATH="+dlToolsDir()+string(os.PathListSeparator)+os.Getenv("PATH"), "PYTHONIOENCODING=utf-8")
	out, _ := cmd.Output()
	var res []dlItem
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var v struct {
			ID       string  `json:"id"`
			Title    string  `json:"title"`
			Channel  string  `json:"channel"`
			Uploader string  `json:"uploader"`
			Duration float64 `json:"duration"`
			URL      string  `json:"url"`
			Thumb    string  `json:"thumbnail"`
			Thumbs   []struct {
				URL string `json:"url"`
			} `json:"thumbnails"`
		}
		if json.Unmarshal(sc.Bytes(), &v) != nil || v.ID == "" || v.Title == "" {
			continue
		}
		it := dlItem{ID: v.ID, Title: v.Title, Channel: v.Channel, Duration: v.Duration, Thumb: v.Thumb}
		if it.Channel == "" {
			it.Channel = v.Uploader
		}
		if it.Thumb == "" && len(v.Thumbs) > 0 {
			it.Thumb = v.Thumbs[len(v.Thumbs)-1].URL
		}
		if it.Thumb == "" {
			it.Thumb = "https://i.ytimg.com/vi/" + v.ID + "/mqdefault.jpg"
		}
		it.URL = v.URL
		if !strings.HasPrefix(it.URL, "http") {
			it.URL = "https://www.youtube.com/watch?v=" + v.ID
		}
		res = append(res, it)
	}
	return res
}

func dlEnsureYtdlp() (string, error) {
	dlToolMu.Lock()
	defer dlToolMu.Unlock()
	if p, ok := dlResolve("yt-dlp"); ok {
		return p, nil
	}
	os.MkdirAll(dlToolsDir(), 0o755)
	if err := dlFetch(dlYtdlpURL, dlToolPath("yt-dlp"), func(float64) {}); err != nil {
		return "", err
	}
	os.Chmod(dlToolPath("yt-dlp"), 0o755)
	return dlToolPath("yt-dlp"), nil
}

// GET /api/dl/suggest?q=... – fast "did you mean" suggestions while typing
func dlSuggestHandler(w http.ResponseWriter, r *http.Request) {
	if !dlSameOrigin(w, r) {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 200 {
		writeJSON(w, map[string]any{"suggestions": []string{}})
		return
	}
	s := dlSuggest(r.Context(), q)
	if s == nil {
		s = []string{}
	}
	writeJSON(w, map[string]any{"suggestions": s})
}

// GET /api/dl/search?q=... – find songs by name; spelling mistakes are fine
func dlSearch(w http.ResponseWriter, r *http.Request) {
	if !dlSameOrigin(w, r) {
		return
	}
	q := strings.Join(strings.Fields(r.URL.Query().Get("q")), " ")
	if q == "" || len(q) > 300 {
		http.Error(w, "type a song name", 400)
		return
	}
	source := r.URL.Query().Get("source")
	if source != "spotify" {
		source = "ytmusic"
	}
	key := source + "|" + strings.ToLower(q)
	if source == "ytmusic" {
		if v, ok := dlCacheGet(dlResCache, key, 10*time.Minute); ok {
			writeJSON(w, v)
			return
		}
	}
	if source == "spotify" {
		if dlSearchSpotify(w, r, q) {
			return
		}
	}
	ytdlp, err := dlEnsureYtdlp()
	if err != nil {
		http.Error(w, "couldn't get the downloader (check your internet): "+err.Error(), 502)
		return
	}
	want := dlWords(q)
	// words of a song (4 or more) are searched as lyrics too
	lyricsLike := len(want) >= 4
	var wg sync.WaitGroup
	var orig, fixed, lyr []dlItem
	sug := ""
	wg.Add(3)
	go func() { defer wg.Done(); orig = dlYtSearch(r.Context(), ytdlp, q) }()
	go func() {
		defer wg.Done()
		if lyricsLike {
			return
		}
		if s := dlSuggest(r.Context(), q); len(s) > 0 && !strings.EqualFold(strings.TrimSpace(s[0]), q) {
			sug = s[0]
			fixed = dlYtSearch(r.Context(), ytdlp, sug)
		}
	}()
	go func() {
		defer wg.Done()
		if lyricsLike {
			lyr = dlYtSearch(r.Context(), ytdlp, q+" lyrics")
		}
	}()
	wg.Wait()
	wantFix := dlWords(sug)
	seen := map[string]bool{}
	var all []dlItem
	add := func(list []dlItem) {
		for _, it := range list {
			if seen[it.ID] {
				continue
			}
			seen[it.ID] = true
			it.order = len(all)
			text := it.Title + " " + it.Channel
			it.score = max(dlMatch(want, text), dlMatch(wantFix, text))
			if it.Duration > 1200 { // mixes, podcasts and long streams are rarely what's wanted
				it.score -= 0.5
			}
			all = append(all, it)
		}
	}
	add(lyr)
	add(orig)
	add(fixed)
	best := 0.0
	for _, it := range all {
		if it.score > best {
			best = it.score
		}
	}
	// when the words typed are not in the titles (the words of the song itself, or a rough guess),
	// YouTube's own order is the best guide, so nothing is thrown away or re-ordered by title
	byTitle := !lyricsLike && best >= 0.34
	if byTitle {
		sort.SliceStable(all, func(i, j int) bool {
			if d := all[i].score - all[j].score; d > 0.01 || d < -0.01 {
				return all[i].score > all[j].score
			}
			return all[i].order < all[j].order
		})
		good := 0
		for _, it := range all {
			if it.score >= 0.5 {
				good++
			}
		}
		if good >= 2 {
			kept := all[:0]
			for _, it := range all {
				if it.score >= 0.3 {
					kept = append(kept, it)
				}
			}
			all = kept
		}
	} else {
		kept := all[:0]
		for _, it := range all {
			if it.Duration <= 1200 {
				kept = append(kept, it)
			}
		}
		if len(kept) > 0 {
			all = kept
		}
	}
	if len(all) > 12 {
		all = all[:12]
	}
	if len(all) == 0 {
		http.Error(w, "search failed — check your internet and try again", 502)
		return
	}
	resp := map[string]any{"results": all}
	dlCachePut(dlResCache, key, resp)
	writeJSON(w, resp)
}

// ---------- Spotify as a source: Nagham finds the song on Spotify, then gets the audio from YouTube Music
var dlSpotifyWeb = dlEnv("NAGHAM_DL_SPOTIFY_WEB", "https://open.spotify.com")

var dlSpTrackRe = regexp.MustCompile(`(?i)(?:open\.spotify\.com/(?:intl-[a-z-]+/)?track/|spotify:track:)([A-Za-z0-9]{10,30})`)

func dlSpotifyID(s string) string {
	if m := dlSpTrackRe.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}

type dlSpMeta struct {
	Title, Artist string
	Duration      float64
	Thumb         string
}

func dlSpotifyMeta(ctx context.Context, id string) (dlSpMeta, error) {
	if b, code, err := spDo("GET", "/v1/tracks/"+id, nil); err == nil && code == 200 {
		var t struct {
			Name    string  `json:"name"`
			DurMs   float64 `json:"duration_ms"`
			Artists []struct {
				Name string `json:"name"`
			} `json:"artists"`
			Album struct {
				Images []struct {
					URL string `json:"url"`
				} `json:"images"`
			} `json:"album"`
		}
		if json.Unmarshal(b, &t) == nil && t.Name != "" {
			var names []string
			for _, a := range t.Artists {
				names = append(names, a.Name)
			}
			m := dlSpMeta{Title: t.Name, Artist: strings.Join(names, ", "), Duration: t.DurMs / 1000}
			if len(t.Album.Images) > 0 {
				m.Thumb = t.Album.Images[0].URL // the biggest
			}
			return m, nil
		}
	}
	// not linked: the public song page names the song and the artist
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(cctx, "GET", dlSpotifyWeb+"/track/"+id, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
	req.Header.Set("Accept-Language", "en")
	resp, err := httpc.Do(req)
	if err != nil {
		return dlSpMeta{}, errors.New("couldn't reach Spotify")
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	page := string(body)
	if m := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`).FindStringSubmatch(page); m != nil {
		t := html.UnescapeString(strings.TrimSpace(m[1]))
		// "Song - song and lyrics by Artist | Spotify"   /   "Song - song by Artist | Spotify"
		if mm := regexp.MustCompile(`^(.*?)\s+-\s+(?:song(?: and lyrics)?)\s+by\s+(.*?)\s*\|\s*Spotify`).FindStringSubmatch(t); mm != nil {
			return dlSpMeta{Title: mm[1], Artist: mm[2]}, nil
		}
		if i := strings.Index(t, "|"); i > 0 {
			t = strings.TrimSpace(t[:i])
		}
		if t != "" && !strings.EqualFold(t, "spotify") {
			return dlSpMeta{Title: t}, nil
		}
	}
	return dlSpMeta{}, errors.New("couldn't read that Spotify link")
}

// returns false when Spotify itself can't search (no linked account, refused, nothing found): the caller then searches YouTube Music, which finds the same songs
func dlSearchSpotify(w http.ResponseWriter, r *http.Request, q string) bool {
	if id := dlSpotifyID(q); id != "" { // a pasted link: one result
		m, err := dlSpotifyMeta(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return true
		}
		writeJSON(w, map[string]any{"results": []dlItem{{ID: id, Title: m.Title, Channel: m.Artist, Duration: m.Duration, Thumb: m.Thumb, URL: "https://open.spotify.com/track/" + id}}})
		return true
	}
	spMu.Lock()
	linked := sp.RefreshToken != ""
	spMu.Unlock()
	if !linked {
		return false
	}
	// Spotify only accepts a small "limit" on search (it has been lowered over time), so try smaller ones when it refuses
	var b []byte
	var code int
	var err error
	for _, lim := range []int{10, 5, 0} {
		u := "/v1/search?type=track&q=" + url.QueryEscape(q)
		if lim > 0 {
			u += "&limit=" + strconv.Itoa(lim)
		}
		b, code, err = spDo("GET", u, nil)
		if err != nil || code == 200 || code != 400 {
			break
		}
	}
	if err != nil || code != 200 {
		return false
	}
	var sr struct {
		Tracks struct {
			Items []struct {
				ID      string  `json:"id"`
				Name    string  `json:"name"`
				DurMs   float64 `json:"duration_ms"`
				Artists []struct {
					Name string `json:"name"`
				} `json:"artists"`
				Album struct {
					Images []struct {
						URL string `json:"url"`
					} `json:"images"`
				} `json:"album"`
			} `json:"items"`
		} `json:"tracks"`
	}
	json.Unmarshal(b, &sr)
	res := []dlItem{}
	for _, t := range sr.Tracks.Items {
		var names []string
		for _, a := range t.Artists {
			names = append(names, a.Name)
		}
		it := dlItem{ID: t.ID, Title: t.Name, Channel: strings.Join(names, ", "), Duration: t.DurMs / 1000, URL: "https://open.spotify.com/track/" + t.ID}
		if n := len(t.Album.Images); n > 0 {
			it.Thumb = t.Album.Images[n-1].URL
		}
		res = append(res, it)
	}
	if len(res) == 0 {
		return false
	}
	writeJSON(w, map[string]any{"results": res})
	return true
}

// finds the best YouTube match for a Spotify song (same length ±; the artist and the title in the name)
func dlMatchOnYouTube(ctx context.Context, ytdlp string, m dlSpMeta) (dlItem, error) {
	l, err := dlRankOnYouTube(ctx, ytdlp, m)
	if err != nil {
		return dlItem{}, err
	}
	return l[0], nil
}

// every search result, best match first (the next ones are tried when a download fails)
func dlRankOnYouTube(ctx context.Context, ytdlp string, m dlSpMeta) ([]dlItem, error) {
	q := strings.TrimSpace(m.Artist + " " + m.Title)
	list := dlYtSearch(ctx, ytdlp, q+" audio")
	if len(list) == 0 {
		list = dlYtSearch(ctx, ytdlp, q)
	}
	if len(list) == 0 {
		return nil, errors.New("couldn't find this song on YouTube Music")
	}
	want := dlWords(q)
	scores := make([]float64, len(list))
	for i, it := range list {
		sc := dlMatch(want, it.Title+" "+it.Channel)*2 - float64(i)*0.02
		if m.Duration > 0 && it.Duration > 0 {
			d := it.Duration - m.Duration
			if d < 0 {
				d = -d
			}
			switch {
			case d <= 4:
				sc += 1.5
			case d <= 10:
				sc += 0.6
			case d > 30:
				sc -= 1.5
			}
		}
		lt := strings.ToLower(it.Title)
		for _, bad := range []string{"live", "cover", "remix", "karaoke", "reaction", "slowed", "sped up", "nightcore", "8d"} {
			if strings.Contains(lt, bad) && !strings.Contains(strings.ToLower(m.Title), bad) {
				sc -= 1
			}
		}
		scores[i] = sc
	}
	idx := make([]int, len(list))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return scores[idx[a]] > scores[idx[b]] })
	out := make([]dlItem, 0, len(list))
	for _, i := range idx {
		if len(out) < 3 && (len(out) == 0 || scores[i] > scores[idx[0]]-2) { // close enough to the best to be the same song
			out = append(out, list[i])
		}
	}
	return out, nil
}
