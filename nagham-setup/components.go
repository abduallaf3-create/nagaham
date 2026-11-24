//go:build windows

package main

// The only thing Nagham needs that might be missing on a PC is Microsoft's
// WebView2 runtime (the engine that draws its window). It's built into
// Windows 11 and most Windows 10 PCs; if it's missing we fetch Microsoft's
// official installer. Nagham does NOT use Python, Java or anything else.

import (
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

const webview2Bootstrapper = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

func webView2Installed() bool {
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if b := os.Getenv(env); b != "" {
			if m, _ := filepath.Glob(filepath.Join(b, `Microsoft\EdgeWebView\Application\*\msedgewebview2.exe`)); len(m) > 0 {
				return true
			}
		}
	}
	return false
}

// installWebView2 downloads and runs Microsoft's WebView2 bootstrapper silently.
func installWebView2() error {
	c := http.Client{Timeout: 3 * time.Minute}
	resp, err := c.Get(webview2Bootstrapper)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	p := filepath.Join(os.TempDir(), "MicrosoftEdgeWebview2Setup.exe")
	f, err := os.Create(p)
	if err != nil {
		return err
	}
	if _, err = io.Copy(f, io.LimitReader(resp.Body, 50<<20)); err != nil {
		f.Close()
		return err
	}
	f.Close()
	defer os.Remove(p)
	cmd := exec.Command(p, "/silent", "/install")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	done := make(chan error, 1)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-time.After(6 * time.Minute):
		cmd.Process.Kill()
		return os.ErrDeadlineExceeded
	}
}
