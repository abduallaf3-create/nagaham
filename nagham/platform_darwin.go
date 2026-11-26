//go:build darwin

package main

// The Mac: Nagham's window is the Mac app (mac/), which starts this server in the background.

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
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

// installUpdate: unpacks the new Nagham.app, then a small script (which outlives Nagham) waits for
// Nagham to close, swaps the app and opens the new one.
func installUpdate(zip string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, _ = filepath.EvalSymlinks(exe)
	app := filepath.Dir(filepath.Dir(filepath.Dir(exe))) // …/Nagham.app/Contents/MacOS/nagham-server
	if !strings.HasSuffix(app, ".app") {
		return errors.New("couldn't find Nagham.app")
	}
	if strings.Contains(app, "/AppTranslocation/") {
		return errors.New("move Nagham into your Applications folder first (drag it there from Downloads), open it from there, then update")
	}
	if f, err := os.CreateTemp(filepath.Dir(app), ".nagham-update-*"); err != nil {
		return errors.New("Nagham can't replace itself where it is — move it into your Applications folder, then update")
	} else {
		f.Close()
		os.Remove(f.Name())
	}
	dir := filepath.Join(filepath.Dir(zip), "unpacked")
	os.RemoveAll(dir)
	if out, err := exec.Command("/usr/bin/ditto", "-x", "-k", zip, dir).CombinedOutput(); err != nil {
		return errors.New("couldn't unpack the update: " + strings.TrimSpace(string(out)))
	}
	newApp := filepath.Join(dir, "Nagham.app")
	if _, err := os.Stat(filepath.Join(newApp, "Contents", "MacOS", "Nagham")); err != nil {
		return errors.New("the update doesn't contain Nagham.app")
	}
	script := filepath.Join(filepath.Dir(zip), "swap.sh")
	os.WriteFile(script, []byte(`#!/bin/sh
APP="$1"; NEW="$2"; PID="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
sleep 0.5
rm -rf "$APP.old"
if mv "$APP" "$APP.old" && mv "$NEW" "$APP"; then rm -rf "$APP.old"; else [ -d "$APP" ] || mv "$APP.old" "$APP"; fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
open "$APP"
`), 0o755)
	ui := os.Getppid() // the Mac app (Nagham's window)
	cmd := exec.Command("/bin/sh", script, app, newApp, strconv.Itoa(ui))
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return errors.New("couldn't start the update: " + err.Error())
	}
	updLog("mac update: swapping %s", app)
	go func() {
		syscall.Kill(ui, syscall.SIGTERM) // Nagham closes; the script puts the new one in place and opens it
	}()
	return nil
}
