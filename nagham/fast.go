package main

// Speed: searching YouTube straight from Nagham (no yt-dlp program start), and yt-dlp kept unpacked
// in a folder. The single-file yt-dlp.exe unpacks ~50 MB into a temp folder every time it starts, and
// antivirus (Windows Defender) checks all of it again each time — on many PCs that alone took
// 10–30 seconds per search and per download.

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	dlYtdlpRepo   = dlEnv("NAGHAM_DL_YTDLP_REPO", "https://github.com/yt-dlp/yt-dlp/releases")
	dlYtdlpDirZip = dlEnv("NAGHAM_DL_YTDLP_ZIP", "yt-dlp_win.zip")
	dlInnertube   = dlEnv("NAGHAM_DL_INNERTUBE", "https://www.youtube.com/youtubei/v1/search?prettyPrint=false")
)

// the unpacked yt-dlp is used on Windows (where the single file is slow to start)
func dlUseDir() bool { return runtime.GOOS == "windows" || os.Getenv("NAGHAM_DL_YTDLP_USEDIR") == "1" }

func dlDirRoot() string { return filepath.Join(dlToolsDir(), "yt-dlp-dir") }

// the unpacked yt-dlp in use now ("" when there is none yet)
func dlDirExe() string {
	b, err := os.ReadFile(filepath.Join(dlDirRoot(), "current.txt"))
	if err != nil {
		return ""
	}
	tag := strings.TrimSpace(string(b))
	if tag == "" || strings.ContainsAny(tag, `/\`) {
		return ""
	}
	p := filepath.Join(dlDirRoot(), tag, dlExe("yt-dlp"))
	if st, err := os.Stat(p); err == nil && st.Size() > 0 {
		return p
	}
	return ""
}

func dlDirTag() string {
	b, _ := os.ReadFile(filepath.Join(dlDirRoot(), "current.txt"))
	return strings.TrimSpace(string(b))
}

// the newest yt-dlp version name (from where GitHub's "latest" link points)
func dlYtdlpLatestTag(ctx context.Context) (string, error) {
	c := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, _ := http.NewRequestWithContext(ctx, "GET", dlYtdlpRepo+"/latest", nil)
	req.Header.Set("User-Agent", "Nagham/"+appVersion)
	resp, err := c.Do(req)
	if err != nil {
		return "", err
	}
	resp.Body.Close()
	loc := resp.Header.Get("Location")
	i := strings.LastIndex(loc, "/tag/")
	if i < 0 {
		return "", fmt.Errorf("no version (HTTP %d)", resp.StatusCode)
	}
	tag := strings.TrimSpace(loc[i+5:])
	if tag == "" || strings.ContainsAny(tag, `/\?#`) || strings.Contains(tag, "..") {
		return "", errors.New("odd version name")
	}
	return tag, nil
}

// unpacks a whole zip into dst, keeping its folders
func dlUnzipAll(zp, dst string) error {
	zr, err := zip.OpenReader(zp)
	if err != nil {
		return err
	}
	defer zr.Close()
	n := 0
	for _, f := range zr.File {
		name := path.Clean(strings.ReplaceAll(f.Name, `\`, "/"))
		if name == "." || strings.HasPrefix(name, "../") || name == ".." || path.IsAbs(name) {
			continue
		}
		out := filepath.Join(dst, filepath.FromSlash(name))
		if f.FileInfo().IsDir() {
			os.MkdirAll(out, 0o755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		w, err := os.OpenFile(out, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
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
		n++
	}
	if n == 0 {
		return errors.New("the zip was empty")
	}
	return nil
}

var dlDirMu sync.Mutex

// gets (or updates to) the newest unpacked yt-dlp; a version already in place is kept until the new one is ready
func dlInstallYtdlpDir(ctx context.Context, pct func(float64)) error {
	dlDirMu.Lock()
	defer dlDirMu.Unlock()
	tag, err := dlYtdlpLatestTag(ctx)
	if err != nil {
		return err
	}
	if tag == dlDirTag() && dlDirExe() != "" {
		return nil
	}
	if err := os.MkdirAll(dlDirRoot(), 0o755); err != nil {
		return err
	}
	z := filepath.Join(dlDirRoot(), "download.zip")
	defer os.Remove(z)
	if err := dlFetch(dlYtdlpRepo+"/download/"+tag+"/"+dlYtdlpDirZip, z, pct); err != nil {
		return err
	}
	dir := filepath.Join(dlDirRoot(), tag)
	tmp := dir + ".part"
	os.RemoveAll(tmp)
	if err := dlUnzipAll(z, tmp); err != nil {
		os.RemoveAll(tmp)
		return err
	}
	// the zip has the program at the top, or inside one folder
	exe := filepath.Join(tmp, dlExe("yt-dlp"))
	if _, err := os.Stat(exe); err != nil {
		if ents, _ := os.ReadDir(tmp); len(ents) == 1 && ents[0].IsDir() {
			inner := filepath.Join(tmp, ents[0].Name())
			if _, err := os.Stat(filepath.Join(inner, dlExe("yt-dlp"))); err == nil {
				os.RemoveAll(dir)
				if err := os.Rename(inner, dir); err != nil {
					os.RemoveAll(tmp)
					return err
				}
				os.RemoveAll(tmp)
				goto ready
			}
		}
		os.RemoveAll(tmp)
		return errors.New("yt-dlp wasn't inside the zip")
	}
	os.RemoveAll(dir)
	if err := os.Rename(tmp, dir); err != nil {
		os.RemoveAll(tmp)
		return err
	}
ready:
	os.Chmod(filepath.Join(dir, dlExe("yt-dlp")), 0o755)
	// check it really starts before switching to it
	cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	out, err := hidden(exec.CommandContext(cctx, filepath.Join(dir, dlExe("yt-dlp")), "--version")).Output()
	cancel()
	if err != nil {
		os.RemoveAll(dir)
		return fmt.Errorf("the new yt-dlp didn't start: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dlDirRoot(), "current.txt"), []byte(tag), 0o644); err != nil {
		return err
	}
	os.WriteFile(filepath.Join(dlToolsDir(), "yt-dlp.updated"), []byte(time.Now().Format(time.RFC3339)), 0o644)
	log.Printf("yt-dlp (unpacked) %s ready", strings.TrimSpace(string(out)))
	return nil
}

// older unpacked versions are removed when Nagham starts (never while a download may still be using them)
func dlDirCleanup() {
	tag := dlDirTag()
	if tag == "" {
		return
	}
	if ents, err := os.ReadDir(dlDirRoot()); err == nil {
		for _, e := range ents {
			if e.IsDir() && e.Name() != tag {
				os.RemoveAll(filepath.Join(dlDirRoot(), e.Name()))
			}
		}
	}
}

// ---------- YouTube search without starting yt-dlp: asks YouTube's own web page API (well under a second)

var dlDurRe = regexp.MustCompile(`^(?:(\d+):)?(\d+):(\d+)$`)

func dlParseDur(s string) float64 {
	m := dlDurRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	se, _ := strconv.Atoi(m[3])
	return float64(h*3600 + mi*60 + se)
}

func dlRunsText(v any) string {
	m, _ := v.(map[string]any)
	if m == nil {
		return ""
	}
	if s, ok := m["simpleText"].(string); ok {
		return s
	}
	var b strings.Builder
	runs, _ := m["runs"].([]any)
	for _, r := range runs {
		if rm, ok := r.(map[string]any); ok {
			if t, ok := rm["text"].(string); ok {
				b.WriteString(t)
			}
		}
	}
	return b.String()
}

// every "videoRenderer" in the answer, in page order
func dlFindVideos(v any, out *[]map[string]any) {
	switch x := v.(type) {
	case map[string]any:
		if vr, ok := x["videoRenderer"].(map[string]any); ok {
			*out = append(*out, vr)
			return
		}
		// the page's own order: walk the keys that hold results first
		for _, k := range []string{"contents", "twoColumnSearchResultsRenderer", "primaryContents", "sectionListRenderer", "itemSectionRenderer"} {
			if c, ok := x[k]; ok {
				dlFindVideos(c, out)
			}
		}
		for k, c := range x {
			switch k {
			case "contents", "twoColumnSearchResultsRenderer", "primaryContents", "sectionListRenderer", "itemSectionRenderer":
				continue
			}
			if _, ok := c.(map[string]any); ok && strings.HasSuffix(k, "Renderer") && k != "shelfRenderer" && k != "reelShelfRenderer" {
				dlFindVideos(c, out)
			}
		}
	case []any:
		for _, c := range x {
			dlFindVideos(c, out)
		}
	}
}

func dlInnertubeSearch(ctx context.Context, q string) []dlItem {
	cctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cv := "2.20260708.00.00"
	body, _ := json.Marshal(map[string]any{
		"context": map[string]any{"client": map[string]any{"clientName": "WEB", "clientVersion": cv, "hl": "en"}},
		"query":   q,
		"params":  "EgIQAfABAQ==", // videos only (as yt-dlp asks)
	})
	req, _ := http.NewRequestWithContext(cctx, "POST", dlInnertube, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	req.Header.Set("X-YouTube-Client-Name", "1")
	req.Header.Set("X-YouTube-Client-Version", cv)
	req.Header.Set("Origin", "https://www.youtube.com")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("fast search: %v", err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		log.Printf("fast search: HTTP %d", resp.StatusCode)
		return nil
	}
	var v any
	if json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&v) != nil {
		return nil
	}
	var vids []map[string]any
	dlFindVideos(v, &vids)
	var res []dlItem
	seen := map[string]bool{}
	for _, vr := range vids {
		id, _ := vr["videoId"].(string)
		title := dlRunsText(vr["title"])
		if id == "" || title == "" || seen[id] {
			continue
		}
		dur := dlParseDur(dlRunsText(vr["lengthText"]))
		if dur == 0 { // live streams and upcoming videos have no length: not songs
			continue
		}
		seen[id] = true
		ch := dlRunsText(vr["ownerText"])
		if ch == "" {
			ch = dlRunsText(vr["longBylineText"])
		}
		res = append(res, dlItem{ID: id, Title: title, Channel: ch, Duration: dur,
			Thumb: "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg", URL: "https://www.youtube.com/watch?v=" + id})
		if len(res) >= 10 {
			break
		}
	}
	return res
}

var dlDirBgOnce sync.Once

// people who already have the single-file yt-dlp get the fast one in the background (once per run)
func dlDirBackground() {
	if !dlUseDir() || dlDirExe() != "" {
		return
	}
	dlDirBgOnce.Do(func() {
		go func() {
			if err := dlInstallYtdlpDir(context.Background(), func(float64) {}); err != nil {
				log.Printf("unpacked yt-dlp: %v", err)
			}
		}()
	})
}
