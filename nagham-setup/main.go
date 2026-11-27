//go:build windows

// NaghamSetup.exe – installs Nagham for the current user (no admin rights needed):
// copies the app to %LOCALAPPDATA%\Programs\Nagham, adds Start menu + desktop
// shortcuts and an entry in Windows "Installed apps" so it can be uninstalled.
package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed payload/Nagham.exe
var payload []byte

const version = "4.0.4"

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	procMsgBoxW = user32.NewProc("MessageBoxW")
)

const (
	mbOK           = 0x0
	mbYesNo        = 0x4
	mbIconError    = 0x10
	mbIconQ        = 0x20
	mbIconInfo     = 0x40
	mbForeground   = 0x10000
	idYes          = 6
	createNoWindow = 0x08000000
)

func msgBox(text string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString("Nagham Setup")
	r, _, _ := procMsgBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags|mbForeground)
	return int(r)
}

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd.Run()
}

func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func shortcut(lnk, target, dir string) error {
	ps := fmt.Sprintf(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(%s);$s.TargetPath=%s;$s.WorkingDirectory=%s;$s.IconLocation=%s;$s.Description='Nagham music player';$s.Save()`,
		psQuote(lnk), psQuote(target), psQuote(dir), psQuote(target+",0"))
	return run("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps)
}

func desktopDir() string {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	out, err := cmd.Output()
	if err == nil {
		if d := strings.TrimSpace(string(out)); d != "" {
			return d
		}
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "Desktop")
}

func edgeInstalled() bool {
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if b := os.Getenv(env); b != "" {
			for _, p := range []string{`Microsoft\Edge\Application\msedge.exe`, `Google\Chrome\Application\chrome.exe`} {
				if _, err := os.Stat(filepath.Join(b, p)); err == nil {
					return true
				}
			}
		}
	}
	return false
}

func classicInstall() {
	local := os.Getenv("LOCALAPPDATA")
	appData := os.Getenv("APPDATA")
	if local == "" || appData == "" {
		msgBox("Couldn't find your user folders. Setup can't continue.", mbIconError)
		return
	}
	dir := filepath.Join(local, "Programs", "Nagham")
	exe := filepath.Join(dir, "Nagham.exe")
	_, existed := os.Stat(exe)
	verb := "Install"
	if existed == nil {
		verb = "Update"
	}
	if msgBox(fmt.Sprintf("%s Nagham %s on this computer?\n\nNagham doesn't need Python, Java or anything else. If Microsoft WebView2 is missing, setup gets it from Microsoft. It will add Nagham to your Start menu and desktop.", verb, version), mbYesNo|mbIconQ) != idYes {
		return
	}
	if !webView2Installed() {
		installWebView2()
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		msgBox("Couldn't create the program folder:\n"+err.Error(), mbIconError)
		return
	}
	// write the app (close a running copy first if needed)
	tmp := exe + ".new"
	if err := os.WriteFile(tmp, payload, 0o755); err != nil {
		msgBox("Couldn't copy Nagham:\n"+err.Error(), mbIconError)
		return
	}
	var err error
	for i := 0; i < 2; i++ {
		os.Remove(exe)
		if err = os.Rename(tmp, exe); err == nil {
			break
		}
		if i == 0 {
			if msgBox("Nagham is open. Close it so it can be updated?", mbYesNo|mbIconQ) != idYes {
				os.Remove(tmp)
				return
			}
			run("taskkill", "/F", "/IM", "Nagham.exe")
			time.Sleep(1200 * time.Millisecond)
		}
	}
	if err != nil {
		os.Remove(tmp)
		msgBox("Couldn't replace Nagham.exe (is it still running?):\n"+err.Error(), mbIconError)
		return
	}

	// shortcuts
	shortcut(filepath.Join(appData, `Microsoft\Windows\Start Menu\Programs\Nagham.lnk`), exe, dir)
	shortcut(filepath.Join(desktopDir(), "Nagham.lnk"), exe, dir)

	// "Installed apps" entry (per user)
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

	note := ""
	if !edgeInstalled() {
		note = "\n\nNote: Microsoft Edge wasn't found, so Nagham will open in your default browser."
	}
	if msgBox("Nagham is installed!\n\nOpen it now?"+note, mbYesNo|mbIconInfo) == idYes {
		cmd := exec.Command(exe)
		cmd.Dir = dir
		cmd.Start()
	}
}
