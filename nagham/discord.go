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
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

type discordCfg struct {
	Enabled bool   `json:"enabled"`
	AppID   string `json:"appId"`
}

var (
	dcMu        sync.Mutex // guards the fields below (never held while talking to Discord)
	dcCfg       discordCfg
	dcConnected bool
	dcUser      string
	dcLastErr   string
	dcWant      any // latest activity we want shown (nil = clear)
	dcGen       int // bumped every time dcWant or the settings change
	dcReset     bool
	dcWake      = make(chan struct{}, 1)
	dcOnce      sync.Once
	dcConn      net.Conn // only touched by dcWorker
	dcShown     bool     // the last status was accepted by Discord
	dcRefuse    string   // Discord's reason, when it said no
	appIDRe     = regexp.MustCompile(`^\d{17,20}$`)
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

// dcReadTimeout reads one frame but gives up (and drops the connection) if Discord doesn't answer in time.
func dcReadTimeout(c net.Conn, d time.Duration) (uint32, []byte, error) {
	type res struct {
		op  uint32
		b   []byte
		err error
	}
	ch := make(chan res, 1)
	go func() { op, b, err := dcRead(c); ch <- res{op, b, err} }()
	select {
	case r := <-ch:
		return r.op, r.b, r.err
	case <-time.After(d):
		c.Close()
		return 0, nil, errors.New("Discord didn't answer")
	}
}

// dcConnect runs only on dcWorker.
func dcConnect(appID string) (net.Conn, string, error) {
	if !appIDRe.MatchString(appID) {
		return nil, "", errors.New("Add your Discord Application ID first.")
	}
	c, err := dialDiscord()
	if err != nil {
		return nil, "", errors.New("Discord isn't running on this PC. Open the Discord app and Nagham connects by itself.")
	}
	if _, err := c.Write(dcFrame(0, map[string]any{"v": 1, "client_id": appID})); err != nil {
		c.Close()
		return nil, "", errors.New("Couldn't talk to Discord. Is it still starting up?")
	}
	op, b, err := dcReadTimeout(c, 6*time.Second)
	if err != nil {
		c.Close()
		return nil, "", errors.New("Discord didn't answer. Check the Application ID.")
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
		return nil, "", errors.New(msg + ". Check the Application ID.")
	}
	user := ready.Data.User.GlobalName
	if user == "" {
		user = ready.Data.User.Username
	}
	return c, user, nil
}

// dcPush sends one SET_ACTIVITY and waits for Discord's reply. Writing and reading never overlap
// (on Windows a pending read on a pipe handle blocks every write to it), so there is no background reader.
func dcPush(c net.Conn, activity any) error {
	n := nonce()
	msg := map[string]any{"cmd": "SET_ACTIVITY", "args": map[string]any{"pid": os.Getpid(), "activity": activity}, "nonce": n}
	if _, err := c.Write(dcFrame(1, msg)); err != nil {
		return err
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		op, b, err := dcReadTimeout(c, 4*time.Second)
		if err != nil {
			return err
		}
		switch op {
		case 2:
			return errors.New("Discord closed the connection")
		case 3:
			c.Write(append(dcHeader(4, len(b)), b...))
		case 1:
			var r struct {
				Evt  string `json:"evt"`
				Data struct {
					Message string `json:"message"`
				} `json:"data"`
				Nonce string `json:"nonce"`
			}
			json.Unmarshal(b, &r)
			if r.Nonce == n || r.Nonce == "" {
				if r.Evt == "ERROR" {
					return dcRefused{r.Data.Message}
				}
				return nil
			}
		}
	}
	return errors.New("Discord didn't answer")
}

// Discord answered, but said no to the activity (the connection itself is fine)
type dcRefused struct{ msg string }

func (e dcRefused) Error() string { return "Discord refused the status: " + e.msg }

// simpler versions of an activity, tried one after another when Discord says no:
// without the buttons and with a short picture link, then just the song's name and artist
func dcSimpler(act any) []any {
	a, ok := act.(map[string]any)
	if !ok {
		return []any{act}
	}
	out := []any{a}
	b := map[string]any{}
	for k, v := range a {
		if k != "buttons" {
			b[k] = v
		}
	}
	if as, ok := a["assets"].(map[string]any); ok {
		nas := map[string]any{}
		for k, v := range as {
			nas[k] = v
		}
		if img, _ := nas["large_image"].(string); len(img) > 250 {
			delete(nas, "large_image")
		}
		b["assets"] = nas
	}
	out = append(out, b)
	c := map[string]any{"details": a["details"], "state": a["state"]}
	if ts, ok := a["timestamps"]; ok {
		c["timestamps"] = ts
	}
	out = append(out, c)
	return out
}

var dcLogged string

// one line in nagham.log when the Discord state changes (not every 4 seconds)
func dcLog(msg string) {
	if msg != dcLogged {
		dcLogged = msg
		log.Printf("discord: %s", msg)
	}
}

func dcHeader(op uint32, n int) []byte {
	h := make([]byte, 8)
	binary.LittleEndian.PutUint32(h[:4], op)
	binary.LittleEndian.PutUint32(h[4:], uint32(n))
	return h
}

func dcSetState(connected bool, user, errMsg string) {
	dcMu.Lock()
	dcConnected, dcUser, dcLastErr = connected, user, errMsg
	dcMu.Unlock()
}

func dcKick() {
	dcOnce.Do(func() { go dcWorker() })
	select {
	case dcWake <- struct{}{}:
	default:
	}
}

// dcWorker is the only goroutine that talks to Discord. It keeps trying to connect (so opening Discord
// later just works), and only the newest wanted activity is ever sent, so fast song changes never queue up.
func dcWorker() {
	tick := time.NewTicker(4 * time.Second)
	sent := -1
	closeConn := func() {
		if dcConn != nil {
			dcConn.Close()
			dcConn = nil
		}
	}
	for {
		select {
		case <-dcWake:
		case <-tick.C:
		}
		dcMu.Lock()
		enabled := dcCfg.Enabled && dcCfg.AppID != ""
		appID, gen, want, reset := dcCfg.AppID, dcGen, dcWant, dcReset
		dcReset = false
		dcMu.Unlock()
		if reset {
			closeConn()
			sent = -1
		}
		if !enabled {
			if dcConn != nil {
				dcPush(dcConn, nil)
				closeConn()
			}
			dcSetState(false, "", "")
			sent = -1
			continue
		}
		if dcConn == nil {
			c, user, err := dcConnect(appID)
			if err != nil {
				dcSetState(false, "", err.Error())
				dcLog(err.Error())
				continue
			}
			dcConn = c
			dcSetState(true, user, "")
			dcLog("connected as " + user)
			sent = -1
		}
		if sent != gen {
			var err error
			for i, a := range dcSimpler(want) {
				if err = dcPush(dcConn, a); err == nil {
					if i > 0 {
						dcLog(fmt.Sprintf("status shown in a simpler form (try %d)", i+1))
					}
					dcMu.Lock()
					dcShown, dcRefuse = want != nil, ""
					dcMu.Unlock()
					break
				}
				if _, refused := err.(dcRefused); !refused {
					break
				}
				dcLog(err.Error())
				dcMu.Lock()
				dcRefuse = err.Error()
				dcMu.Unlock()
			}
			if _, refused := err.(dcRefused); refused { // Discord is there but won't show it: don't drop the connection
				sent = gen
				continue
			}
			if err != nil {
				dcLog("lost the connection: " + err.Error())
				closeConn()
				dcSetState(false, "", "Lost the connection to Discord — reconnecting…")
				select { // try again soon
				case dcWake <- struct{}{}:
				default:
				}
				time.Sleep(700 * time.Millisecond)
				continue
			}
			sent = gen
		}
	}
}

func discordStatus(w http.ResponseWriter, r *http.Request) {
	dcMu.Lock()
	defer dcMu.Unlock()
	writeJSON(w, map[string]any{"enabled": dcCfg.Enabled, "appId": dcCfg.AppID, "connected": dcConnected, "user": dcUser, "error": dcLastErr, "shown": dcShown, "refused": dcRefuse})
}

func discordConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled *bool   `json:"enabled"`
		AppID   *string `json:"appId"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	dcMu.Lock()
	if req.AppID != nil {
		id := strings.TrimSpace(*req.AppID)
		if id != "" && !appIDRe.MatchString(id) {
			dcMu.Unlock()
			http.Error(w, "That doesn't look like a Discord Application ID (it's a long number, e.g. 1234567890123456789).", 400)
			return
		}
		if id != dcCfg.AppID {
			dcReset = true
		}
		dcCfg.AppID = id
	}
	if req.Enabled != nil {
		dcCfg.Enabled = *req.Enabled
	}
	dcLastErr = ""
	dcGen++
	dcSave()
	dcMu.Unlock()
	dcKick()
	// give the worker a moment so the settings page can show the real result
	for i := 0; i < 30; i++ {
		time.Sleep(100 * time.Millisecond)
		dcMu.Lock()
		done := !dcCfg.Enabled || dcConnected || dcLastErr != ""
		dcMu.Unlock()
		if done {
			break
		}
	}
	dcMu.Lock()
	defer dcMu.Unlock()
	writeJSON(w, map[string]any{"ok": true, "connected": dcConnected, "user": dcUser, "error": dcLastErr})
}

// POST /api/discord/activity {title, artist, album, cover, start, end, paused} or {clear:true}
func discordActivity(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title, Artist, Album, Cover, URL string
		Start, End                       int64
		Paused, Clear                    bool
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req)
	dcMu.Lock()
	on := dcCfg.Enabled && dcCfg.AppID != ""
	dcMu.Unlock()
	if !on {
		writeJSON(w, map[string]any{"ok": false})
		return
	}
	var act any
	lookup := false
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
		album := req.Album
		if !dcRealAlbum(album) {
			album = dcAlbumCached(req.Title, req.Artist)
		}
		assets := map[string]any{"large_text": cut(firstNonEmpty(album, req.Title), 128)}
		if strings.HasPrefix(req.Cover, "https://") {
			assets["large_image"] = req.Cover
		} else if c := dcCoverCached(req.Title, req.Artist); c != "" { // a song from the PC: its cover from the catalogue
			assets["large_image"] = c
		} else {
			assets["large_image"] = "nagham" // optional art asset uploaded in the Discord app
			lookup = true
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
	dcMu.Lock()
	dcWant = act
	dcGen++
	dcMu.Unlock()
	dcKick()
	if lookup { // find the cover in the background, then update the status if it's still the same song
		go func(a map[string]any, title, artist, album0 string) {
			c, album := dcCoverLookup(title, artist)
			if c == "" {
				return
			}
			dcMu.Lock()
			defer dcMu.Unlock()
			if cur, ok := dcWant.(map[string]any); ok && fmt.Sprint(cur["details"]) == fmt.Sprint(a["details"]) && fmt.Sprint(cur["state"]) == fmt.Sprint(a["state"]) {
				as := map[string]any{}
				for k, v := range cur["assets"].(map[string]any) {
					as[k] = v
				}
				as["large_image"] = c
				if !dcRealAlbum(album0) && album != "" {
					as["large_text"] = album
				}
				n := map[string]any{}
				for k, v := range cur {
					n[k] = v
				}
				n["assets"] = as
				dcWant = n
				dcGen++
				go dcKick()
			}
		}(act.(map[string]any), req.Title, req.Artist, req.Album)
	}
	writeJSON(w, map[string]any{"ok": true})
}

// covers for songs on this PC (Discord can only show pictures from the internet): looked up once in the free catalogue
var (
	dcCoverMu  sync.Mutex
	dcCoverMap = map[string][2]string{} // cover, album
)

func dcCoverKey(title, artist string) string {
	return strings.ToLower(strings.TrimSpace(title)) + "|" + strings.ToLower(strings.TrimSpace(artist))
}

func dcCoverCached(title, artist string) string {
	dcCoverMu.Lock()
	defer dcCoverMu.Unlock()
	return dcCoverMap[dcCoverKey(title, artist)][0]
}

func dcAlbumCached(title, artist string) string {
	dcCoverMu.Lock()
	defer dcCoverMu.Unlock()
	return dcCoverMap[dcCoverKey(title, artist)][1]
}

// a folder name ("Songs") is not an album
func dcRealAlbum(a string) bool {
	switch strings.ToLower(strings.TrimSpace(a)) {
	case "", "songs", "unknown album", "music", "downloads":
		return false
	}
	return true
}

func dcCoverLookup(title, artist string) (string, string) {
	key := dcCoverKey(title, artist)
	dcCoverMu.Lock()
	hit, seen := dcCoverMap[key]
	dcCoverMu.Unlock()
	if seen {
		return hit[0], hit[1]
	}
	c, album := "", ""
	clean := func(s string) string {
		s = regexp.MustCompile(`\s*[\(\[].*?[\)\]]`).ReplaceAllString(s, "")
		return strings.TrimSpace(s)
	}
	a := strings.TrimSpace(strings.Split(strings.Split(artist, ",")[0], "&")[0])
	if strings.EqualFold(a, "Unknown artist") {
		a = ""
	}
	qs := []string{}
	if a != "" {
		qs = append(qs, a+" "+clean(title))
	} else {
		qs = append(qs, clean(title))
	}
	norm := func(s string) string {
		return strings.Join(strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) }), " ")
	}
	for _, q := range qs {
		var res struct {
			Data []dzTrack `json:"data"`
		}
		if fetchJSON(apiBase["deezer"]+"/search?limit=5&q="+url.QueryEscape(q), 24*time.Hour, &res) != nil {
			continue
		}
		for _, t := range res.Data {
			okTitle := strings.Contains(norm(t.Title), norm(clean(title))) || strings.Contains(norm(clean(title)), norm(t.Title))
			okArtist := a == "" || strings.Contains(norm(t.Artist.Name), norm(a)) || strings.Contains(norm(a), norm(t.Artist.Name))
			if okTitle && okArtist && strings.HasPrefix(firstNonEmpty(t.Album.CoverXL, t.Album.CoverMedium), "https://") {
				c, album = firstNonEmpty(t.Album.CoverXL, t.Album.CoverMedium), t.Album.Title
				break
			}
		}
		if c != "" {
			break
		}
	}
	dcCoverMu.Lock()
	dcCoverMap[key] = [2]string{c, album} // remember misses too
	dcCoverMu.Unlock()
	return c, album
}

// called once at start: reconnect to Discord in the background if it was switched on
func dcStart() {
	if dcCfg.Enabled && dcCfg.AppID != "" {
		dcKick()
	}
}
