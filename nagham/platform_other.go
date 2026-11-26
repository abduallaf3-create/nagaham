//go:build !windows && !darwin

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

const canPickFolder = false

func openWindow(url string, wait bool) bool {
	exec.Command("xdg-open", url).Start()
	return false
}

func openExternal(u string) { exec.Command("xdg-open", u).Start() }

func pickFolder() (string, error) { return "", errors.New("folder picker not available on this OS") }

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
