package main

import (
	"crypto/sha1"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed web
var webFS embed.FS

const appName = "Nagham"

var audioExts = map[string]bool{
	".mp3": true, ".flac": true, ".m4a": true, ".aac": true, ".wav": true,
	".ogg": true, ".oga": true, ".opus": true, ".webm": true,
}

type Track struct {
	ID       string  `json:"id"`
	Path     string  `json:"path"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album"`
	TrackNo  int     `json:"trackNo"`
	Duration float64 `json:"duration"`
	HasCover bool    `json:"hasCover"`
	Added    int64   `json:"added"`
	Size     int64   `json:"size"`
	ModTime  int64   `json:"mtime"`
}

type Playlist struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Tracks  []string `json:"tracks"`
	Created int64    `json:"created"`
}

// UserData is owned by the UI and persisted verbatim by the server.
type UserData struct {
	Playlists []Playlist      `json:"playlists"`
	Liked     []string        `json:"liked"`
	Settings  json.RawMessage `json:"settings,omitempty"`
	Online    json.RawMessage `json:"online,omitempty"` // metadata of saved online songs
}

type Store struct {
	Folders []string          `json:"folders"`
	Tracks  map[string]*Track `json:"tracks"`
	UserData
}

var (
	mu       sync.Mutex
	store    = &Store{Tracks: map[string]*Track{}}
	dataDir  string
	scanning atomic.Bool
	scanned  atomic.Int64
	lastPing atomic.Int64
)

func trackID(p string) string {
	h := sha1.Sum([]byte(strings.ToLower(p)))
	return hex.EncodeToString(h[:6])
}

func storePath() string { return filepath.Join(dataDir, "library.json") }

func loadStore() {
	b, err := os.ReadFile(storePath())
	if err != nil {
		return
	}
	s := &Store{}
	if json.Unmarshal(b, s) == nil {
		if s.Tracks == nil {
			s.Tracks = map[string]*Track{}
		}
		store = s
	}
}

// saveStore must be called with mu held.
func saveStore() {
	b, err := json.Marshal(store)
	if err != nil {
		return
	}
	tmp := storePath() + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, storePath())
	}
}

func prettyFromFilename(p string) (title, artist string) {
	base := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
	base = strings.ReplaceAll(base, "_", " ")
	// strip leading track numbers like "01 - " or "01. "
	trim := strings.TrimLeft(base, "0123456789")
	if trim != base && len(trim) > 0 && strings.ContainsAny(trim[:1], " .-") {
		base = strings.TrimLeft(trim, " .-")
	}
	if i := strings.Index(base, " - "); i > 0 {
		return strings.TrimSpace(base[i+3:]), strings.TrimSpace(base[:i])
	}
	return strings.TrimSpace(base), ""
}

// a scan asked for while one is running runs again right after it (so songs saved meanwhile aren't missed)
var scanAgain atomic.Bool

func scanAll() {
	if !scanning.CompareAndSwap(false, true) {
		scanAgain.Store(true)
		return
	}
	defer func() {
		scanning.Store(false)
		if scanAgain.Swap(false) {
			go scanAll()
		}
	}()
	scanned.Store(0)
	mu.Lock()
	folders := append([]string(nil), store.Folders...)
	old := store.Tracks
	mu.Unlock()

	found := map[string]*Track{}
	now := time.Now().Unix()
	for _, root := range folders {
		filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				if d != nil && d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".") && p != root {
					return fs.SkipDir
				}
				return nil
			}
			if !audioExts[strings.ToLower(filepath.Ext(p))] {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			id := trackID(p)
			if t, ok := old[id]; ok && t.Size == info.Size() && t.ModTime == info.ModTime().Unix() && t.Title != "NA" && t.Artist != "NA" {
				found[id] = t
				scanned.Add(1)
				return nil
			}
			t := makeTrack(p, info, old[id], now)
			found[id] = t
			if scanned.Add(1)%50 == 0 { // publish progress
				mu.Lock()
				for k, v := range found {
					store.Tracks[k] = v
				}
				mu.Unlock()
			}
			return nil
		})
	}
	mu.Lock()
	store.Tracks = found
	saveStore()
	mu.Unlock()
}

// makeTrack reads one audio file's tags (o: what we knew about it before, if anything)
func makeTrack(p string, info fs.FileInfo, o *Track, now int64) *Track {
	m := readMeta(p, false)
	// "NA" is what an older Nagham wrote into some downloaded songs by mistake: the file name has the real name
	if m.Title == "NA" {
		m.Title = ""
	}
	if m.Artist == "NA" {
		m.Artist = ""
	}
	if m.Album == "NA" {
		m.Album = ""
	}
	t := &Track{ID: trackID(p), Path: p, Title: m.Title, Artist: m.Artist, Album: m.Album,
		TrackNo: m.TrackNo, Duration: m.Duration, HasCover: m.Cover != nil,
		Added: now, Size: info.Size(), ModTime: info.ModTime().Unix()}
	if o != nil {
		t.Added = o.Added
		if t.Duration == 0 {
			t.Duration = o.Duration
		}
	}
	ft, fa := prettyFromFilename(p)
	if t.Title == "" {
		t.Title = ft
	}
	if t.Artist == "" {
		t.Artist = fa
	}
	if t.Artist == "" {
		t.Artist = "Unknown artist"
	}
	if t.Album == "" {
		t.Album = filepath.Base(filepath.Dir(p))
	}
	return t
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

func stateHandler(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	tracks := make([]*Track, 0, len(store.Tracks))
	for _, t := range store.Tracks {
		tracks = append(tracks, t)
	}
	resp := map[string]any{
		"folders":   store.Folders,
		"playlists": store.Playlists,
		"liked":     store.Liked,
		"settings":  store.Settings,
		"online":    store.Online,
		"scanning":  scanning.Load(),
		"scanned":   scanned.Load(),
		"canPick":   canPickFolder,
	}
	mu.Unlock()
	sort.Slice(tracks, func(i, j int) bool {
		a, b := tracks[i], tracks[j]
		if !strings.EqualFold(a.Artist, b.Artist) {
			return strings.ToLower(a.Artist) < strings.ToLower(b.Artist)
		}
		if a.Album != b.Album {
			return a.Album < b.Album
		}
		if a.TrackNo != b.TrackNo {
			return a.TrackNo < b.TrackNo
		}
		return a.Title < b.Title
	})
	resp["tracks"] = tracks
	if resp["playlists"] == nil {
		resp["playlists"] = []Playlist{}
	}
	if resp["liked"] == nil {
		resp["liked"] = []string{}
	}
	if resp["folders"] == nil {
		resp["folders"] = []string{}
	}
	writeJSON(w, resp)
}

func addFolder(p string) error {
	p = filepath.Clean(strings.Trim(strings.TrimSpace(p), `"`))
	st, err := os.Stat(p)
	if err != nil || !st.IsDir() {
		return fmt.Errorf("folder not found: %s", p)
	}
	mu.Lock()
	for _, f := range store.Folders {
		if strings.EqualFold(f, p) {
			mu.Unlock()
			go scanAll()
			return nil
		}
	}
	store.Folders = append(store.Folders, p)
	saveStore()
	mu.Unlock()
	go scanAll()
	return nil
}

func apiFolders(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
		Path   string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	switch req.Action {
	case "pick":
		p, err := pickFolder()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if p == "" {
			writeJSON(w, map[string]any{"ok": false, "cancelled": true})
			return
		}
		if err := addFolder(p); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
	case "add":
		if err := addFolder(req.Path); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
	case "remove":
		mu.Lock()
		out := store.Folders[:0]
		for _, f := range store.Folders {
			if f != req.Path {
				out = append(out, f)
			}
		}
		store.Folders = out
		saveStore()
		mu.Unlock()
		go scanAll()
	case "rescan":
		go scanAll()
	}
	time.Sleep(150 * time.Millisecond)
	writeJSON(w, map[string]any{"ok": true})
}

func apiUserData(w http.ResponseWriter, r *http.Request) {
	var u UserData
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20)).Decode(&u); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	mu.Lock()
	store.UserData = u
	saveStore()
	mu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

func apiDurations(w http.ResponseWriter, r *http.Request) {
	var d map[string]float64
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	mu.Lock()
	for id, v := range d {
		if t, ok := store.Tracks[id]; ok && v > 0 {
			t.Duration = v
		}
	}
	saveStore()
	mu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

func lookup(id string) *Track {
	mu.Lock()
	defer mu.Unlock()
	return store.Tracks[id]
}

func audioHandler(w http.ResponseWriter, r *http.Request) {
	t := lookup(strings.TrimPrefix(r.URL.Path, "/audio/"))
	if t == nil {
		http.NotFound(w, r)
		return
	}
	ct := map[string]string{".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac",
		".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".webm": "audio/webm"}
	if c, ok := ct[strings.ToLower(filepath.Ext(t.Path))]; ok {
		w.Header().Set("Content-Type", c)
	}
	http.ServeFile(w, r, t.Path)
}

func coverHandler(w http.ResponseWriter, r *http.Request) {
	t := lookup(strings.TrimPrefix(r.URL.Path, "/cover/"))
	if t == nil {
		http.NotFound(w, r)
		return
	}
	m := readMeta(t.Path, true)
	if len(m.Cover) > 0 {
		mime := m.CoverMime
		if !strings.HasPrefix(mime, "image/") {
			mime = http.DetectContentType(m.Cover)
		}
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Cache-Control", "max-age=86400")
		w.Write(m.Cover)
		return
	}
	// fall back to folder art (cover.jpg, folder.jpg, ...)
	dir := filepath.Dir(t.Path)
	for _, n := range []string{"cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "album.jpg", "AlbumArtSmall.jpg"} {
		p := filepath.Join(dir, n)
		if _, err := os.Stat(p); err == nil {
			w.Header().Set("Cache-Control", "max-age=86400")
			http.ServeFile(w, r, p)
			return
		}
	}
	http.NotFound(w, r)
}

// set once the server is listening (used by the iPhone app, which runs Nagham inside itself)
var (
	portReady    = make(chan int, 1)
	serveHandler http.Handler
	servePort    int
)

func main() {
	if handleUninstall() {
		return
	}
	cfg, err := os.UserConfigDir()
	if err != nil {
		cfg = os.TempDir()
	}
	dataDir = filepath.Join(cfg, "Nagham")
	if d := os.Getenv("NAGHAM_DATA"); d != "" { // the iPhone app passes its own folder
		dataDir = d
	}
	if _, err := os.Stat(dataDir); os.IsNotExist(err) { // bring over the library from Pulse
		if b, err := os.ReadFile(filepath.Join(cfg, "PulsePlayer", "library.json")); err == nil {
			os.MkdirAll(dataDir, 0o755)
			os.WriteFile(filepath.Join(dataDir, "library.json"), b, 0o644)
		}
	}
	os.MkdirAll(dataDir, 0o755)
	if runNativeWindow() { // "Nagham.exe --window <url>": just the window
		return
	}
	if lf, err := os.OpenFile(filepath.Join(dataDir, "nagham.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644); err == nil {
		log.SetOutput(lf)
	}

	// single instance: if one is already running, just open another window to it
	portFile := filepath.Join(dataDir, "port")
	if b, err := os.ReadFile(portFile); err == nil {
		url := "http://127.0.0.1:" + strings.TrimSpace(string(b)) + "/"
		c := http.Client{Timeout: 700 * time.Millisecond}
		if resp, err := c.Get(url + "api/ping"); err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			openWindow(url, false)
			return
		}
	}

	loadStore()
	dropLinkedAccounts()
	dcLoad()
	dcStart()
	backupStart()
	if runtime.GOOS != "ios" { // the iPhone can't run download tools (yt-dlp / FFmpeg)
		songFixStart()
		dlUpdateStart()
		dlPrepareStart()
	}
	if len(store.Folders) == 0 {
		if d := defaultMusicDir(); d != "" {
			store.Folders = []string{d}
		}
	}
	go scanAll()
	go watchFolders()

	sub, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	mux.HandleFunc("/api/state", stateHandler)
	mux.HandleFunc("/api/dl/info", dlInfo)
	mux.HandleFunc("/api/dl/search", dlSearch)
	mux.HandleFunc("/api/dl/suggest", dlSuggestHandler)
	mux.HandleFunc("/api/dl/start", dlStart)
	mux.HandleFunc("/api/dl/job", dlJobGet)
	mux.HandleFunc("/api/dl/cancel", dlCancel)
	mux.HandleFunc("/api/dl/expand", dlExpand)
	mux.HandleFunc("/api/dl/batch", dlBatch)
	mux.HandleFunc("/api/report", dlReport)
	mux.HandleFunc("/api/folders", apiFolders)
	mux.HandleFunc("/api/userdata", apiUserData)
	mux.HandleFunc("/api/backup", backupHandler)
	mux.HandleFunc("/api/durations", apiDurations)
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/audio/", audioHandler)
	mux.HandleFunc("/cover/", coverHandler)
	mux.HandleFunc("/api/online/search", onlineSearch)
	mux.HandleFunc("/api/online/home", onlineHome)
	mux.HandleFunc("/api/online/album", onlineAlbum)
	mux.HandleFunc("/api/online/artist", onlineArtist)
	mux.HandleFunc("/api/online/artistsongs", onlineArtistSongs)
	mux.HandleFunc("/api/online/fresh", onlineFresh)
	mux.HandleFunc("/api/online/track", onlineTrack)
	mux.HandleFunc("/api/online/radio", onlineRadio)
	mux.HandleFunc("/api/lyrics", lyricsHandler)
	mux.HandleFunc("/api/karaoke/save", karaokeSave)
	mux.HandleFunc("/api/karaoke/open", karaokeOpen)
	mux.HandleFunc("/api/remote/state", remoteState)
	mux.HandleFunc("/api/remote/cmd", remoteCmd)
	mux.HandleFunc("/api/remote/cmds", remoteCmds)
	mux.HandleFunc("/api/mini", miniWindow)
	mux.HandleFunc("/api/window/show", windowShow)
	mux.HandleFunc("/api/newsongs", newSongs)
	mux.HandleFunc("/api/import", importFile)
	mux.HandleFunc("/api/online/ytinfo", ytInfo)
	mux.HandleFunc("/stream/", streamHandler)
	mux.HandleFunc("/img", imgProxy)
	mux.HandleFunc("/api/window/state", windowStatePost)
	mux.HandleFunc("/api/ui/ready", uiReady)
	mux.HandleFunc("/api/log", clientLog)
	mux.HandleFunc("/api/window/wait", windowStateWait)
	mux.HandleFunc("/api/discord/status", discordStatus)
	mux.HandleFunc("/api/discord/config", discordConfig)
	mux.HandleFunc("/api/discord/activity", discordActivity)
	mux.HandleFunc("/api/openurl", openURLHandler)
	mux.HandleFunc("/api/ytm", ytmPanel)
	mux.HandleFunc("/api/ytm/state", ytmState)
	mux.HandleFunc("/api/ytm/js", ytmJSHandler)
	mux.HandleFunc("/api/ytm/adjs", ytmAdJSHandler)
	mux.HandleFunc("/api/yt/acct", ytAcctHandler)
	mux.HandleFunc("/api/yt/acct/result", ytAcctResult)
	mux.HandleFunc("/api/yt/acct/js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		io.WriteString(w, acctJS)
	})
	mux.HandleFunc("/api/update/check", updateCheck)
	mux.HandleFunc("/api/update/install", updateInstall)
	mux.HandleFunc("/api/update/progress", updateProgress)

	addr := os.Getenv("NAGHAM_ADDR")
	if addr == "" {
		addr = "127.0.0.1:0"
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	os.WriteFile(portFile, []byte(fmt.Sprint(port)), 0o644)
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	log.Println("listening on", url)

	// Only accept requests addressed to localhost (DNS-rebinding protection).
	guard := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Host
		if i := strings.LastIndexByte(h, ':'); i >= 0 {
			h = h[:i]
		}
		if h != "127.0.0.1" && h != "localhost" {
			http.Error(w, "forbidden", 403)
			return
		}
		mux.ServeHTTP(w, r)
	})
	go http.Serve(ln, guard)
	serveHandler, servePort = guard, port
	select {
	case portReady <- port:
	default:
	}

	if os.Getenv("NAGHAM_HEADLESS") != "" {
		if os.Getenv("NAGHAM_NATIVE") == "1" { // the Mac app is Nagham's window: it plays YouTube Music hidden, like the PC window
			nativeWindowActive.Store(true)
			go func() { // the Mac app went away (even if it crashed): stop too
				for {
					time.Sleep(2 * time.Second)
					if os.Getppid() == 1 {
						// only our own note: a new Nagham (after an update) may already have written its port
						if b, _ := os.ReadFile(portFile); strings.TrimSpace(string(b)) == fmt.Sprint(port) {
							os.Remove(portFile)
						}
						os.Exit(0)
					}
				}
			}()
		}
		select {}
	}
	if openWindow(url, true) {
		os.Remove(portFile)
		return // the app window was closed
	}
	// Fallback (default browser): stay alive while the page keeps pinging.
	lastPing.Store(time.Now().Unix() + 60)
	for {
		time.Sleep(5 * time.Second)
		if time.Now().Unix()-lastPing.Load() > 45 {
			os.Remove(portFile)
			return
		}
	}
}
