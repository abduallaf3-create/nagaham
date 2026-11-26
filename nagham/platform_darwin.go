//go:build darwin

package main

// The Mac: Nagham's window is the Mac app (mac/), which starts this server in the background.

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const canPickFolder = true

func openWindow(url string, wait bool) bool {
	exec.Command("open", url).Start()
	return false
}

func openExternal(u string) { exec.Command("open", u).Start() }

// the Mac's own "choose a folder" window
func pickFolder() (string, error) {
	out, err := exec.Command("osascript", "-e", `POSIX path of (choose folder with prompt "Choose your music folder")`).Output()
	if err != nil {
		return "", errors.New("no folder chosen")
	}
	p := strings.TrimSpace(string(out))
	if p == "" {
		return "", errors.New("no folder chosen")
	}
	return strings.TrimSuffix(p, "/"), nil
}

func defaultMusicDir() string {
	if d := os.Getenv("NAGHAM_MUSIC"); d != "" {
		return d
	}
	if h, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(h, "Music")
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
	}
	return ""
}
