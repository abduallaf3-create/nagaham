//go:build windows

package main

// Extras for Nagham's own window: the always-on-top mini player window and
// play / pause / skip buttons on the taskbar thumbnail.

import (
	"fmt"
	"net/http"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	pDestroyWin   = u32.NewProc("DestroyWindow")
	pRegMsg       = u32.NewProc("RegisterWindowMessageW")
	pSysParamInfo = u32.NewProc("SystemParametersInfoW")
	pIconIndirect = u32.NewProc("CreateIconIndirect")
	pDestroyIcon  = u32.NewProc("DestroyIcon")
	pCoCreate     = ole32.NewProc("CoCreateInstance")
	pDIBSection   = gdi32.NewProc("CreateDIBSection")
	pCreateBitmap = gdi32.NewProc("CreateBitmap")
	pDeleteObject = gdi32.NewProc("DeleteObject")
)

const (
	wmClose   = 0x0010
	wmCommand = 0x0111
)

var (
	msgTaskbarCreated uintptr
	miniClassReady    bool
	miniHwnd          uintptr
	miniCtrl          uintptr
	miniCreating      bool
	showNow           = -1
)

func postJSON(path, body string) {
	go func() {
		if appBase == "" {
			return
		}
		c := http.Client{Timeout: 3 * time.Second}
		if resp, err := c.Post(appBase+path, "application/json", strings.NewReader(body)); err == nil {
			resp.Body.Close()
		}
	}()
}

// ---------------- mini player window ----------------

func themeWindow(h uintptr) {
	themeMu.Lock()
	st := themeState
	themeMu.Unlock()
	dark := uint32(0)
	if st.Dark {
		dark = 1
	}
	dwmSet(h, 20, dark)
	dwmSet(h, 19, dark)
	if c, ok := colorRef(st.Caption); ok {
		dwmSet(h, 35, c)
		dwmSet(h, 34, c)
	}
	if c, ok := colorRef(st.Text); ok {
		dwmSet(h, 36, c)
	}
}

func applyMini() {
	themeMu.Lock()
	want := themeState.Mini
	themeMu.Unlock()
	if want && miniHwnd == 0 && wvEnv != 0 && !miniCreating {
		openMiniWindow()
	} else if !want && miniHwnd != 0 {
		closeMiniWindow(false)
	}
	if miniHwnd != 0 {
		themeWindow(miniHwnd)
	}
}

func openMiniWindow() {
	hInst, _, _ := pModuleH.Call(0)
	cls, _ := syscall.UTF16PtrFromString("NaghamMini")
	if !miniClassReady {
		icon, _, _ := pLoadIcon.Call(hInst, 1)
		cursor, _, _ := pLoadCursor.Call(0, 32512)
		brush, _, _ := pSolidBrush.Call(0x2e0b16)
		wc := wndClassEx{lpfnWndProc: syscall.NewCallback(miniProc), hInstance: hInst, hIcon: icon, hIconSm: icon, hCursor: cursor, hbrBackground: brush, lpszClassName: cls}
		wc.cbSize = uint32(unsafe.Sizeof(wc))
		pRegisterCls.Call(uintptr(unsafe.Pointer(&wc)))
		miniClassReady = true
	}
	dpi, _, _ := pDpiWindow.Call(wvHwnd)
	if dpi == 0 {
		dpi = 96
	}
	w, h := int(420*dpi/96), int(178*dpi/96)
	var work rect
	pSysParamInfo.Call(0x30, 0, uintptr(unsafe.Pointer(&work)), 0) // SPI_GETWORKAREA
	x, y := int(work.right)-w-int(16*dpi/96), int(work.bottom)-h-int(16*dpi/96)
	title, _ := syscall.UTF16PtrFromString("Nagham mini player")
	const style = 0x00C00000 | 0x00080000 | 0x00020000 // caption, system menu, minimize box
	hwnd, _, _ := pCreateWin.Call(0x00000008, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(title)), style,
		uintptr(x), uintptr(y), uintptr(w), uintptr(h), 0, 0, hInst, 0) // WS_EX_TOPMOST
	if hwnd == 0 {
		logf("mini window: CreateWindowEx failed")
		postJSON("/api/mini", `{"open":false}`)
		return
	}
	miniHwnd = hwnd
	themeWindow(hwnd)
	pShowWin.Call(hwnd, 5)
	miniCreating = true
	hd := newHandler(func(this, hr, controller uintptr) uintptr {
		miniCreating = false
		if hr != 0 || controller == 0 || miniHwnd == 0 {
			logf("mini controller failed: 0x%x", hr)
			return 0
		}
		comCall(controller, 1)
		miniCtrl = controller
		resizeMini()
		var core uintptr
		comCall(controller, 25, uintptr(unsafe.Pointer(&core)))
		if core != 0 {
			u, _ := syscall.UTF16PtrFromString(appBase + "/mini.html")
			comCall(core, 5, uintptr(unsafe.Pointer(u)))
		}
		return 0
	})
	if r := comCall(wvEnv, 3, hwnd, uintptr(unsafe.Pointer(hd))); r != 0 {
		miniCreating = false
		logf("mini controller create failed: 0x%x", r)
	}
}

func resizeMini() {
	if miniCtrl == 0 || miniHwnd == 0 {
		return
	}
	var r rect
	pClientRect.Call(miniHwnd, uintptr(unsafe.Pointer(&r)))
	comCall(miniCtrl, 6, uintptr(unsafe.Pointer(&r)))
}

func closeMiniWindow(tellPage bool) {
	if miniCtrl != 0 {
		comCall(miniCtrl, 24) // Close
		comCall(miniCtrl, 2)  // Release
		miniCtrl = 0
	}
	if miniHwnd != 0 {
		h := miniHwnd
		miniHwnd = 0
		pDestroyWin.Call(h)
	}
	if tellPage {
		postJSON("/api/mini", `{"open":false}`)
	}
}

func miniProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch msg {
	case wmSize:
		resizeMini()
		return 0
	case wmMove:
		if miniCtrl != 0 {
			comCall(miniCtrl, 23)
		}
	case wmClose:
		closeMiniWindow(true)
		return 0
	}
	r, _, _ := pDefWinProc.Call(hwnd, msg, wp, lp)
	return r
}

// bring Nagham's window to the front (the mini player's cover was clicked)
func applyShow() {
	themeMu.Lock()
	seq := themeState.ShowSeq
	themeMu.Unlock()
	if showNow < 0 {
		showNow = seq
		return
	}
	if seq != showNow {
		showNow = seq
		pShowWin.Call(wvHwnd, 9) // SW_RESTORE
		setForeground(wvHwnd)
	}
}

// ---------------- taskbar thumbnail buttons ----------------

type thumbButton struct {
	mask   uint32
	id     uint32
	bitmap uint32
	icon   uintptr
	tip    [260]uint16
	flags  uint32
}

type iconInfo struct {
	fIcon    int32
	xHot     uint32
	yHot     uint32
	hbmMask  uintptr
	hbmColor uintptr
}

type bmpInfoHeader struct {
	size          uint32
	width, height int32
	planes, bits  uint16
	compression   uint32
	sizeImage     uint32
	xPPM, yPPM    int32
	clrUsed       uint32
	clrImportant  uint32
}

var (
	taskbar      uintptr
	tbIcons      = map[string]uintptr{}
	tbPlayingNow = -1
	clsidTaskbar = [16]byte{0x44, 0xF3, 0xFD, 0x56, 0x6D, 0xFD, 0xD0, 0x11, 0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90}
	iidTaskbar3  = [16]byte{0x91, 0xFB, 0x1A, 0xEA, 0x28, 0x9E, 0x86, 0x4B, 0x90, 0xE9, 0x9E, 0x9F, 0x8A, 0x5E, 0xEF, 0xAF}
)

// draws a white media icon (anti-aliased) into a 32-bit icon
func mediaIcon(kind string, size int) uintptr {
	if h, ok := tbIcons[kind]; ok {
		return h
	}
	type pt struct{ x, y float64 }
	inTri := func(p, a, b, c pt) bool {
		s := func(p1, p2, p3 pt) float64 { return (p1.x-p3.x)*(p2.y-p3.y) - (p2.x-p3.x)*(p1.y-p3.y) }
		d1, d2, d3 := s(p, a, b), s(p, b, c), s(p, c, a)
		neg := d1 < 0 || d2 < 0 || d3 < 0
		pos := d1 > 0 || d2 > 0 || d3 > 0
		return !(neg && pos)
	}
	inRect := func(p pt, x0, y0, x1, y1 float64) bool { return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 }
	inside := func(p pt) bool {
		switch kind {
		case "play":
			return inTri(p, pt{.30, .18}, pt{.30, .82}, pt{.82, .5})
		case "pause":
			return inRect(p, .24, .2, .42, .8) || inRect(p, .58, .2, .76, .8)
		case "next":
			return inTri(p, pt{.20, .2}, pt{.20, .8}, pt{.62, .5}) || inRect(p, .66, .2, .80, .8)
		default: // prev
			return inTri(p, pt{.80, .2}, pt{.80, .8}, pt{.38, .5}) || inRect(p, .20, .2, .34, .8)
		}
	}
	hdr := bmpInfoHeader{size: 40, width: int32(size), height: -int32(size), planes: 1, bits: 32}
	var bits uintptr
	color, _, _ := pDIBSection.Call(0, uintptr(unsafe.Pointer(&hdr)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if color == 0 || bits == 0 {
		return 0
	}
	px := unsafe.Slice((*uint32)(unsafe.Pointer(bits)), size*size)
	const ss = 4
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			n := 0
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					if inside(pt{(float64(x) + (float64(sx)+.5)/ss) / float64(size), (float64(y) + (float64(sy)+.5)/ss) / float64(size)}) {
						n++
					}
				}
			}
			a := uint32(n * 255 / (ss * ss))
			px[y*size+x] = a<<24 | 0xFFFFFF
		}
	}
	mask, _, _ := pCreateBitmap.Call(uintptr(size), uintptr(size), 1, 1, 0)
	ii := iconInfo{fIcon: 1, hbmMask: mask, hbmColor: color}
	h, _, _ := pIconIndirect.Call(uintptr(unsafe.Pointer(&ii)))
	pDeleteObject.Call(mask)
	pDeleteObject.Call(color)
	if h != 0 {
		tbIcons[kind] = h
	}
	return h
}

func setTip(b *thumbButton, s string) {
	u, _ := syscall.UTF16FromString(s)
	copy(b.tip[:], u)
}

func thumbButtons(playing bool) [3]thumbButton {
	dpi, _, _ := pDpiWindow.Call(wvHwnd)
	if dpi == 0 {
		dpi = 96
	}
	size := int(16 * dpi / 96)
	var b [3]thumbButton
	kinds := []string{"prev", "play", "next"}
	tips := []string{"Previous", "Play", "Next"}
	if playing {
		kinds[1], tips[1] = "pause", "Pause"
	}
	for i := range b {
		b[i].mask = 2 | 4 | 8 // icon, tooltip, flags
		b[i].id = uint32(i + 1)
		b[i].icon = mediaIcon(kinds[i], size)
		setTip(&b[i], tips[i])
	}
	return b
}

func setupThumbbar() {
	if taskbar == 0 {
		var p uintptr
		if r, _, _ := pCoCreate.Call(uintptr(unsafe.Pointer(&clsidTaskbar)), 0, 1, uintptr(unsafe.Pointer(&iidTaskbar3)), uintptr(unsafe.Pointer(&p))); r != 0 || p == 0 {
			logf("taskbar buttons unavailable: 0x%x", r)
			return
		}
		comCall(p, 3) // HrInit
		taskbar = p
	}
	b := thumbButtons(tbPlayingNow == 1)
	if r := comCall(taskbar, 15, wvHwnd, 3, uintptr(unsafe.Pointer(&b[0]))); r != 0 { // ThumbBarAddButtons
		logf("ThumbBarAddButtons: 0x%x", r)
	}
}

// keeps the middle button in step with play / pause (the title starts with ♪ while playing)
func updateThumbbar() {
	themeMu.Lock()
	title := themeState.Title
	themeMu.Unlock()
	playing := 0
	if strings.HasPrefix(title, "♪") {
		playing = 1
	}
	if playing == tbPlayingNow {
		return
	}
	tbPlayingNow = playing
	if taskbar == 0 {
		return
	}
	b := thumbButtons(playing == 1)
	comCall(taskbar, 16, wvHwnd, 1, uintptr(unsafe.Pointer(&b[1]))) // ThumbBarUpdateButtons
}

func onThumbClick(id int) {
	cmd := map[int]string{1: "prev", 2: "toggle", 3: "next"}[id]
	if cmd != "" {
		postJSON("/api/remote/cmd", fmt.Sprintf(`{"cmd":%q}`, cmd))
	}
}

func initExtras() {
	n, _ := syscall.UTF16PtrFromString("TaskbarButtonCreated")
	msgTaskbarCreated, _, _ = pRegMsg.Call(uintptr(unsafe.Pointer(n)))
}

// called from the main window procedure; returns true when handled
func extrasProc(msg, wp uintptr) bool {
	if msgTaskbarCreated != 0 && msg == msgTaskbarCreated {
		setupThumbbar()
		return true
	}
	if msg == wmCommand && (wp>>16)&0xFFFF == 0x1800 { // THBN_CLICKED
		onThumbClick(int(wp & 0xFFFF))
		return true
	}
	return false
}
