package main

// Remote control between Nagham's main page and its helpers (the mini player
// window and the taskbar buttons): the page publishes what's playing, helpers
// send commands back.

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

var (
	rcMu     sync.Mutex
	rcCond   = sync.NewCond(&rcMu)
	rcState  = json.RawMessage(`{}`)
	rcV      int
	rcCmds   []rcCmd
	rcSeq    int
	rcCmdsCv = sync.NewCond(&rcMu)
)

type rcCmd struct {
	Seq int     `json:"seq"`
	Cmd string  `json:"cmd"`
	Val float64 `json:"val"`
}

func waitCond(c *sync.Cond, d time.Duration, done func() bool) {
	deadline := time.Now().Add(d)
	for !done() && time.Now().Before(deadline) {
		t := time.AfterFunc(time.Until(deadline), func() { rcMu.Lock(); c.Broadcast(); rcMu.Unlock() })
		c.Wait()
		t.Stop()
	}
}

// GET /api/remote/state?v=N (long-poll) · POST (from the main page)
func remoteState(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
		if err != nil || !json.Valid(b) {
			http.Error(w, "bad state", 400)
			return
		}
		rcMu.Lock()
		if string(b) != string(rcState) {
			rcState = b
			rcV++
			rcCond.Broadcast()
		}
		rcMu.Unlock()
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	v, _ := strconv.Atoi(r.URL.Query().Get("v"))
	rcMu.Lock()
	waitCond(rcCond, 25*time.Second, func() bool { return rcV != v })
	st, nv := rcState, rcV
	rcMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(`{"v":` + strconv.Itoa(nv) + `,"state":`))
	w.Write(st)
	w.Write([]byte("}"))
}

// POST /api/remote/cmd {cmd, val} · GET /api/remote/cmds?after=N (long-poll, main page)
func remoteCmd(w http.ResponseWriter, r *http.Request) {
	var c rcCmd
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&c); err != nil || c.Cmd == "" {
		http.Error(w, "bad command", 400)
		return
	}
	pushRemote(c.Cmd, c.Val)
	writeJSON(w, map[string]any{"ok": true})
}

func pushRemote(cmd string, val float64) {
	rcMu.Lock()
	rcSeq++
	rcCmds = append(rcCmds, rcCmd{rcSeq, cmd, val})
	if len(rcCmds) > 30 {
		rcCmds = append([]rcCmd(nil), rcCmds[len(rcCmds)-30:]...)
	}
	rcCmdsCv.Broadcast()
	rcMu.Unlock()
}

func remoteCmds(w http.ResponseWriter, r *http.Request) {
	after, err := strconv.Atoi(r.URL.Query().Get("after"))
	rcMu.Lock()
	if err != nil || after < 0 { // first call: only the position, no old commands
		s := rcSeq
		rcMu.Unlock()
		writeJSON(w, map[string]any{"seq": s, "cmds": []rcCmd{}})
		return
	}
	waitCond(rcCmdsCv, 25*time.Second, func() bool { return rcSeq > after })
	out := []rcCmd{}
	for _, c := range rcCmds {
		if c.Seq > after {
			out = append(out, c)
		}
	}
	s := rcSeq
	rcMu.Unlock()
	writeJSON(w, map[string]any{"seq": s, "cmds": out})
}

// POST /api/mini {open} – the always-on-top mini player window (Nagham's own window only)
func miniWindow(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Open bool `json:"open"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req)
	wsMu.Lock()
	if wsCur.Mini != req.Open {
		wsCur.Mini = req.Open
		wsCur.V++
		wsCond.Broadcast()
	}
	wsMu.Unlock()
	writeJSON(w, map[string]any{"ok": true, "native": nativeWindowActive.Load()})
}
