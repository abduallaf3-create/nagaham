//go:build windows

package main

// Nagham's own window: a normal Win32 window hosting Microsoft Edge WebView2
// (already part of Windows 10/11). Because the window is ours, its title bar
// colour can follow the theme (DWM caption colours, Windows 11).
//
// It runs in a child process ("Nagham.exe --window <url>") so that if anything
// goes wrong the main process simply falls back to an Edge app window.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const exitNoWebView = 3

var (
	u32          = syscall.NewLazyDLL("user32.dll")
	k32          = syscall.NewLazyDLL("kernel32.dll")
	ole32        = syscall.NewLazyDLL("ole32.dll")
	dwmapi       = syscall.NewLazyDLL("dwmapi.dll")
	gdi32        = syscall.NewLazyDLL("gdi32.dll")
	pRegisterCls = u32.NewProc("RegisterClassExW")
	pCreateWin   = u32.NewProc("CreateWindowExW")
	pDefWinProc  = u32.NewProc("DefWindowProcW")
	pGetMsg      = u32.NewProc("GetMessageW")
	pTranslate   = u32.NewProc("TranslateMessage")
	pDispatch    = u32.NewProc("DispatchMessageW")
	pPostQuit    = u32.NewProc("PostQuitMessage")
	pShowWin     = u32.NewProc("ShowWindow")
	pClientRect  = u32.NewProc("GetClientRect")
	pLoadIcon    = u32.NewProc("LoadIconW")
	pLoadCursor  = u32.NewProc("LoadCursorW")
	pSetText     = u32.NewProc("SetWindowTextW")
	pPostMsg     = u32.NewProc("PostMessageW")
	pSysMetrics  = u32.NewProc("GetSystemMetrics")
	pDpiSystem   = u32.NewProc("GetDpiForSystem")
	pDpiWindow   = u32.NewProc("GetDpiForWindow")
	pSetFg       = u32.NewProc("SetForegroundWindow")
	pModuleH     = k32.NewProc("GetModuleHandleW")
	pCoInit      = ole32.NewProc("CoInitializeEx")
	pDwmSet      = dwmapi.NewProc("DwmSetWindowAttribute")
	pSolidBrush  = gdi32.NewProc("CreateSolidBrush")
	pTaskAlloc   = ole32.NewProc("CoTaskMemAlloc")
)

const (
	wmDestroy       = 0x0002
	wmMove          = 0x0003
	wmSize          = 0x0005
	wmActivate      = 0x0006
	wmSetFocus      = 0x0007
	wmGetMinMaxInfo = 0x0024
	wmApplyTheme    = 0x8001
	wmYtmPoll       = 0x8002
	wmAcctPoll      = 0x8003
	wsOverlappedWin = 0x00CF0000
	cwUseDefault    = 0x80000000
)

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}
type winMsg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      [2]int32
	private uint32
}
type rect struct{ left, top, right, bottom int32 }

// --- tiny COM helpers ---------------------------------------------------

func comCall(obj uintptr, idx int, args ...uintptr) uintptr {
	vtbl := *(*uintptr)(unsafe.Pointer(obj))
	fn := *(*uintptr)(unsafe.Pointer(vtbl + uintptr(idx)*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{obj}, args...)...)
	return r
}

// a COM object with one method after IUnknown (all WebView2 "completed" handlers look like this)
type comHandler struct {
	vtbl *[4]uintptr
}

var keepAlive []any

func newHandler(invoke func(this, a, b uintptr) uintptr) *comHandler {
	vt := &[4]uintptr{
		syscall.NewCallback(func(this, riid, ppv uintptr) uintptr { *(*uintptr)(unsafe.Pointer(ppv)) = this; return 0 }),
		syscall.NewCallback(func(this uintptr) uintptr { return 1 }),
		syscall.NewCallback(func(this uintptr) uintptr { return 1 }),
		syscall.NewCallback(invoke),
	}
	h := &comHandler{vtbl: vt}
	keepAlive = append(keepAlive, vt, h)
	return h
}

var (
	envRetry      bool
	createEnvProc *syscall.LazyProc
)

// --- window state shared with the UI thread -----------------------------

var (
	wvHwnd       uintptr
	wvController uintptr
	themeMu      sync.Mutex
	themeState   windowState
)

type windowState struct {
	V          int       `json:"v"`
	Caption    string    `json:"caption"`
	Text       string    `json:"text"`
	Dark       bool      `json:"dark"`
	Title      string    `json:"title"`
	YtmURL     string    `json:"ytmUrl"`
	YtmRect    [4]int    `json:"ytmRect"`
	YtmVisible bool      `json:"ytmVisible"`
	YtmHidden  bool      `json:"ytmHidden"`
	Mini       bool      `json:"mini"`
	ShowSeq    int       `json:"showSeq"`
	YtmCmds    []ytmCmd  `json:"ytmCmds"`
	YtmCmdSeq  int       `json:"ytmCmdSeq"`
	YtmVol     float64   `json:"ytmVol"`
	YtmVolSet  bool      `json:"ytmVolSet"`
	AcctOpen   bool      `json:"acctOpen"` // the YouTube Music account page (For you) exists
	AcctShow   bool      `json:"acctShow"` // ...and is shown (to sign in)
	AcctRect   [4]int    `json:"acctRect"` // where, in physical pixels
	AcctNav    string    `json:"acctNav"`  // a page to open in it
	AcctNavSeq int       `json:"acctNavSeq"`
	AcctReqs   []acctReq `json:"acctReqs"`
	AcctReqSeq int       `json:"acctReqSeq"`
}

// second WebView2 inside the same window, playing YouTube Music. Normally it is
// tucked into a 1-pixel corner (the music plays, Nagham's own player bar shows and
// controls it); "Show video" draws it in the video box instead.
var (
	wvEnv       uintptr
	ytmCtrl     uintptr
	ytmCore     uintptr
	ytmCreating bool
	ytmURLNow   string
	ytmCmdNow   = -1
	ytmScriptH  *comHandler
	ytmPollH    *comHandler
	ytmPollAt   time.Time
	ytmPolling  bool
	appBase     string
	ytmPostCh   = make(chan string, 4)
)

func utf16PtrString(p uintptr) string {
	if p == 0 {
		return ""
	}
	var u []uint16
	for i := uintptr(0); i < 1<<16; i += 2 {
		c := *(*uint16)(unsafe.Pointer(p + i))
		if c == 0 {
			break
		}
		u = append(u, c)
	}
	return syscall.UTF16ToString(u)
}

// closes the YouTube Music player completely. Navigating a page that is playing can be refused by the page
// (YouTube Music asks "leave site?" in a dialog nobody can see in a hidden player) — then the old song kept playing
// under the new one. Closing the whole player can't be refused; a fresh one is made for the next song.
func ytmClose() {
	if ytmCtrl == 0 {
		return
	}
	logf("ytm close player")
	ctrl, core := ytmCtrl, ytmCore
	ytmCtrl, ytmCore = 0, 0
	ytmURLNow, ytmCmdNow, ytmPolling = "", -1, false
	comCall(ctrl, 4, 0) // put_IsVisible(false)
	comCall(ctrl, 24)   // Close
	if core != 0 {
		comCall(core, 2) // Release
	}
	comCall(ctrl, 2)
}

var ytmCreateH, ytmAdH *comHandler

func applyYtmPanel() {
	themeMu.Lock()
	st := themeState
	themeMu.Unlock()
	if wvEnv == 0 {
		return
	}
	// stopped, or another song: never reuse a page that has been playing
	if ytmCtrl != 0 && ytmURLNow != "" && st.YtmURL != ytmURLNow {
		ytmClose()
	}
	if ytmCtrl == 0 {
		if st.YtmURL != "" && (st.YtmVisible || st.YtmHidden) && !ytmCreating {
			ytmCreating = true
			if ytmCreateH == nil { // made once: Windows allows only so many callbacks, and a new player is made for every song
				ytmCreateH = newHandler(func(this, hr, controller uintptr) uintptr {
					ytmCreating = false
					if hr != 0 || controller == 0 {
						logf("ytm panel controller failed: 0x%x", hr)
						return 0
					}
					comCall(controller, 1)
					var core uintptr
					comCall(controller, 25, uintptr(unsafe.Pointer(&core)))
					if core == 0 {
						return 0
					}
					comCall(core, 1)
					ytmCtrl, ytmCore = controller, core
					// no ads: YouTube's answers are cleaned before its own code sees them
					adJS, _ := syscall.UTF16PtrFromString(ytmAdJS)
					if ytmAdH == nil {
						ytmAdH = newHandler(func(this, hr, id uintptr) uintptr { return 0 })
					}
					comCall(core, 27, uintptr(unsafe.Pointer(adJS)), uintptr(unsafe.Pointer(ytmAdH))) // AddScriptToExecuteOnDocumentCreated
					applyYtmPanel()
					return 0
				})
			}
			if r := comCall(wvEnv, 3, wvHwnd, uintptr(unsafe.Pointer(ytmCreateH))); r != 0 {
				ytmCreating = false
				logf("ytm panel create failed: 0x%x", r)
			}
		}
		return
	}
	vis := uintptr(0)
	rc := rect{int32(st.YtmRect[0]), int32(st.YtmRect[1]), int32(st.YtmRect[0] + st.YtmRect[2]), int32(st.YtmRect[1] + st.YtmRect[3])}
	if st.YtmVisible && st.YtmRect[2] >= 50 && st.YtmRect[3] >= 50 {
		vis = 1
	} else if st.YtmHidden && st.YtmURL != "" {
		// still "on screen" for Chromium (so it keeps playing), but 1 pixel in the corner
		var cr rect
		pClientRect.Call(wvHwnd, uintptr(unsafe.Pointer(&cr)))
		rc = rect{0, cr.bottom - 1, 1, cr.bottom}
		vis = 1
	}
	comCall(ytmCtrl, 6, uintptr(unsafe.Pointer(&rc))) // put_Bounds
	comCall(ytmCtrl, 4, vis)                          // put_IsVisible
	if st.YtmURL != "" && st.YtmURL != ytmURLNow {
		logf("ytm navigate %s (hidden=%v visible=%v)", st.YtmURL, st.YtmHidden, st.YtmVisible)
		ytmURLNow = st.YtmURL
		u, _ := syscall.UTF16PtrFromString(st.YtmURL)
		comCall(ytmCore, 5, uintptr(unsafe.Pointer(u))) // Navigate
	}
	if ytmCmdNow < 0 { // panel just made: commands from before it existed don't apply
		ytmCmdNow = st.YtmCmdSeq
	}
	for _, c := range st.YtmCmds {
		if c.Seq <= ytmCmdNow {
			continue
		}
		ytmCmdNow = c.Seq
		if ytmScriptH == nil {
			ytmScriptH = newHandler(func(this, hr, res uintptr) uintptr { return 0 })
		}
		js, _ := syscall.UTF16PtrFromString(c.JS)
		comCall(ytmCore, 29, uintptr(unsafe.Pointer(js)), uintptr(unsafe.Pointer(ytmScriptH))) // ExecuteScript
	}
}

// asks the YouTube Music page what it's doing (UI thread, twice a second)
func pollYtm() {
	if ytmCore == 0 || ytmURLNow == "" {
		return
	}
	if ytmPolling && time.Since(ytmPollAt) < 3*time.Second {
		return
	}
	if ytmPollH == nil {
		ytmPollH = newHandler(func(this, hr, res uintptr) uintptr {
			ytmPolling = false
			if hr == 0 && res != 0 {
				select {
				case ytmPostCh <- utf16PtrString(res):
				default:
				}
			}
			return 0
		})
	}
	ytmPolling, ytmPollAt = true, time.Now()
	themeMu.Lock()
	vol := -1.0
	if themeState.YtmVolSet {
		vol = themeState.YtmVol
	}
	themeMu.Unlock()
	js, _ := syscall.UTF16PtrFromString(strings.Replace(ytmStateJS, "__VOL__", strconv.FormatFloat(vol, 'f', 3, 64), 1))
	if comCall(ytmCore, 29, uintptr(unsafe.Pointer(js)), uintptr(unsafe.Pointer(ytmPollH))) != 0 {
		ytmPolling = false
	}
}

func ytmPollLoop() {
	go func() {
		c := http.Client{Timeout: 3 * time.Second}
		for body := range ytmPostCh {
			if appBase == "" || !strings.HasPrefix(body, "{") {
				continue
			}
			if resp, err := c.Post(appBase+"/api/ytm/state", "application/json", strings.NewReader(body)); err == nil {
				resp.Body.Close()
			}
		}
	}()
	for {
		time.Sleep(450 * time.Millisecond)
		if wvHwnd != 0 && ytmCore != 0 {
			pPostMsg.Call(wvHwnd, wmYtmPoll, 0, 0)
		}
		if wvHwnd != 0 && (acctCtrl != 0 || acctWant) {
			pPostMsg.Call(wvHwnd, wmAcctPoll, 0, 0)
		}
	}
}

// ICoreWebView2EnvironmentOptions with extra browser arguments (autoplay without a click)
type envOptions struct{ vtbl *[11]uintptr }

var iidEnvOptions = [16]byte{0xA8, 0x08, 0xDE, 0x2F, 0x9A, 0x1E, 0x66, 0x47, 0x8C, 0x05, 0x95, 0xA9, 0xCE, 0xB9, 0xD1, 0xC5}
var iidUnknown = [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46}

func taskString(s string) uintptr {
	u, _ := syscall.UTF16FromString(s)
	p, _, _ := pTaskAlloc.Call(uintptr(len(u) * 2))
	if p == 0 {
		return 0
	}
	copy(unsafe.Slice((*uint16)(unsafe.Pointer(p)), len(u)), u)
	return p
}

func newEnvOptions(args string) *envOptions {
	str := func(v string) uintptr {
		return syscall.NewCallback(func(this, out uintptr) uintptr {
			*(*uintptr)(unsafe.Pointer(out)) = taskString(v)
			return 0
		})
	}
	put := syscall.NewCallback(func(this, v uintptr) uintptr { return 0 })
	vt := &[11]uintptr{
		syscall.NewCallback(func(this, riid, ppv uintptr) uintptr {
			id := *(*[16]byte)(unsafe.Pointer(riid))
			if id == iidUnknown || id == iidEnvOptions {
				*(*uintptr)(unsafe.Pointer(ppv)) = this
				return 0
			}
			*(*uintptr)(unsafe.Pointer(ppv)) = 0
			return 0x80004002 // E_NOINTERFACE
		}),
		syscall.NewCallback(func(this uintptr) uintptr { return 1 }),
		syscall.NewCallback(func(this uintptr) uintptr { return 1 }),
		str(args), put, // AdditionalBrowserArguments
		str(""), put, // Language
		str("86.0.616.0"), put, // TargetCompatibleBrowserVersion
		syscall.NewCallback(func(this, out uintptr) uintptr { *(*int32)(unsafe.Pointer(out)) = 0; return 0 }), put, // AllowSingleSignOnUsingOSPrimaryAccount
	}
	o := &envOptions{vtbl: vt}
	keepAlive = append(keepAlive, vt, o)
	return o
}

func colorRef(hex string) (uint32, bool) {
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) != 6 {
		return 0, false
	}
	n, err := strconv.ParseUint(hex, 16, 32)
	if err != nil {
		return 0, false
	}
	r, g, b := uint32(n>>16)&255, uint32(n>>8)&255, uint32(n)&255
	return r | g<<8 | b<<16, true
}

func dwmSet(hwnd uintptr, attr uint32, val uint32) {
	pDwmSet.Call(hwnd, uintptr(attr), uintptr(unsafe.Pointer(&val)), 4)
}

func applyWindowTheme() {
	themeMu.Lock()
	st := themeState
	themeMu.Unlock()
	if wvHwnd == 0 {
		return
	}
	dark := uint32(0)
	if st.Dark {
		dark = 1
	}
	dwmSet(wvHwnd, 20, dark) // DWMWA_USE_IMMERSIVE_DARK_MODE (Windows 10 20H1+)
	dwmSet(wvHwnd, 19, dark) // older Windows 10 builds
	if c, ok := colorRef(st.Caption); ok {
		dwmSet(wvHwnd, 35, c) // DWMWA_CAPTION_COLOR (Windows 11)
		dwmSet(wvHwnd, 34, c) // DWMWA_BORDER_COLOR
	}
	if c, ok := colorRef(st.Text); ok {
		dwmSet(wvHwnd, 36, c) // DWMWA_TEXT_COLOR
	}
	if st.Title != "" {
		t, _ := syscall.UTF16PtrFromString(st.Title)
		pSetText.Call(wvHwnd, uintptr(unsafe.Pointer(t)))
	}
}

var wvVisNow uintptr = 1

func resizeWebView() {
	if wvController == 0 || wvHwnd == 0 {
		return
	}
	var r rect
	pClientRect.Call(wvHwnd, uintptr(unsafe.Pointer(&r)))
	comCall(wvController, 6, uintptr(unsafe.Pointer(&r))) // put_Bounds
}

// --- finding the WebView2 runtime ---------------------------------------

func findWebView2() string {
	arch := "x64"
	if runtime.GOARCH == "arm64" {
		arch = "arm64"
	}
	type cand struct {
		ver  []int
		path string
	}
	var cands []cand
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		matches, _ := filepath.Glob(filepath.Join(base, `Microsoft\EdgeWebView\Application\*\EBWebView`, arch, "EmbeddedBrowserWebView.dll"))
		for _, m := range matches {
			verDir := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(m))))
			var v []int
			for _, p := range strings.Split(verDir, ".") {
				n, _ := strconv.Atoi(p)
				v = append(v, n)
			}
			cands = append(cands, cand{v, m})
		}
	}
	if len(cands) == 0 {
		return ""
	}
	sort.Slice(cands, func(i, j int) bool {
		a, b := cands[i].ver, cands[j].ver
		for k := 0; k < len(a) && k < len(b); k++ {
			if a[k] != b[k] {
				return a[k] > b[k]
			}
		}
		return len(a) > len(b)
	})
	return cands[0].path
}

// --- the --window child process -----------------------------------------

func init() {
	if len(os.Args) > 1 && os.Args[1] == "--window" {
		runtime.LockOSThread() // COM + the message loop must stay on one OS thread
	}
}

// runNativeWindow is called with: --window <url> <initialBgHex>
func runNativeWindow() bool {
	if len(os.Args) < 3 || os.Args[1] != "--window" {
		return false
	}
	url := os.Args[2]
	bg := "#160b2e"
	if len(os.Args) > 3 {
		bg = os.Args[3]
	}
	dll := findWebView2()
	if dll == "" {
		os.Exit(exitNoWebView)
	}
	createEnv := syscall.NewLazyDLL(dll).NewProc("CreateWebViewEnvironmentWithOptionsInternal")
	if createEnv.Find() != nil {
		os.Exit(exitNoWebView)
	}
	pCoInit.Call(0, 2) // COINIT_APARTMENTTHREADED
	os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required --disable-features=msSmartScreenProtection")

	hInst, _, _ := pModuleH.Call(0)
	className, _ := syscall.UTF16PtrFromString("NaghamWindow")
	icon, _, _ := pLoadIcon.Call(hInst, 1)
	cursor, _, _ := pLoadCursor.Call(0, 32512)
	bgc, _ := colorRef(bg)
	brush, _, _ := pSolidBrush.Call(uintptr(bgc))
	wc := wndClassEx{lpfnWndProc: syscall.NewCallback(wndProc), hInstance: hInst, hIcon: icon, hIconSm: icon, hCursor: cursor, hbrBackground: brush, lpszClassName: className}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	pRegisterCls.Call(uintptr(unsafe.Pointer(&wc)))

	dpi, _, _ := pDpiSystem.Call()
	if dpi == 0 {
		dpi = 96
	}
	w, h := 1280*int(dpi)/96, 820*int(dpi)/96
	sw, _, _ := pSysMetrics.Call(0)
	sh, _, _ := pSysMetrics.Call(1)
	if int(sw) > 0 && w > int(sw)-40 {
		w = int(sw) - 40
	}
	if int(sh) > 0 && h > int(sh)-80 {
		h = int(sh) - 80
	}
	x, y := (int(sw)-w)/2, (int(sh)-h)/2-20
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	title, _ := syscall.UTF16PtrFromString("Nagham")
	hwnd, _, _ := pCreateWin.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(title)), wsOverlappedWin,
		uintptr(x), uintptr(y), uintptr(w), uintptr(h), 0, 0, hInst, 0)
	if hwnd == 0 {
		os.Exit(exitNoWebView)
	}
	wvHwnd = hwnd
	initExtras()
	themeMu.Lock()
	themeState = windowState{Caption: bg, Text: "#ffffff", Dark: true, Title: "Nagham"}
	themeMu.Unlock()
	applyWindowTheme()
	pShowWin.Call(hwnd, 5) // SW_SHOW (shows the themed background while WebView2 starts)

	failed := func(stage string, hr uintptr) {
		logf("webview2 %s failed: 0x%x", stage, hr)
		os.Exit(exitNoWebView)
	}
	urlPtr, _ := syscall.UTF16PtrFromString(url)
	ctrlDone := newHandler(func(this, hr, controller uintptr) uintptr {
		if hr != 0 || controller == 0 {
			failed("controller", hr)
		}
		comCall(controller, 1) // AddRef
		wvController = controller
		var core uintptr
		comCall(controller, 25, uintptr(unsafe.Pointer(&core))) // get_CoreWebView2
		if core == 0 {
			failed("core", 0)
		}
		comCall(core, 1)
		resizeWebView()
		comCall(controller, 12, 0)                        // MoveFocus(programmatic)
		comCall(core, 5, uintptr(unsafe.Pointer(urlPtr))) // Navigate
		return 0
	})
	var envDone *comHandler
	var udfRetry *uint16
	envDone = newHandler(func(this, hr, env uintptr) uintptr {
		if (hr != 0 || env == 0) && envRetry {
			envRetry = false
			logf("environment with options failed: 0x%x – retrying without", hr)
			if r, _, _ := createEnvProc.Call(1, 0, uintptr(unsafe.Pointer(udfRetry)), 0, uintptr(unsafe.Pointer(envDone))); r == 0 {
				return 0
			}
		}
		if hr != 0 || env == 0 {
			failed("environment", hr)
		}
		comCall(env, 1)
		wvEnv = env
		r := comCall(env, 3, hwnd, uintptr(unsafe.Pointer(ctrlDone))) // CreateCoreWebView2Controller
		if r != 0 {
			failed("create controller", r)
		}
		return 0
	})
	udf, _ := syscall.UTF16PtrFromString(filepath.Join(dataDir, "WebView2"))
	udfRetry, createEnvProc, envRetry = udf, createEnv, true
	opts := newEnvOptions("--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=msSmartScreenProtection,IntensiveWakeUpThrottling,CalculateNativeWinOcclusion")
	r, _, _ := createEnv.Call(1, 0, uintptr(unsafe.Pointer(udf)), uintptr(unsafe.Pointer(opts)), uintptr(unsafe.Pointer(envDone)))
	if r != 0 { // older runtimes: try again without options
		logf("environment with options failed: 0x%x", r)
		envRetry = false
		r, _, _ = createEnv.Call(1, 0, uintptr(unsafe.Pointer(udf)), 0, uintptr(unsafe.Pointer(envDone)))
	}
	if r != 0 {
		failed("CreateWebViewEnvironmentWithOptionsInternal", r)
	}
	go func() { // give up if WebView2 never comes up
		time.Sleep(25 * time.Second)
		if wvController == 0 {
			failed("timeout", 0)
		}
	}()
	go followTheme(url)
	go ytmPollLoop()

	var m winMsg
	for {
		r, _, _ := pGetMsg.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslate.Call(uintptr(unsafe.Pointer(&m)))
		pDispatch.Call(uintptr(unsafe.Pointer(&m)))
	}
	os.Exit(0)
	return true
}

func wndProc(hwnd, msg, wp, lp uintptr) uintptr {
	if extrasProc(msg, wp) {
		return 0
	}
	switch msg {
	case wmSize:
		// minimized: the page stops drawing (no animations, no repaints) but keeps playing and keeps its timers
		if wvController != 0 {
			vis := uintptr(1)
			if wp == 1 { // SIZE_MINIMIZED
				vis = 0
			}
			if vis != wvVisNow {
				wvVisNow = vis
				comCall(wvController, 4, vis) // put_IsVisible
			}
		}
		resizeWebView()
		return 0
	case wmMove:
		if wvController != 0 {
			comCall(wvController, 23) // NotifyParentWindowPositionChanged
		}
	case wmActivate, wmSetFocus:
		if wvController != 0 && (msg == wmSetFocus || wp&0xFFFF != 0) {
			comCall(wvController, 12, 0)
		}
	case wmGetMinMaxInfo:
		dpi, _, _ := pDpiWindow.Call(hwnd)
		if dpi == 0 {
			dpi = 96
		}
		mm := (*[10]int32)(unsafe.Pointer(lp))
		mm[6], mm[7] = int32(760*dpi/96), int32(520*dpi/96) // ptMinTrackSize
		return 0
	case wmApplyTheme:
		applyWindowTheme()
		applyYtmPanel()
		applyAcctPanel()
		applyMini()
		applyShow()
		updateThumbbar()
		return 0
	case wmYtmPoll:
		pollYtm()
		return 0
	case wmAcctPoll:
		pollAcct()
		return 0
	case wmDestroy:
		pPostQuit.Call(0)
		return 0
	}
	r, _, _ := pDefWinProc.Call(hwnd, msg, wp, lp)
	return r
}

// followTheme long-polls the main process for title-bar colour / title changes.
func followTheme(appURL string) {
	base := strings.TrimSuffix(appURL, "/")
	appBase = base
	v := -1
	fails := 0
	c := http.Client{Timeout: 40 * time.Second}
	for {
		resp, err := c.Get(fmt.Sprintf("%s/api/window/wait?v=%d", base, v))
		if err != nil {
			if fails++; fails > 6 { // the main Nagham process has gone away
				os.Exit(0)
			}
			time.Sleep(2 * time.Second)
			continue
		}
		fails = 0
		var st windowState
		json.NewDecoder(resp.Body).Decode(&st)
		resp.Body.Close()
		if st.V != v {
			v = st.V
			themeMu.Lock()
			themeState = st
			themeMu.Unlock()
			pPostMsg.Call(wvHwnd, wmApplyTheme, 0, 0)
		}
	}
}

func logf(f string, a ...any) {
	if dataDir == "" {
		return
	}
	fh, err := os.OpenFile(filepath.Join(dataDir, "window.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		fmt.Fprintf(fh, time.Now().Format("2006-01-02 15:04:05 ")+f+"\n", a...)
		fh.Close()
	}
}

func setForeground(h uintptr) { pSetFg.Call(h) }
