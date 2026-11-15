package main

// Discord Rich Presence over Discord's local IPC (named pipe on Windows,
// unix socket elsewhere). Shows "Listening to <app name>" with the song.
// Needs only a Discord *Application ID* (public, not a secret).

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type discordCfg struct {
	Enabled bool   `json:"enabled"`
	AppID   string `json:"appId"`
}

var (
	dcMu      sync.Mutex
	dcCfg     discordCfg
	dcConn    net.Conn
	dcUser    string
	dcLastErr string
	dcLastAct json.RawMessage
	appIDRe   = regexp.MustCompile(`^\d{17,20}$`)
)

func dcFile() string { return filepath.Join(dataDir, "discord.json") }
func dcLoad() {
	if b, err := os.ReadFile(dcFile()); err == nil {
		json.Unmarshal(b, &dcCfg)
	}
}
func dcSave() { b, _ := json.MarshalIndent(dcCfg, "", "  "); os.WriteFile(dcFile(), b, 0o644) }

func dcFrame(op uint32, v any) []byte {
	payload, _ := json.Marshal(v)
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, op)
	binary.Write(&buf, binary.LittleEndian, uint32(len(payload)))
	buf.Write(payload)
	return buf.Bytes()
}

func dcRead(c net.Conn) (uint32, []byte, error) {
	var hdr [8]byte
	if _, err := io.ReadFull(c, hdr[:]); err != nil {
		return 0, nil, err
	}
	op, n := binary.LittleEndian.Uint32(hdr[:4]), binary.LittleEndian.Uint32(hdr[4:])
	if n > 1<<20 {
		return 0, nil, errors.New("frame too large")
	}
	b := make([]byte, n)
	_, err := io.ReadFull(c, b)
	return op, b, err
}

func nonce() string { b := make([]byte, 8); rand.Read(b); return hex.EncodeToString(b) }

// dcConnect must be called with dcMu held.
func dcConnect() error {
	if dcConn != nil {
		return nil
	}
	if !appIDRe.MatchString(dcCfg.AppID) {
		return errors.New("Add your Discord Application ID first.")
	}
	c, err := dialDiscord()
	if err != nil {
		return errors.New("Discord isn't running on this PC (open the Discord app, then try again).")
	}
	c.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := c.Write(dcFrame(0, map[string]any{"v": 1, "client_id": dcCfg.AppID})); err != nil {
		c.Close()
		return err
	}
	op, b, err := dcRead(c)
	if err != nil {
		c.Close()
		return errors.New("Discord didn't answer. Check the Application ID.")
	}
	var ready struct {
		Evt  string `json:"evt"`
		Code int    `json:"code"`
		Msg  string `json:"message"`
		Data struct {
			User struct {
				Username   string `json:"username"`
				GlobalName string `json:"global_name"`
			} `json:"user"`
		} `json:"data"`
	}
	json.Unmarshal(b, &ready)
	if op == 2 || ready.Evt != "READY" {
		c.Close()
		msg := "Discord refused the connection"
		if ready.Msg != "" {
			msg += ": " + ready.Msg
		}
		return errors.New(msg + ". Check the Application ID.")
	}
	c.SetDeadline(time.Time{})
	dcConn = c
	dcUser = ready.Data.User.GlobalName
	if dcUser == "" {
		dcUser = ready.Data.User.Username
	}
	go dcDrain(c)
	return nil
}

// dcDrain reads Discord's replies so the pipe never fills up, and notices disconnects.
func dcDrain(c net.Conn) {
	for {
		op, b, err := dcRead(c)
		if err != nil || op == 2 {
			dcMu.Lock()
			if dcConn == c {
				dcConn.Close()
				dcConn = nil
			}
			dcMu.Unlock()
			return
		}
		if op == 3 { // ping → pong
			c.Write(append(dcHeader(4, len(b)), b...))
		}
	}
}

func dcHeader(op uint32, n int) []byte {
	h := make([]byte, 8)
	binary.LittleEndian.PutUint32(h[:4], op)
	binary.LittleEndian.PutUint32(h[4:], uint32(n))
	return h
}

// dcSend must be called with dcMu held; activity may be nil to clear.
func dcSend(activity any) error {
	for attempt := 0; attempt < 2; attempt++ {
		if err := dcConnect(); err != nil {
			return err
		}
		msg := map[string]any{"cmd": "SET_ACTIVITY", "args": map[string]any{"pid": os.Getpid(), "activity": activity}, "nonce": nonce()}
		dcConn.SetWriteDeadline(time.Now().Add(3 * time.Second))
		if _, err := dcConn.Write(dcFrame(1, msg)); err != nil {
			dcConn.Close()
			dcConn = nil
			continue
		}
		return nil
	}
	return errors.New("Lost the connection to Discord.")
}

func discordStatus(w http.ResponseWriter, r *http.Request) {
	dcMu.Lock()
	defer dcMu.Unlock()
	writeJSON(w, map[string]any{"enabled": dcCfg.Enabled, "appId": dcCfg.AppID, "connected": dcConn != nil, "user": dcUser, "error": dcLastErr})
}

func discordConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled *bool   `json:"enabled"`
		AppID   *string `json:"appId"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	dcMu.Lock()
	defer dcMu.Unlock()
	if req.AppID != nil {
		id := strings.TrimSpace(*req.AppID)
		if id != "" && !appIDRe.MatchString(id) {
			http.Error(w, "That doesn't look like a Discord Application ID (it's a long number, e.g. 1234567890123456789).", 400)
			return
		}
		if id != dcCfg.AppID && dcConn != nil {
			dcConn.Close()
			dcConn = nil
		}
		dcCfg.AppID = id
	}
	if req.Enabled != nil {
		dcCfg.Enabled = *req.Enabled
		if !dcCfg.Enabled && dcConn != nil {
			dcSend(nil)
			dcConn.Close()
			dcConn = nil
		}
	}
	dcLastErr = ""
	dcSave()
	if dcCfg.Enabled {
		if err := dcConnect(); err != nil {
			dcLastErr = err.Error()
		} else if dcLastAct != nil {
			var a any
			json.Unmarshal(dcLastAct, &a)
			dcSend(a)
		}
	}
	writeJSON(w, map[string]any{"ok": true, "connected": dcConn != nil, "user": dcUser, "error": dcLastErr})
}

// POST /api/discord/activity {title, artist, album, cover, start, end, paused} or {} to clear
func discordActivity(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title, Artist, Album, Cover, URL string
		Start, End                       int64
		Paused, Clear                    bool
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req)
	dcMu.Lock()
	defer dcMu.Unlock()
	if !dcCfg.Enabled || dcCfg.AppID == "" {
		writeJSON(w, map[string]any{"ok": false})
		return
	}
	var act any
	if !req.Clear && req.Title != "" {
		cut := func(s string, n int) string {
			if r := []rune(s); len(r) > n {
				return string(r[:n-1]) + "…"
			}
			if len([]rune(s)) < 2 {
				s += "  "
			}
			return s
		}
		a := map[string]any{"type": 2, "details": cut(req.Title, 128), "state": cut("by "+req.Artist, 128)}
		assets := map[string]any{"large_text": cut(firstNonEmpty(req.Album, req.Title), 128)}
		if strings.HasPrefix(req.Cover, "https://") {
			assets["large_image"] = req.Cover
		} else {
			assets["large_image"] = "nagham" // optional art asset uploaded in the Discord app
		}
		if req.Paused {
			assets["small_text"] = "Paused"
			a["state"] = cut("Paused · "+req.Artist, 128)
		} else if req.Start > 0 {
			ts := map[string]any{"start": req.Start}
			if req.End > req.Start {
				ts["end"] = req.End
			}
			a["timestamps"] = ts
		}
		a["assets"] = assets
		if strings.HasPrefix(req.URL, "https://") {
			a["buttons"] = []map[string]string{{"label": "Listen", "url": req.URL}}
		}
		act = a
	}
	b, _ := json.Marshal(act)
	dcLastAct = b
	if err := dcSend(act); err != nil {
		dcLastErr = err.Error()
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	dcLastErr = ""
	writeJSON(w, map[string]any{"ok": true})
}
