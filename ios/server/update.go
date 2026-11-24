package main

// Updates from GitHub Releases: Nagham looks at the latest release of its
// GitHub repository and, when it's newer, downloads the NaghamSetup.exe
// attached to it and installs it quietly.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const appVersion = "3.19.0"

// the GitHub repository ("owner/name") that new versions are published to;
// can also be set in Settings → About
var defaultUpdateRepo = "abduallaf3-create/nagaham"

var repoRe = regexp.MustCompile(`^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`)

func updateRepo() string {
	mu.Lock()
	raw := store.Settings
	mu.Unlock()
	var s struct {
		UpdateRepo string `json:"updateRepo"`
	}
	json.Unmarshal(raw, &s)
	r := cleanRepo(s.UpdateRepo)
	if r == "" {
		r = defaultUpdateRepo
	}
	return r
}

// accepts "owner/name" or a github.com link
func cleanRepo(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(strings.TrimSuffix(s, "/"), ".git")
	if i := strings.Index(s, "github.com/"); i >= 0 {
		s = s[i+len("github.com/"):]
	}
	parts := strings.Split(s, "/")
	if len(parts) >= 2 {
		s = parts[0] + "/" + parts[1]
	}
	if !repoRe.MatchString(s) {
		return ""
	}
	return s
}

func verParts(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(v), "v"), "V")
	var out [3]int
	for i, p := range strings.SplitN(v, ".", 3) {
		n := 0
		for _, c := range p {
			if c < '0' || c > '9' {
				break
			}
			n = n*10 + int(c-'0')
		}
		out[i] = n
	}
	return out
}

func newerVersion(latest, cur string) bool {
	a, b := verParts(latest), verParts(cur)
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

type ghRelease struct {
	Tag    string `json:"tag_name"`
	Name   string `json:"name"`
	Body   string `json:"body"`
	Page   string `json:"html_url"`
	Assets []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
		Size int64  `json:"size"`
	} `json:"assets"`
}

var ghAPI = func() string {
	if v := os.Getenv("NAGHAM_GH_API"); v != "" {
		return v
	}
	return "https://api.github.com"
}()

func latestRelease(repo string) (*ghRelease, error) {
	req, _ := http.NewRequest("GET", ghAPI+"/repos/"+repo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Nagham/"+appVersion)
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, errors.New("couldn't reach GitHub — check your internet connection")
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case 200:
	case 404:
		return nil, errors.New("no release found on " + repo + " (is the repository public and does it have a release?)")
	case 403, 429:
		return nil, errors.New("GitHub is busy — try again in a few minutes")
	default:
		return nil, fmt.Errorf("GitHub error (HTTP %d)", resp.StatusCode)
	}
	var r ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

func setupAsset(r *ghRelease) (string, int64) {
	best, size := "", int64(0)
	for _, a := range r.Assets {
		n := strings.ToLower(a.Name)
		if !strings.HasSuffix(n, ".exe") {
			continue
		}
		if strings.Contains(n, "setup") || best == "" {
			best, size = a.URL, a.Size
		}
	}
	return best, size
}

// GET /api/update/check
func updateCheck(w http.ResponseWriter, r *http.Request) {
	repo := updateRepo()
	out := map[string]any{"current": appVersion, "repo": repo}
	if repo == "" {
		out["error"] = "no repository set"
		writeJSON(w, out)
		return
	}
	rel, err := latestRelease(repo)
	if err != nil {
		out["error"] = err.Error()
		writeJSON(w, out)
		return
	}
	asset, size := setupAsset(rel)
	out["latest"] = strings.TrimPrefix(rel.Tag, "v")
	out["name"] = rel.Name
	out["notes"] = rel.Body
	out["page"] = rel.Page
	out["asset"] = asset != ""
	out["size"] = size
	out["newer"] = newerVersion(rel.Tag, appVersion) && asset != ""
	writeJSON(w, out)
}

func allowedDownload(u string) bool {
	p, err := url.Parse(u)
	if err != nil || p.Scheme != "https" {
		return false
	}
	h := strings.ToLower(p.Hostname())
	return h == "github.com" || strings.HasSuffix(h, ".githubusercontent.com")
}

// update progress, shown by the page as an animation
var (
	updMu   sync.Mutex
	updProg = map[string]any{"stage": "idle"}
)

func setUpd(kv ...any) {
	updMu.Lock()
	m := map[string]any{}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1]
	}
	updProg = m
	updMu.Unlock()
}

// GET /api/update/progress
func updateProgress(w http.ResponseWriter, r *http.Request) {
	updMu.Lock()
	m := updProg
	updMu.Unlock()
	writeJSON(w, m)
}

// POST /api/update/install – download the new installer (in the background) and run it quietly.
// The installer closes Nagham, puts the new version in place and opens it again.
func updateInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	updMu.Lock()
	busy := updProg["stage"] == "download" || updProg["stage"] == "install"
	updMu.Unlock()
	if busy {
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	repo := updateRepo()
	if repo == "" {
		http.Error(w, "no repository set", 400)
		return
	}
	rel, err := latestRelease(repo)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	asset, size := setupAsset(rel)
	if asset == "" || !allowedDownload(asset) {
		http.Error(w, "this release has no NaghamSetup.exe attached", 400)
		return
	}
	if !newerVersion(rel.Tag, appVersion) {
		http.Error(w, "you already have the newest version", 400)
		return
	}
	ver := verString(rel.Tag)
	setUpd("stage", "download", "pct", 0, "version", ver)
	go func() {
		fail := func(msg string) {
			updLog("update to %s failed: %s", ver, msg)
			setUpd("stage", "error", "error", msg, "version", ver)
		}
		c := http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 6 || !allowedDownload(req.URL.String()) {
				return errors.New("unexpected download location")
			}
			return nil
		}}
		resp, err := c.Get(asset)
		if err != nil {
			fail("download failed: " + err.Error())
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			fail("download failed (HTTP " + strconv.Itoa(resp.StatusCode) + ")")
			return
		}
		if resp.ContentLength > 0 {
			size = resp.ContentLength
		}
		dir := filepath.Join(os.TempDir(), "NaghamUpdate")
		os.MkdirAll(dir, 0o755)
		dst := filepath.Join(dir, "NaghamSetup-"+ver+".exe")
		f, err := os.Create(dst)
		if err != nil {
			fail(err.Error())
			return
		}
		var n int64
		buf := make([]byte, 64<<10)
		for {
			k, rerr := resp.Body.Read(buf)
			if k > 0 {
				if _, werr := f.Write(buf[:k]); werr != nil {
					f.Close()
					fail(werr.Error())
					return
				}
				n += int64(k)
				pct := 0
				if size > 0 {
					pct = int(n * 100 / size)
				}
				setUpd("stage", "download", "pct", pct, "version", ver)
			}
			if rerr == io.EOF {
				break
			}
			if rerr != nil {
				f.Close()
				fail("download was interrupted — try again")
				return
			}
		}
		f.Close()
		if n < 1<<20 || (size > 0 && n != size) {
			os.Remove(dst)
			fail("download was incomplete — try again")
			return
		}
		setUpd("stage", "install", "pct", 100, "version", ver)
		updLog("installing %s from %s", ver, dst)
		time.Sleep(900 * time.Millisecond) // let the page show "installing"
		if err := exec.Command(dst, "/S", "/launch").Start(); err != nil {
			fail("couldn't start the installer: " + err.Error())
			return
		}
		// the installer closes this copy; if it hasn't after a while, something stopped it
		time.Sleep(45 * time.Second)
		fail("the installer didn't finish — Windows may have blocked it. Download it from the GitHub page instead.")
	}()
	writeJSON(w, map[string]any{"ok": true, "version": ver})
}

func updLog(f string, a ...any) {
	if fh, err := os.OpenFile(filepath.Join(dataDir, "update.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		fmt.Fprintf(fh, time.Now().Format("2006-01-02 15:04:05 ")+f+"\n", a...)
		fh.Close()
	}
}

func verString(tag string) string {
	v := verParts(tag)
	return fmt.Sprintf("%d.%d.%d", v[0], v[1], v[2])
}
