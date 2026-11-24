package main

// New songs: Nagham keeps an eye on your music folders (for example the folder
// another app saves into) and on files dropped onto its window, and asks where
// each new song should go.

import (
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	newMu   sync.Mutex
	newSeq  int
	newList []newSong
	pending = map[string]int64{} // path → size seen last time (waits until a file stops growing)
)

type newSong struct {
	Seq int    `json:"seq"`
	ID  string `json:"id"`
}

func announceNew(ids ...string) {
	newMu.Lock()
	for _, id := range ids {
		newSeq++
		newList = append(newList, newSong{newSeq, id})
	}
	if len(newList) > 200 {
		newList = append([]newSong(nil), newList[len(newList)-200:]...)
	}
	newMu.Unlock()
}

// watchFolders looks for new audio files every few seconds
func watchFolders() {
	time.Sleep(20 * time.Second) // let the first scan finish
	for {
		time.Sleep(6 * time.Second)
		if scanning.Load() {
			continue
		}
		mu.Lock()
		folders := append([]string(nil), store.Folders...)
		known := make(map[string]bool, len(store.Tracks))
		for id := range store.Tracks {
			known[id] = true
		}
		mu.Unlock()
		now := time.Now()
		var added []*Track
		seen := map[string]bool{}
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
				if !audioExts[strings.ToLower(filepath.Ext(p))] || known[trackID(p)] {
					return nil
				}
				info, err := d.Info()
				if err != nil || info.Size() == 0 {
					return nil
				}
				seen[p] = true
				// only once the file has stopped changing (still downloading otherwise)
				if last, ok := pending[p]; !ok || last != info.Size() || now.Sub(info.ModTime()) < 3*time.Second {
					pending[p] = info.Size()
					return nil
				}
				delete(pending, p)
				added = append(added, makeTrack(p, info, nil, now.Unix()))
				return nil
			})
		}
		for p := range pending {
			if !seen[p] {
				delete(pending, p)
			}
		}
		if len(added) == 0 {
			continue
		}
		ids := make([]string, 0, len(added))
		mu.Lock()
		for _, t := range added {
			store.Tracks[t.ID] = t
			ids = append(ids, t.ID)
		}
		saveStore()
		mu.Unlock()
		announceNew(ids...)
		log.Printf("new songs: %d", len(ids))
	}
}

// GET /api/newsongs?after=N → songs that arrived since N (after=-1: just the position)
func newSongs(w http.ResponseWriter, r *http.Request) {
	after, err := strconv.Atoi(r.URL.Query().Get("after"))
	newMu.Lock()
	defer newMu.Unlock()
	out := []*Track{}
	if err == nil && after >= 0 {
		for _, n := range newList {
			if n.Seq > after {
				if t := lookupNoLock(n.ID); t != nil {
					out = append(out, t)
				}
			}
		}
	}
	writeJSON(w, map[string]any{"seq": newSeq, "tracks": out})
}

func lookupNoLock(id string) *Track {
	mu.Lock()
	defer mu.Unlock()
	return store.Tracks[id]
}

// POST /api/import?name=song.mp3 (raw file body) – a file dropped onto Nagham's window
func importFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	name := filepath.Base(r.URL.Query().Get("name"))
	ext := strings.ToLower(filepath.Ext(name))
	if !audioExts[ext] {
		http.Error(w, "That isn't a song file Nagham can play", 400)
		return
	}
	name = strings.Map(func(c rune) rune {
		if strings.ContainsRune(`<>:"/\|?*`, c) || c < 32 {
			return '_'
		}
		return c
	}, name)
	mu.Lock()
	var root string
	if len(store.Folders) > 0 {
		root = store.Folders[0]
	}
	mu.Unlock()
	if root == "" {
		root = defaultMusicDir()
	}
	if root == "" {
		root = filepath.Join(dataDir, "Music")
	}
	dir := filepath.Join(root, "Nagham imports")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	dst := filepath.Join(dir, name)
	base := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ { // never overwrite
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			break
		}
		dst = filepath.Join(dir, fmt.Sprintf("%s_%d%s", base, i, ext))
	}
	f, err := os.Create(dst)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	n, err := io.Copy(f, http.MaxBytesReader(w, r.Body, 1<<30))
	f.Close()
	if err != nil || n == 0 {
		os.Remove(dst)
		http.Error(w, "the file didn't arrive in full", 400)
		return
	}
	info, _ := os.Stat(dst)
	t := makeTrack(dst, info, nil, time.Now().Unix())
	mu.Lock()
	inLib := false
	for _, f := range store.Folders {
		if strings.HasPrefix(strings.ToLower(dst), strings.ToLower(f)) {
			inLib = true
		}
	}
	if !inLib {
		store.Folders = append(store.Folders, root)
	}
	store.Tracks[t.ID] = t
	saveStore()
	mu.Unlock()
	writeJSON(w, map[string]any{"ok": true, "track": t})
}
