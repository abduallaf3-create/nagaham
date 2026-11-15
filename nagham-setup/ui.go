//go:build windows

package main

// Animated setup: a small local web page shown in an Edge app window.

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

//go:embed ui
var uiFS embed.FS

type progress struct {
	Step      int    `json:"step"`
	Total     int    `json:"total"`
	Label     string `json:"label"`
	Done      bool   `json:"done"`
	Error     string `json:"error,omitempty"`
	NeedClose bool   `json:"needClose,omitempty"`
}

var (
	pmu  sync.Mutex
	prog = progress{Total: 6}
)

func setProg(step int, label string) {
	pmu.Lock()
	prog.Step, prog.Label = step, label
	pmu.Unlock()
}

func installDirs() (dir, exe string) {
	dir = filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Nagham")
	return dir, filepath.Join(dir, "Nagham.exe")
}

var errRunning = errors.New("running")

func doInstall(desktop bool) error {
	dir, exe := installDirs()
	setProg(1, "Checking what this PC needs")
	if !webView2Installed() {
		setProg(1, "Installing Microsoft WebView2")
		if err := installWebView2(); err != nil {
			logSetup("webview2 install failed: %v", err) // Nagham can still use an Edge window
		}
	} else {
		time.Sleep(450 * time.Millisecond)
	}
	setProg(2, "Getting ready")
	time.Sleep(300 * time.Millisecond)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("Couldn't create the program folder: %v", err)
	}
	setProg(3, "Copying Nagham")
	tmp := exe + ".new"
	if err := os.WriteFile(tmp, payload, 0o755); err != nil {
		return fmt.Errorf("Couldn't copy Nagham: %v", err)
	}
	os.Remove(exe)
	if err := os.Rename(tmp, exe); err != nil {
		os.Remove(tmp)
		return errRunning
	}
	time.Sleep(350 * time.Millisecond)
	setProg(4, "Adding shortcuts")
	shortcut(filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs\Nagham.lnk`), exe, dir)
	if desktop {
		shortcut(filepath.Join(desktopDir(), "Nagham.lnk"), exe, dir)
	}
	setProg(5, "Registering with Windows")
	key := `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nagham`
	add := func(name, typ, val string) { run("reg", "add", key, "/v", name, "/t", typ, "/d", val, "/f") }
	add("DisplayName", "REG_SZ", "Nagham")
	add("DisplayVersion", "REG_SZ", version)
	add("Publisher", "REG_SZ", "Nagham")
	add("DisplayIcon", "REG_SZ", exe+",0")
	add("InstallLocation", "REG_SZ", dir)
	add("UninstallString", "REG_SZ", `"`+exe+`" --uninstall`)
	add("EstimatedSize", "REG_DWORD", fmt.Sprint(len(payload)/1024))
	add("NoModify", "REG_DWORD", "1")
	add("NoRepair", "REG_DWORD", "1")
	setProg(6, "Finishing up")
	time.Sleep(500 * time.Millisecond)
	return nil
}

func findEdge() string {
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if b := os.Getenv(env); b != "" {
			for _, p := range []string{`Microsoft\Edge\Application\msedge.exe`, `Google\Chrome\Application\chrome.exe`} {
				if f := filepath.Join(b, p); fileExists(f) {
					return f
				}
			}
		}
	}
	return ""
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func logSetup(f string, a ...any) {
	if fh, err := os.OpenFile(filepath.Join(os.TempDir(), "NaghamSetup.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		fmt.Fprintf(fh, time.Now().Format("2006-01-02 15:04:05 ")+f+"\n", a...)
		fh.Close()
	}
}

func main() {
	for _, a := range os.Args[1:] { // NaghamSetup.exe /S – silent install, no window
		if a == "/S" || a == "/s" || a == "--silent" {
			err := doInstall(true)
			if err == errRunning {
				run("taskkill", "/F", "/IM", "Nagham.exe")
				time.Sleep(1200 * time.Millisecond)
				err = doInstall(true)
			}
			if err != nil {
				logSetup("silent install failed: %v", err)
				os.Exit(1)
			}
			for _, b := range os.Args[1:] { // /launch – start the new version (used by Nagham's updater)
				if b == "/launch" || b == "--launch" {
					_, exe := installDirs()
					exec.Command(exe).Start()
				}
			}
			return
		}
	}
	edge := findEdge()
	if edge == "" || os.Getenv("LOCALAPPDATA") == "" {
		classicInstall()
		return
	}
	sub, _ := fs.Sub(uiFS, "ui")
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	js := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
	_, exe := installDirs()
	var hello atomic.Bool
	mux.HandleFunc("/api/hello", func(w http.ResponseWriter, r *http.Request) { hello.Store(true); js(w, map[string]any{"ok": true}) })
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		hello.Store(true)
		js(w, map[string]any{"version": version, "update": fileExists(exe), "size": len(payload) / (1 << 20)})
	})
	var installing sync.Mutex
	mux.HandleFunc("/api/install", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Desktop bool `json:"desktop"`
			Kill    bool `json:"kill"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if !installing.TryLock() {
			js(w, map[string]any{"ok": false})
			return
		}
		pmu.Lock()
		prog = progress{Total: 6}
		pmu.Unlock()
		go func() {
			defer installing.Unlock()
			if req.Kill {
				run("taskkill", "/F", "/IM", "Nagham.exe")
				time.Sleep(1200 * time.Millisecond)
			}
			err := doInstall(req.Desktop)
			pmu.Lock()
			defer pmu.Unlock()
			switch {
			case err == errRunning:
				prog.NeedClose = true
			case err != nil:
				prog.Error = err.Error()
			default:
				prog.Done = true
			}
		}()
		js(w, map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/progress", func(w http.ResponseWriter, r *http.Request) {
		pmu.Lock()
		p := prog
		pmu.Unlock()
		js(w, p)
	})
	var ui *exec.Cmd
	quit := func() {
		go func() {
			time.Sleep(400 * time.Millisecond)
			if ui != nil && ui.Process != nil {
				ui.Process.Kill()
			}
			os.Exit(0)
		}()
	}
	mux.HandleFunc("/api/launch", func(w http.ResponseWriter, r *http.Request) {
		cmd := exec.Command(exe)
		cmd.Dir = filepath.Dir(exe)
		cmd.Start()
		js(w, map[string]any{"ok": true})
		quit()
	})
	mux.HandleFunc("/api/quit", func(w http.ResponseWriter, r *http.Request) { js(w, map[string]any{"ok": true}); quit() })

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		classicInstall()
		return
	}
	go http.Serve(ln, mux)
	url := fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)
	profile := filepath.Join(os.TempDir(), "NaghamSetupUI")
	ui = exec.Command(edge, "--app="+url, "--user-data-dir="+profile, "--no-first-run", "--no-default-browser-check",
		"--window-size=860,620", "--disable-features=Translate", "--disable-gpu", "--disable-extensions", "--autoplay-policy=no-user-gesture-required")
	ui.SysProcAttr = &syscall.SysProcAttr{}
	if err := ui.Start(); err != nil {
		classicInstall()
		return
	}
	started := time.Now()
	uiDone := make(chan struct{})
	go func() { ui.Wait(); close(uiDone) }()
	// if the setup page never talks to us, fall back to the simple dialogs
	select {
	case <-uiDone:
	case <-time.After(25 * time.Second):
		if !hello.Load() {
			logSetup("setup page never responded; using classic installer")
			ui.Process.Kill()
			classicInstall()
			return
		}
		<-uiDone
	}
	if time.Since(started) < 3*time.Second { // the window handed off / failed: keep serving a little
		time.Sleep(10 * time.Minute)
	}
	pmu.Lock()
	busy := prog.Step > 0 && !prog.Done && prog.Error == "" && !prog.NeedClose
	pmu.Unlock()
	for busy { // don't cut an install short if the window is closed mid-way
		time.Sleep(300 * time.Millisecond)
		pmu.Lock()
		busy = !prog.Done && prog.Error == "" && !prog.NeedClose
		pmu.Unlock()
	}
	os.RemoveAll(profile)
}
