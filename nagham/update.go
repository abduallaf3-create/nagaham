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
	"time"
)

const appVersion = "3.1.0"

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

// POST /api/update/install – download the new installer and run it quietly
func updateInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
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
	asset, _ := setupAsset(rel)
	if asset == "" || !allowedDownload(asset) {
		http.Error(w, "this release has no NaghamSetup.exe attached", 400)
		return
	}
	if !newerVersion(rel.Tag, appVersion) {
		http.Error(w, "you already have the newest version", 400)
		return
	}
	c := http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 6 || !allowedDownload(req.URL.String()) {
			return errors.New("unexpected download location")
		}
		return nil
	}}
	resp, err := c.Get(asset)
	if err != nil {
		http.Error(w, "download failed: "+err.Error(), 502)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		http.Error(w, "download failed (HTTP "+strconv.Itoa(resp.StatusCode)+")", 502)
		return
	}
	dir := filepath.Join(os.TempDir(), "NaghamUpdate")
	os.MkdirAll(dir, 0o755)
	dst := filepath.Join(dir, "NaghamSetup-"+verString(rel.Tag)+".exe")
	f, err := os.Create(dst)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	n, err := io.Copy(f, io.LimitReader(resp.Body, 300<<20))
	f.Close()
	if err != nil || n < 1<<20 {
		os.Remove(dst)
		http.Error(w, "download was incomplete — try again", 502)
		return
	}
	if err := exec.Command(dst, "/S", "/launch").Start(); err != nil {
		http.Error(w, "couldn't start the installer: "+err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "version": verString(rel.Tag)})
	go func() { time.Sleep(1500 * time.Millisecond); os.Exit(0) }() // the installer replaces this copy and starts the new one
}

func verString(tag string) string {
	v := verParts(tag)
	return fmt.Sprintf("%d.%d.%d", v[0], v[1], v[2])
}
