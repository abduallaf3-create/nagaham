package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Karaoke videos the user recorded of themselves go to  Videos\Nagham Karaoke
func karaokeDir() string {
	if d := os.Getenv("NAGHAM_KARAOKE_DIR"); d != "" {
		return d
	}
	h, err := os.UserHomeDir()
	if err != nil {
		h = "."
	}
	return filepath.Join(h, "Videos", "Nagham Karaoke")
}

var karBadName = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]+`)

func karaokeSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	ext := "webm"
	if r.URL.Query().Get("ext") == "mp4" {
		ext = "mp4"
	}
	name := strings.TrimSpace(karBadName.ReplaceAllString(r.URL.Query().Get("name"), " "))
	name = strings.Trim(name, ". ")
	if rn := []rune(name); len(rn) > 80 {
		name = strings.TrimSpace(string(rn[:80]))
	}
	if name == "" {
		name = "Karaoke"
	}
	dir := karaokeDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, "Couldn't create the folder: "+err.Error(), 500)
		return
	}
	path := filepath.Join(dir, name+" - "+time.Now().Format("2006-01-02 15.04.05")+"."+ext)
	f, err := os.Create(path)
	if err != nil {
		http.Error(w, "Couldn't save the video: "+err.Error(), 500)
		return
	}
	n, err := io.Copy(f, http.MaxBytesReader(w, r.Body, 4<<30))
	f.Close()
	if err != nil || n == 0 {
		os.Remove(path)
		http.Error(w, "Couldn't save the video", 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "path": path, "dir": dir, "bytes": n})
}

func karaokeOpen(w http.ResponseWriter, r *http.Request) {
	dir := karaokeDir()
	os.MkdirAll(dir, 0o755)
	openExternal(dir)
	writeJSON(w, map[string]any{"ok": true, "dir": dir})
}
