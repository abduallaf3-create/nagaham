package main

// Backups of your playlists, likes, follows and settings: one a day automatically (the last 10 are kept),
// one any time from Settings, and restoring any of them. On the iPhone they're in Files → Nagham → Backups.

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

func backupDir() string {
	if d := os.Getenv("NAGHAM_BACKUPS"); d != "" {
		return d
	}
	return filepath.Join(dataDir, "Backups")
}

var backupNameRe = regexp.MustCompile(`^Nagham-backup-[0-9A-Za-z_-]+\.json$`)

func backupWrite(kind string) (string, error) {
	mu.Lock()
	b, err := json.MarshalIndent(map[string]any{"nagham": "backup", "v": 1, "app": appVersion, "at": time.Now().Format(time.RFC3339), "data": store.UserData}, "", " ")
	mu.Unlock()
	if err != nil {
		return "", err
	}
	os.MkdirAll(backupDir(), 0o755)
	name := "Nagham-backup-" + time.Now().Format("2006-01-02_15-04-05") + "-" + kind + ".json"
	tmp := filepath.Join(backupDir(), name+".tmp")
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, filepath.Join(backupDir(), name)); err != nil {
		return "", err
	}
	// keep the newest 10 automatic ones (the ones you made yourself are never deleted)
	if kind == "auto" {
		var autos []string
		for _, f := range backupList() {
			if strings.HasSuffix(f.Name, "-auto.json") {
				autos = append(autos, f.Name)
			}
		}
		for i := 10; i < len(autos); i++ {
			os.Remove(filepath.Join(backupDir(), autos[i]))
		}
	}
	return name, nil
}

type backupInfo struct {
	Name string `json:"name"`
	At   int64  `json:"at"`
	Size int64  `json:"size"`
	Auto bool   `json:"auto"`
}

func backupList() []backupInfo {
	ents, _ := os.ReadDir(backupDir())
	var out []backupInfo
	for _, e := range ents {
		if e.IsDir() || !backupNameRe.MatchString(e.Name()) {
			continue
		}
		if fi, err := e.Info(); err == nil {
			out = append(out, backupInfo{e.Name(), fi.ModTime().UnixMilli(), fi.Size(), strings.HasSuffix(e.Name(), "-auto.json")})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out
}

// one automatic backup a day, if there is anything to keep
func backupStart() {
	go func() {
		time.Sleep(20 * time.Second)
		for {
			mu.Lock()
			has := len(store.Playlists) > 0 || len(store.Liked) > 0 || len(store.Settings) > 2
			mu.Unlock()
			last := int64(0)
			for _, f := range backupList() {
				if f.Auto && f.At > last {
					last = f.At
				}
			}
			if has && time.Since(time.UnixMilli(last)) > 23*time.Hour {
				backupWrite("auto")
			}
			time.Sleep(time.Hour)
		}
	}()
}

// GET /api/backup → list · POST /api/backup {} → make one now · POST /api/backup {restore:"name"} or {data:{...}} → restore
func backupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeJSON(w, map[string]any{"backups": backupList(), "dir": backupDir(), "app": appVersion})
		return
	}
	var req struct {
		Restore string          `json:"restore"`
		Data    json.RawMessage `json:"data"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20)).Decode(&req)
	if req.Restore == "" && len(req.Data) == 0 {
		name, err := backupWrite("manual")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, map[string]any{"ok": true, "name": name, "dir": backupDir()})
		return
	}
	raw := req.Data
	if req.Restore != "" {
		if !backupNameRe.MatchString(req.Restore) {
			http.Error(w, "bad name", 400)
			return
		}
		b, err := os.ReadFile(filepath.Join(backupDir(), req.Restore))
		if err != nil {
			http.Error(w, "backup not found", 404)
			return
		}
		raw = b
	}
	var f struct {
		Nagham string    `json:"nagham"`
		Data   *UserData `json:"data"`
	}
	if json.Unmarshal(raw, &f) != nil || f.Nagham != "backup" || f.Data == nil {
		http.Error(w, "this isn't a Nagham backup", 400)
		return
	}
	backupWrite("before-restore") // so a restore can be undone
	mu.Lock()
	store.UserData = *f.Data
	saveStore()
	mu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}
