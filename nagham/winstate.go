package main

// Title-bar colour and window title, posted by the UI and picked up by the
// native window process (long-poll).

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

type winState struct {
	V       int    `json:"v"`
	Caption string `json:"caption"`
	Text    string `json:"text"`
	Dark    bool   `json:"dark"`
	Title   string `json:"title"`
	// YouTube Music shown inside Nagham's window (native window only)
	YtmURL     string   `json:"ytmUrl"`
	YtmRect    [4]int   `json:"ytmRect"` // x, y, w, h in physical pixels
	YtmVisible bool     `json:"ytmVisible"`
	YtmHidden  bool     `json:"ytmHidden"` // play without showing the page (tucked into a 2px corner)
	Mini       bool     `json:"mini"`      // the always-on-top mini player is open
	ShowSeq    int      `json:"showSeq"`   // bumped to bring Nagham's window to the front
	YtmCmds    []ytmCmd `json:"ytmCmds"`
	YtmCmdSeq  int      `json:"ytmCmdSeq"`
	YtmVol     float64  `json:"ytmVol"` // the volume the hidden YouTube Music page must keep (0..1)
	YtmVolSet  bool     `json:"ytmVolSet"`
	AcctOpen   bool      `json:"acctOpen"`   // the YouTube Music account page (For you) exists
	AcctShow   bool      `json:"acctShow"`   // ...and is shown (to sign in)
	AcctRect   [4]int    `json:"acctRect"`   // where, in physical pixels
	AcctNav    string    `json:"acctNav"`    // a page to open in it
	AcctNavSeq int       `json:"acctNavSeq"`
	AcctReqs   []acctReq `json:"acctReqs"`
	AcctReqSeq int       `json:"acctReqSeq"`
}

type ytmCmd struct {
	Seq int    `json:"seq"`
	JS  string `json:"js"`
}

var (
	wsMu   sync.Mutex
	wsCond = sync.NewCond(&wsMu)
	wsCur  = winState{V: 0, Caption: "#160b2e", Text: "#ffffff", Dark: true, Title: "Nagham"}
)

func windowStatePost(w http.ResponseWriter, r *http.Request) {
	var s winState
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&s); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	wsMu.Lock()
	if s.Caption != wsCur.Caption || s.Text != wsCur.Text || s.Dark != wsCur.Dark || s.Title != wsCur.Title {
		wsCur.Caption, wsCur.Text, wsCur.Dark, wsCur.Title = s.Caption, s.Text, s.Dark, s.Title
		wsCur.V++
		wsCond.Broadcast()
	}
	wsMu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

func windowStateWait(w http.ResponseWriter, r *http.Request) {
	v, _ := strconv.Atoi(r.URL.Query().Get("v"))
	deadline := time.Now().Add(25 * time.Second)
	wsMu.Lock()
	for wsCur.V == v && time.Now().Before(deadline) {
		t := time.AfterFunc(time.Until(deadline), func() { wsMu.Lock(); wsCond.Broadcast(); wsMu.Unlock() })
		wsCond.Wait()
		t.Stop()
	}
	s := wsCur
	wsMu.Unlock()
	writeJSON(w, s)
}

// window preferences saved by the UI inside settings
func windowPrefs() (mode, bg string) {
	mu.Lock()
	raw := store.Settings
	mu.Unlock()
	var s struct {
		WindowMode string `json:"windowMode"`
		WindowBg   string `json:"windowBg"`
	}
	json.Unmarshal(raw, &s)
	if s.WindowBg == "" {
		s.WindowBg = "#160b2e"
	}
	return s.WindowMode, s.WindowBg
}

// ---- UI health: the page reports problems and says when it's ready ----

var uiReadyAt atomic.Int64

func uiReady(w http.ResponseWriter, r *http.Request) {
	uiReadyAt.Store(time.Now().UnixNano())
	writeJSON(w, map[string]any{"ok": true})
}

func clientLog(w http.ResponseWriter, r *http.Request) {
	var req struct{ Msg, UA string }
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req)
	p := filepath.Join(dataDir, "client.log")
	if st, err := os.Stat(p); err == nil && st.Size() > 1<<20 {
		os.Rename(p, p+".old")
	}
	if f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		fmt.Fprintf(f, "%s  %s  [%s]\n", time.Now().Format("2006-01-02 15:04:05"), req.Msg, req.UA)
		f.Close()
	}
	writeJSON(w, map[string]any{"ok": true})
}

// opens a YouTube / YouTube Music page in the user's browser (fallback when a popup can't be opened)
func openURLHandler(w http.ResponseWriter, r *http.Request) {
	var req struct{ URL string }
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req)
	ok := false
	for _, p := range []string{"https://music.youtube.com/", "https://www.youtube.com/"} {
		if len(req.URL) > len(p) && req.URL[:len(p)] == p {
			ok = true
		}
	}
	if !ok {
		http.Error(w, "not allowed", 403)
		return
	}
	openExternal(req.URL)
	writeJSON(w, map[string]any{"ok": true})
}

// POST /api/ytm {url?, rect?, visible?, hidden?, cmd?} – YouTube Music panel inside the window
func ytmPanel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL     *string  `json:"url"`
		Rect    *[4]int  `json:"rect"`
		Visible *bool    `json:"visible"`
		Hidden  *bool    `json:"hidden"`
		Cmd     string   `json:"cmd"`
		Vol     *float64 `json:"vol"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<17)).Decode(&req) // the sound-effects script for the YouTube Music page is a few KB
	wsMu.Lock()
	changed := false
	if req.URL != nil {
		wsCur.YtmURL = *req.URL
		changed = true
		ytmStMu.Lock()
		ytmSt, ytmAct = nil, "" // the old page's state no longer applies
		ytmStMu.Unlock()
		wsCur.YtmCmds = nil // commands meant for the old page must not run on the new one
	}
	if req.Rect != nil {
		wsCur.YtmRect = *req.Rect
		changed = true
	}
	if req.Visible != nil {
		wsCur.YtmVisible = *req.Visible
		changed = true
	}
	if req.Hidden != nil {
		wsCur.YtmHidden = *req.Hidden
		changed = true
	}
	if req.Vol != nil {
		v := *req.Vol
		if v < 0 {
			v = 0
		} else if v > 1 {
			v = 1
		}
		if !wsCur.YtmVolSet || wsCur.YtmVol != v {
			wsCur.YtmVol, wsCur.YtmVolSet = v, true
			changed = true
		}
	}
	if req.Cmd != "" {
		wsCur.YtmCmdSeq++
		wsCur.YtmCmds = append(wsCur.YtmCmds, ytmCmd{wsCur.YtmCmdSeq, req.Cmd})
		if n := len(wsCur.YtmCmds); n > 12 {
			wsCur.YtmCmds = append([]ytmCmd(nil), wsCur.YtmCmds[n-12:]...)
		}
		changed = true
	}
	if changed {
		wsCur.V++
		wsCond.Broadcast()
	}
	wsMu.Unlock()
	writeJSON(w, map[string]any{"ok": true, "native": nativeWindowActive.Load() || os.Getenv("NAGHAM_FAKE_NATIVE") != ""})
}

// playback state of the YouTube Music page, reported by the window process
var (
	ytmStMu sync.Mutex
	ytmSt   json.RawMessage
	ytmStAt time.Time
	ytmAct  string
)

func ytmState(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
		if err != nil || !json.Valid(b) {
			http.Error(w, "bad state", 400)
			return
		}
		var a struct {
			Act string `json:"act"`
		}
		json.Unmarshal(b, &a)
		ytmStMu.Lock()
		ytmSt, ytmStAt = b, time.Now()
		if a.Act == "next" || a.Act == "prev" {
			ytmAct = a.Act // kept until the page has seen it
		}
		ytmStMu.Unlock()
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	ytmStMu.Lock()
	st, at, act := ytmSt, ytmStAt, ytmAct
	ytmAct = ""
	ytmStMu.Unlock()
	if st == nil {
		st = json.RawMessage("null")
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintf(w, `{"state":%s,"age":%d,"act":%q}`, st, time.Since(at).Milliseconds(), act)
}

// set while Nagham's own window (not an Edge window) is showing the UI
var nativeWindowActive atomic.Bool

// POST /api/window/show – bring Nagham's window to the front
func windowShow(w http.ResponseWriter, r *http.Request) {
	wsMu.Lock()
	wsCur.ShowSeq++
	wsCur.V++
	wsCond.Broadcast()
	wsMu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}
