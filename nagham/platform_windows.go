//go:build windows

package main

import (
	"errors"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const canPickFolder = true

const createNoWindow = 0x08000000

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

func findBrowser() string {
	var cands []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if b := os.Getenv(env); b != "" {
			cands = append(cands,
				filepath.Join(b, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(b, `Google\Chrome\Application\chrome.exe`),
				filepath.Join(b, `BraveSoftware\Brave-Browser\Application\brave.exe`))
		}
	}
	for _, c := range cands {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

// openWindow shows the UI. With wait=true it blocks until the window is closed
// and returns true. It first tries Nagham's own themed window (WebView2) and
// falls back to a chromeless Edge/Chrome app window.
func openWindow(url string, wait bool) bool {
	if !wait { // another launch while Nagham is running: open one more window
		if mode, bg := windowPrefs(); mode != "classic" {
			if exe, err := os.Executable(); err == nil && exec.Command(exe, "--window", url, bg).Start() == nil {
				return true
			}
		}
	}
	if wait {
		if mode, bg := windowPrefs(); mode != "classic" {
			if exe, err := os.Executable(); err == nil {
				cmd := exec.Command(exe, "--window", url, bg)
				started := time.Now()
				if cmd.Start() == nil {
					nativeWindowActive.Store(true)
					defer nativeWindowActive.Store(false)
					uiReadyAt.Store(0)
					exited := make(chan error, 1)
					go func() { exited <- cmd.Wait() }()
					var err error
					// the page must report "ready" in time, otherwise use the Edge window instead
				wait:
					for {
						select {
						case err = <-exited:
							break wait
						case <-time.After(500 * time.Millisecond):
							if uiReadyAt.Load() == 0 && time.Since(started) > 35*time.Second {
								log.Printf("native window never became ready; switching to Edge window")
								cmd.Process.Kill()
								<-exited
								return openEdgeWindow(url, wait)
							}
						}
					}
					code := 0
					if cmd.ProcessState != nil {
						code = cmd.ProcessState.ExitCode()
					}
					if err == nil && code == 0 {
						return true // the user closed the window
					}
					if code != exitNoWebView && uiReadyAt.Load() != 0 {
						return true // it was working; treat as closed
					}
					log.Printf("native window unavailable (exit %d), using Edge window", code)
				}
			}
		}
	}
	return openEdgeWindow(url, wait)
}

func openEdgeWindow(url string, wait bool) bool {
	if b := findBrowser(); b != "" {
		profile := filepath.Join(dataDir, "window")
		cmd := exec.Command(b, "--app="+url, "--user-data-dir="+profile,
			"--no-first-run", "--no-default-browser-check", "--disable-features=Translate",
			"--autoplay-policy=no-user-gesture-required", "--window-size=1280,820")
		if err := cmd.Start(); err == nil {
			if !wait {
				return true
			}
			started := time.Now()
			cmd.Wait()
			// If the browser handed the window off to another process and exited
			// straight away, fall back to the keep-alive ping loop instead.
			return time.Since(started) > 5*time.Second
		}
	}
	hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", url)).Start()
	return false
}

func openExternal(u string) {
	hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", u)).Start()
}

func pickFolder() (string, error) {
	ps := `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false}
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose a folder with your music - Nagham'
$d.ShowNewFolderButton = $false
if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }`
	out, err := hidden(exec.Command("powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", ps)).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func defaultMusicDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(h, "Music")
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
	}
	return ""
}

// installUpdate starts the downloaded installer (it closes this copy and opens the new one)
func installUpdate(setup string) error {
	if err := exec.Command(setup, "/S", "/launch").Start(); err != nil {
		return errors.New("couldn't start the installer: " + err.Error())
	}
	return nil
}
