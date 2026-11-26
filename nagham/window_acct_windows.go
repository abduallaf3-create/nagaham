//go:build windows

package main

// The YouTube Music account page for "For you": a third WebView2 in Nagham's window, normally hidden.
// It is shown only while you sign in. Nagham asks it for your home feed (see acctJS in ytacct.go) and
// closes it again when it has been idle for a while, so it doesn't keep using memory.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	acctCtrl     uintptr
	acctCore     uintptr
	acctCreating bool
	acctCreateH  *comHandler
	acctScriptH  *comHandler
	acctWant     bool
	acctNavNow   = -1
	acctTakenSeq int
	acctPending  []acctReq
	acctInflight int
	acctPolling  bool
	acctPollAt   time.Time
	acctReqAt    time.Time
	acctLastUse  time.Time
	acctPostCh   = make(chan string, 8)
	acctPostOnce bool
)

const acctHome = "https://music.youtube.com/"

var (
	pGetWindow  = u32.NewProc("GetWindow")
	pSetWinPos  = u32.NewProc("SetWindowPos")
	pIsWinVis   = u32.NewProc("IsWindowVisible")
	acctHwnd    uintptr
	acctKidsWas map[uintptr]bool
	acctShown   bool
)

// the windows inside Nagham's window (each WebView2 page has one)
func childWindows() []uintptr {
	var out []uintptr
	c, _, _ := pGetWindow.Call(wvHwnd, 5) // GW_CHILD
	for c != 0 && len(out) < 50 {
		out = append(out, c)
		c, _, _ = pGetWindow.Call(c, 2) // GW_HWNDNEXT
	}
	return out
}

// the sign-in page must be on top of Nagham's own page, or it is drawn underneath it (an empty box)
func acctRaise() {
	if acctHwnd == 0 {
		for _, c := range childWindows() {
			if !acctKidsWas[c] {
				acctHwnd = c
			}
		}
	}
	if acctHwnd != 0 {
		pSetWinPos.Call(acctHwnd, 0, 0, 0, 0, 0, 0x0001|0x0002|0x0010) // HWND_TOP, no size / move / activate
	}
	var info []string
	for _, c := range childWindows() {
		v, _, _ := pIsWinVis.Call(c)
		info = append(info, fmt.Sprintf("%x:%d", c, v))
	}
	logf("acct shown: page window %x; children top→bottom %s", acctHwnd, strings.Join(info, " "))
}

// a long string handed back by WebView2 (the feed can be a few hundred KB)
func utf16PtrStringBig(p uintptr) string {
	if p == 0 {
		return ""
	}
	n := uintptr(0)
	for n < 16<<20 && *(*uint16)(unsafe.Pointer(p + n*2)) != 0 {
		n++
	}
	return syscall.UTF16ToString(unsafe.Slice((*uint16)(unsafe.Pointer(p)), n))
}

func acctClose() {
	if acctCtrl == 0 {
		return
	}
	logf("acct close")
	ctrl, core := acctCtrl, acctCore
	acctCtrl, acctCore, acctHwnd, acctShown = 0, 0, 0, false
	acctNavNow, acctPolling, acctInflight = -1, false, 0
	comCall(ctrl, 4, 0)
	comCall(ctrl, 24) // Close
	if core != 0 {
		comCall(core, 2)
	}
	comCall(ctrl, 2)
}

func acctNavigate(u string) {
	if acctCore == 0 {
		return
	}
	p, _ := syscall.UTF16PtrFromString(u)
	comCall(acctCore, 5, uintptr(unsafe.Pointer(p))) // Navigate
}

func applyAcctPanel() {
	themeMu.Lock()
	st := themeState
	themeMu.Unlock()
	if wvEnv == 0 {
		return
	}
	for _, r := range st.AcctReqs {
		if r.Seq > acctTakenSeq {
			acctTakenSeq = r.Seq
			acctPending = append(acctPending, r)
			acctReqAt = time.Now()
		}
	}
	acctWant = len(acctPending) > 0
	if !acctPostOnce {
		acctPostOnce = true
		go acctPoster()
	}
	want := st.AcctOpen || st.AcctShow || acctWant
	if !want {
		acctClose()
		return
	}
	acctLastUse = time.Now()
	if acctCtrl == 0 {
		if acctCreating {
			return
		}
		acctCreating = true
		acctHwnd = 0
		acctKidsWas = map[uintptr]bool{}
		for _, c := range childWindows() {
			acctKidsWas[c] = true
		}
		if acctCreateH == nil {
			acctCreateH = newHandler(func(this, hr, controller uintptr) uintptr {
				acctCreating = false
				if hr != 0 || controller == 0 {
					logf("acct controller failed: 0x%x", hr)
					return 0
				}
				comCall(controller, 1)
				var core uintptr
				comCall(controller, 25, uintptr(unsafe.Pointer(&core)))
				if core == 0 {
					return 0
				}
				comCall(core, 1)
				acctCtrl, acctCore = controller, core
				themeMu.Lock()
				s := themeState
				themeMu.Unlock()
				acctNavNow = s.AcctNavSeq
				if s.AcctShow && s.AcctNav != "" {
					acctNavigate(s.AcctNav)
				} else if len(acctPending) > 0 && acctPending[0].Svc == "sp" {
					acctNavigate("https://open.spotify.com/")
				} else {
					acctNavigate(acctHome)
				}
				applyAcctPanel()
				return 0
			})
		}
		if r := comCall(wvEnv, 3, wvHwnd, uintptr(unsafe.Pointer(acctCreateH))); r != 0 {
			acctCreating = false
			logf("acct create failed: 0x%x", r)
		}
		return
	}
	if st.AcctShow && st.AcctRect[2] >= 100 && st.AcctRect[3] >= 100 {
		rc := rect{int32(st.AcctRect[0]), int32(st.AcctRect[1]), int32(st.AcctRect[0] + st.AcctRect[2]), int32(st.AcctRect[1] + st.AcctRect[3])}
		comCall(acctCtrl, 6, uintptr(unsafe.Pointer(&rc)))
		comCall(acctCtrl, 4, 1)
		if !acctShown {
			acctShown = true
			acctRaise()
		}
	} else {
		acctShown = false
		// out of sight, left of the window, but still "on screen" for the page: Spotify only builds the
		// parts of its home page that are drawn
		rc := rect{-4200, 0, -3000, 900}
		comCall(acctCtrl, 6, uintptr(unsafe.Pointer(&rc)))
		comCall(acctCtrl, 4, 1)
	}
	if st.AcctNavSeq != acctNavNow {
		acctNavNow = st.AcctNavSeq
		u := st.AcctNav
		if !strings.HasPrefix(u, "https://") {
			u = acctHome
		}
		logf("acct navigate %s", u)
		acctNavigate(u)
	}
}

// UI thread, about twice a second while the account page exists
func pollAcct() {
	acctWant = len(acctPending) > 0
	if acctCtrl == 0 {
		if acctWant {
			applyAcctPanel()
		}
		return
	}
	themeMu.Lock()
	show := themeState.AcctShow
	themeMu.Unlock()
	if len(acctPending) == 0 {
		// idle and not being shown: closed after a while (it's a whole web page)
		if !show && time.Since(acctLastUse) > 2*time.Minute {
			acctClose()
		}
		return
	}
	acctLastUse = time.Now()
	if show { // you're signing in: nothing may take the page away from you; only "are you signed in yet?" runs
		j := -1
		for n, q := range acctPending {
			if q.Kind == "status" {
				j = n
				break
			}
		}
		if j < 0 {
			acctReqAt = time.Now()
			return
		}
		if j > 0 && !acctPolling {
			acctPending[0], acctPending[j] = acctPending[j], acctPending[0]
		}
	}

	r := acctPending[0]
	if time.Since(acctReqAt) > 45*time.Second { // the page never answered
		acctPending = acctPending[1:]
		acctReqAt = time.Now()
		acctSend(r.Seq, `{"error":"YouTube Music didn't answer"}`)
		return
	}
	if acctPolling && time.Since(acctPollAt) < 5*time.Second {
		return
	}
	if acctScriptH == nil {
		acctScriptH = newHandler(func(this, hr, res uintptr) uintptr {
			acctPolling = false
			if hr != 0 || res == 0 {
				return 0
			}
			var out string
			if json.Unmarshal([]byte(utf16PtrStringBig(res)), &out) != nil || out == "" {
				return 0 // not ready yet
			}
			if len(acctPending) > 0 && acctPending[0].Seq == acctInflight {
				acctPending = acctPending[1:]
				acctReqAt = time.Now()
			}
			acctSend(acctInflight, out)
			return 0
		})
	}
	rb, _ := json.Marshal(r)
	js, _ := syscall.UTF16PtrFromString(strings.Replace(acctJS, "__REQ__", string(rb), 1))
	acctPolling, acctPollAt, acctInflight = true, time.Now(), r.Seq
	if comCall(acctCore, 29, uintptr(unsafe.Pointer(js)), uintptr(unsafe.Pointer(acctScriptH))) != 0 {
		acctPolling = false
	}
}

func acctSend(seq int, data string) {
	if !json.Valid([]byte(data)) {
		data = `{"error":"bad answer"}`
	}
	select {
	case acctPostCh <- fmt.Sprintf(`{"seq":%d,"data":%s}`, seq, data):
	default:
	}
}

func acctPoster() {
	c := http.Client{Timeout: 10 * time.Second}
	for body := range acctPostCh {
		if appBase == "" {
			continue
		}
		if resp, err := c.Post(appBase+"/api/yt/acct/result", "application/json", strings.NewReader(body)); err == nil {
			resp.Body.Close()
		}
	}
}
