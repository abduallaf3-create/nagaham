package main

// YouTube Music linking via the official YouTube Data API v3 and Google OAuth
// (loopback redirect + PKCE). Google requires a client secret for desktop
// OAuth clients; it is typed in by the user and saved only in their data
// folder – nothing secret is built into Nagham.exe.

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	ytRedirectURI = "http://127.0.0.1:8888/ytcallback"
	ytScope       = "https://www.googleapis.com/auth/youtube"
)

var (
	ytAuthURL  = envOr("NAGHAM_YT_AUTH", "https://accounts.google.com/o/oauth2/v2/auth")
	ytTokenURL = envOr("NAGHAM_YT_TOKEN", "https://oauth2.googleapis.com/token")
	ytAPI      = envOr("NAGHAM_YT_API", "https://www.googleapis.com")
)

type ytTokens struct {
	ClientID     string          `json:"clientId"`
	ClientSecret string          `json:"clientSecret"`
	AccessToken  string          `json:"accessToken,omitempty"`
	RefreshToken string          `json:"refreshToken,omitempty"`
	Expiry       time.Time       `json:"expiry,omitempty"`
	Channel      json.RawMessage `json:"channel,omitempty"`
	Scope        string          `json:"scope,omitempty"`
	ConfiguredAt time.Time       `json:"configuredAt,omitempty"`
}

var (
	ytMu        sync.Mutex
	yt          ytTokens
	ytPending   *spLogin
	ytLastError string
)

func ytFile() string { return filepath.Join(dataDir, "youtube.json") }
func ytLoad() {
	if b, err := os.ReadFile(ytFile()); err == nil {
		json.Unmarshal(b, &yt)
	}
}
func ytSave() { b, _ := json.MarshalIndent(yt, "", "  "); os.WriteFile(ytFile(), b, 0o600) }

func ytStatus(w http.ResponseWriter, r *http.Request) {
	ytMu.Lock()
	defer ytMu.Unlock()
	writeJSON(w, map[string]any{
		"configured":  yt.ClientID != "" && yt.ClientSecret != "",
		"clientId":    yt.ClientID,
		"connected":   yt.RefreshToken != "",
		"channel":     yt.Channel,
		"error":       ytLastError,
		"pending":     ytPending != nil && time.Since(ytPending.started) < 10*time.Minute,
		"redirectUri": ytRedirectURI,
		"canDelete":   strings.Contains(yt.Scope, "auth/youtube ") || strings.HasSuffix(yt.Scope, "auth/youtube"),
	})
}

func ytConfig(w http.ResponseWriter, r *http.Request) {
	var req struct{ ClientID, ClientSecret string }
	json.NewDecoder(r.Body).Decode(&req)
	id, sec := strings.TrimSpace(req.ClientID), strings.TrimSpace(req.ClientSecret)
	if !strings.HasSuffix(id, ".apps.googleusercontent.com") {
		http.Error(w, "That doesn't look like a Google OAuth Client ID. It ends with “.apps.googleusercontent.com”.", 400)
		return
	}
	if len(sec) < 10 {
		http.Error(w, "Paste the Client secret shown next to your Client ID in Google Cloud.", 400)
		return
	}
	ytMu.Lock()
	if yt.ClientID != id {
		yt = ytTokens{}
	}
	yt.ClientID, yt.ClientSecret = id, sec
	yt.ConfiguredAt = time.Now()
	ytLastError = ""
	ytSave()
	ytMu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

// the user's own keys, so they can share them with a friend (local only)
func ytKeys(w http.ResponseWriter, r *http.Request) {
	ytMu.Lock()
	defer ytMu.Unlock()
	if yt.ClientID == "" {
		http.Error(w, "No YouTube keys saved yet.", 404)
		return
	}
	writeJSON(w, map[string]any{"clientId": yt.ClientID, "clientSecret": yt.ClientSecret})
}

func ytLogout(w http.ResponseWriter, r *http.Request) {
	ytMu.Lock()
	yt = ytTokens{ClientID: yt.ClientID, ClientSecret: yt.ClientSecret}
	ytPending, ytLastError = nil, ""
	ytSave()
	ytMu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

func ytLoginStart(w http.ResponseWriter, r *http.Request) {
	var req struct{ Browser bool }
	json.NewDecoder(r.Body).Decode(&req)
	ytMu.Lock()
	id, sec := yt.ClientID, yt.ClientSecret
	ytMu.Unlock()
	if id == "" || sec == "" {
		http.Error(w, "Add your Google Client ID and Client secret first.", 400)
		return
	}
	if err := ensureCallbackServer(); err != nil {
		ytMu.Lock()
		ytLastError = err.Error()
		ytMu.Unlock()
		http.Error(w, err.Error(), 409)
		return
	}
	verifier := randB64(64)
	sum := sha256.Sum256([]byte(verifier))
	state := randB64(24)
	ytMu.Lock()
	ytPending = &spLogin{verifier: verifier, state: state, started: time.Now()}
	ytLastError = ""
	ytMu.Unlock()
	q := url.Values{
		"client_id": {id}, "redirect_uri": {ytRedirectURI}, "response_type": {"code"}, "scope": {ytScope},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"},
		"state": {state}, "access_type": {"offline"}, "prompt": {"consent"},
	}
	u := ytAuthURL + "?" + q.Encode()
	if req.Browser {
		openExternal(u)
	}
	writeJSON(w, map[string]any{"url": u})
}

func ytFail(msg string) {
	ytMu.Lock()
	ytLastError, ytPending = msg, nil
	ytMu.Unlock()
	log.Println("youtube login:", msg)
}

func ytCallbackHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ytMu.Lock()
	pend := ytPending
	ytMu.Unlock()
	fail := func(msg string) { ytFail(msg); callbackPageFor(w, "YouTube Music", false, msg) }
	if e := q.Get("error"); e != "" {
		msg := "YouTube Music login failed: " + e
		if e == "access_denied" {
			msg = "The login was cancelled or blocked. If Google said the app isn't verified or you don't have access, add your Google account as a Test user on the OAuth consent screen, then try again."
		}
		fail(msg)
		return
	}
	if pend == nil || time.Since(pend.started) > 10*time.Minute {
		fail("This login link has expired. Go back to Nagham and click Link again.")
		return
	}
	if q.Get("state") != pend.state {
		fail("Security check failed (the login response didn't match). Please try again.")
		return
	}
	ytMu.Lock()
	id, sec := yt.ClientID, yt.ClientSecret
	ytMu.Unlock()
	t, err := ytTokenRequest(url.Values{"grant_type": {"authorization_code"}, "code": {q.Get("code")}, "redirect_uri": {ytRedirectURI},
		"client_id": {id}, "client_secret": {sec}, "code_verifier": {pend.verifier}})
	if err != nil {
		fail(err.Error())
		return
	}
	ytMu.Lock()
	yt.AccessToken, yt.RefreshToken, yt.Scope = t.AccessToken, t.RefreshToken, t.Scope
	yt.Expiry = time.Now().Add(time.Duration(t.ExpiresIn-60) * time.Second)
	ytPending, ytLastError = nil, ""
	ytSave()
	ytMu.Unlock()
	if t.RefreshToken == "" {
		fail("Google didn't allow staying signed in. Remove Nagham from your Google account's third-party access, then link again.")
		return
	}
	if b, status, err := ytDo("GET", "/youtube/v3/channels?part=snippet&mine=true"); err == nil && status == 200 {
		var c struct {
			Items []json.RawMessage `json:"items"`
		}
		json.Unmarshal(b, &c)
		ytMu.Lock()
		if len(c.Items) > 0 {
			yt.Channel = c.Items[0]
		}
		ytSave()
		ytMu.Unlock()
	} else if status == 403 {
		msg := ytErrorText(b, status)
		ytMu.Lock()
		yt = ytTokens{ClientID: id, ClientSecret: sec}
		ytSave()
		ytMu.Unlock()
		fail(msg)
		return
	}
	callbackPageFor(w, "YouTube Music", true, "")
}

func ytTokenRequest(form url.Values) (*tokenResp, error) {
	resp, err := httpc.PostForm(ytTokenURL, form)
	if err != nil {
		return nil, errors.New("Couldn't reach Google. Check your internet connection and try again.")
	}
	defer resp.Body.Close()
	var t tokenResp
	json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&t)
	if resp.StatusCode != 200 || t.AccessToken == "" {
		switch t.Error {
		case "invalid_client", "unauthorized_client":
			ytMu.Lock()
			fresh := time.Since(yt.ConfiguredAt) < 20*time.Minute
			ytMu.Unlock()
			if fresh {
				return nil, errors.New("Google is still switching on your new keys — this usually takes about 5 minutes. Wait a little, then click Link again. (If it keeps failing, check that the client type is “Desktop app”.)")
			}
			return nil, errors.New("Google rejected the Client ID or Client secret. Choose the downloaded JSON file again, or copy both from Google Cloud → Clients (the type must be “Desktop app”).")
		case "invalid_grant":
			if form.Get("grant_type") == "refresh_token" {
				return nil, errYTExpired
			}
			return nil, errors.New("The login code was refused. Please try linking again.")
		case "":
			return nil, fmt.Errorf("Google login failed (HTTP %d).", resp.StatusCode)
		}
		return nil, fmt.Errorf("Google login failed (%s).", t.Error)
	}
	return &t, nil
}

var errYTExpired = errors.New("Your YouTube Music link has expired. Please link it again.")

func ytAccess() (string, error) {
	ytMu.Lock()
	defer ytMu.Unlock()
	if yt.RefreshToken == "" {
		return "", errors.New("YouTube Music isn't linked")
	}
	if yt.AccessToken != "" && time.Now().Before(yt.Expiry) {
		return yt.AccessToken, nil
	}
	form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {yt.RefreshToken}, "client_id": {yt.ClientID}, "client_secret": {yt.ClientSecret}}
	ytMu.Unlock()
	t, err := ytTokenRequest(form)
	ytMu.Lock()
	if err != nil {
		if err == errYTExpired {
			yt = ytTokens{ClientID: yt.ClientID, ClientSecret: yt.ClientSecret}
			ytLastError = err.Error()
			ytSave()
		}
		return "", err
	}
	yt.AccessToken = t.AccessToken
	yt.Expiry = time.Now().Add(time.Duration(t.ExpiresIn-60) * time.Second)
	ytSave()
	return yt.AccessToken, nil
}

func ytDo(method, path string) ([]byte, int, error) {
	for attempt := 0; attempt < 2; attempt++ {
		tok, err := ytAccess()
		if err != nil {
			return nil, 401, err
		}
		req, _ := http.NewRequest(method, ytAPI+path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		resp, err := httpc.Do(req)
		if err != nil {
			return nil, 502, errors.New("Couldn't reach YouTube. Check your internet connection.")
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
		resp.Body.Close()
		if resp.StatusCode == 401 && attempt == 0 {
			ytMu.Lock()
			yt.AccessToken = ""
			ytMu.Unlock()
			continue
		}
		return b, resp.StatusCode, nil
	}
	return nil, 401, errYTExpired
}

func ytErrorText(b []byte, status int) string {
	var e struct {
		Error struct {
			Message string `json:"message"`
			Errors  []struct {
				Reason string `json:"reason"`
			} `json:"errors"`
		} `json:"error"`
	}
	json.Unmarshal(b, &e)
	reason := ""
	if len(e.Error.Errors) > 0 {
		reason = e.Error.Errors[0].Reason
	}
	switch reason {
	case "accessNotConfigured", "SERVICE_DISABLED":
		return "The YouTube Data API isn't turned on for your Google Cloud project. Open APIs & Services → Library → “YouTube Data API v3” → Enable, then try again."
	case "quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded":
		return "YouTube's daily limit for your project has been reached (searches use the most). It resets at midnight Pacific time."
	case "playlistNotFound":
		return "That playlist couldn't be found."
	}
	if e.Error.Message != "" {
		return "YouTube: " + e.Error.Message
	}
	return fmt.Sprintf("YouTube error (HTTP %d)", status)
}

// /api/youtube/v3/... → https://www.googleapis.com/youtube/v3/...  (GET only)
func ytProxy(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/youtube")
	if !strings.HasPrefix(path, "/v3/") || !(r.Method == "GET" || (r.Method == "DELETE" && strings.HasPrefix(path, "/v3/playlists"))) {
		http.NotFound(w, r)
		return
	}
	path = "/youtube" + path
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	b, status, err := ytDo(r.Method, path)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	if status == 403 && strings.Contains(string(b), "insufficient") {
		http.Error(w, "Nagham needs permission to change your YouTube playlists. Unlink and link YouTube Music again to allow it.", 403)
		return
	}
	if status >= 400 {
		http.Error(w, ytErrorText(b, status), status)
		return
	}
	if len(b) == 0 {
		b = []byte("{}")
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}
