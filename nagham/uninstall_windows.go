//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"unsafe"
)

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	procMsgBoxW = user32.NewProc("MessageBoxW")
)

func msgBox(text, title string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	r, _, _ := procMsgBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags|0x00010000) // MB_SETFOREGROUND
	return int(r)
}

// handleUninstall runs when Windows "Apps > Uninstall" launches Nagham.exe --uninstall.
func handleUninstall() bool {
	if len(os.Args) < 2 || os.Args[1] != "--uninstall" {
		return false
	}
	if msgBox("Remove Nagham from this computer?\n\nYour music files are not touched.", "Uninstall Nagham", 0x4|0x20) != 6 {
		return true
	}
	keepData := msgBox("Keep your playlists, liked songs and themes in case you install Nagham again?", "Uninstall Nagham", 0x4|0x20) == 6
	hidden(exec.Command("taskkill", "/F", "/IM", "Nagham.exe", "/FI", "PID ne "+strconv.Itoa(os.Getpid()))).Run()
	appData, _ := os.UserConfigDir()
	start := filepath.Join(appData, `Microsoft\Windows\Start Menu\Programs\Nagham.lnk`)
	os.Remove(start)
	if home, err := os.UserHomeDir(); err == nil {
		os.Remove(filepath.Join(home, "Desktop", "Nagham.lnk"))
		os.Remove(filepath.Join(home, "OneDrive", "Desktop", "Nagham.lnk"))
	}
	hidden(exec.Command("reg", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nagham`, "/f")).Run()
	if !keepData {
		os.RemoveAll(filepath.Join(appData, "Nagham"))
	}
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	// delete the program folder once this process has exited
	hidden(exec.Command("cmd", "/c", "ping 127.0.0.1 -n 3 >nul & rmdir /s /q \""+dir+"\"")).Start()
	msgBox("Nagham has been removed.", "Uninstall Nagham", 0x40)
	return true
}
