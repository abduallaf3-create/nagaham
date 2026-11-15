package main

// Spotify Web API integration using OAuth 2.0 Authorization Code with PKCE.
// No client secret is used or stored anywhere: PKCE replaces it. The user's
// own Client ID (from developer.spotify.com) is saved in the data folder.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
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
)

const (
	spRedirectURI = "http://127.0.0.1:8888/callback"
	spScopes      = "user-read-private user-read-email playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-library-read user-top-read user-read-recently-played streaming user-read-playback-state user-modify-playback-state"
)

var (
	spAccounts = envOr("NAGHAM_SP_ACCOUNTS", "https://accounts.spotify.com")
	spAPI      = envOr("NAGHAM_SP_API", "https://api.spotify.com")
	spCallback = envOr("NAGHAM_SP_CALLBACK_ADDR", "127.0.0.1:8888")
	clientIDRe = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)
)

type spTokens struct {
	ClientID     string          `json:"clientId"`
	AccessToken  string          `json:"accessToken,omitempty"`
	RefreshToken string          `json:"refreshToken,omitempty"`
	Expiry       time.Time       `json:"expiry,omitempty"`
	Scope        string          `json:"scope,omitempty"`
	User         json.RawMessage `json:"user,omitempty"`
}

type spLogin struct {
	verifier, state string
	started         time.Time
}

var (
	spMu        sync.Mutex
	sp          spTokens
	spPending   *spLogin
	spLastError string
	spListening bool
)

func spFile() string { return filepath.Join(dataDir, "spotify.json") }

func spLoad() {
	if b, err := os.ReadFile(spFile()); err == nil {
		json.Unmarshal(b, &sp)
	}
}

// spSave must be called with spMu held.
func spSave() {
	b, _ := json.MarshalIndent(sp, "", "  ")
	os.WriteFile(spFile(), b, 0o600)
}

func randB64(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// ---------------- status / config ----------------

func spStatus(w http.ResponseWriter, r *http.Request) {
	spMu.Lock()
	defer spMu.Unlock()
	resp := map[string]any{
		"configured":  sp.ClientID != "",
		"clientId":    sp.ClientID,
		"connected":   sp.RefreshToken != "",
		"user":        sp.User,
		"error":       spLastError,
		"pending":     spPending != nil && time.Since(spPending.started) < 10*time.Minute,
		"redirectUri": spRedirectURI,
		"scope":       sp.Scope,
	}
	writeJSON(w, resp)
}

func spConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClientID string `json:"clientId"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	id := strings.TrimSpace(req.ClientID)
	if !clientIDRe.MatchString(id) {
		http.Error(w, "That doesn't look like a Spotify Client ID. It should be 32 letters and numbers, copied from your app's Settings page on developer.spotify.com.", 400)
		return
	}
	spMu.Lock()
	if sp.ClientID != id { // a different app: old tokens are useless
		sp = spTokens{ClientID: id}
	}
	spLastError = ""
	spSave()
	spMu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

func spLogout(w http.ResponseWriter, r *http.Request) {
	spMu.Lock()
	sp = spTokens{ClientID: sp.ClientID}
	spPending = nil
	spLastError = ""
	spSave()
	spMu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

// ---------------- login ----------------

func ensureCallbackServer() error {
	spMu.Lock()
	if spListening {
		spMu.Unlock()
		return nil
	}
	spMu.Unlock()
	ln, err := net.Listen("tcp", spCallback)
	if err != nil {
		return fmt.Errorf("Nagham needs port 8888 on this computer to finish the Spotify login, but another program is using it. Close that program (or restart your PC) and try again.")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", spCallbackHandler)
	mux.HandleFunc("/ytcallback", ytCallbackHandler)
	go http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Host
		if i := strings.LastIndexByte(h, ':'); i >= 0 {
			h = h[:i]
		}
		if h != "127.0.0.1" && h != "localhost" {
			http.Error(w, "forbidden", 403)
			return
		}
		mux.ServeHTTP(w, r)
	}))
	spMu.Lock()
	spListening = true
	spMu.Unlock()
	return nil
}

func spLoginStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Browser bool `json:"browser"` // open in the system browser instead of a popup
	}
	json.NewDecoder(r.Body).Decode(&req)
	spMu.Lock()
	id := sp.ClientID
	spMu.Unlock()
	if id == "" {
		http.Error(w, "Add your Spotify Client ID first.", 400)
		return
	}
	if err := ensureCallbackServer(); err != nil {
		spMu.Lock()
		spLastError = err.Error()
		spMu.Unlock()
		http.Error(w, err.Error(), 409)
		return
	}
	verifier := randB64(64)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	state := randB64(24)
	spMu.Lock()
	spPending = &spLogin{verifier: verifier, state: state, started: time.Now()}
	spLastError = ""
	spMu.Unlock()
	q := url.Values{
		"client_id":             {id},
		"response_type":         {"code"},
		"redirect_uri":          {spRedirectURI},
		"code_challenge_method": {"S256"},
		"code_challenge":        {challenge},
		"state":                 {state},
		"scope":                 {spScopes},
		"show_dialog":           {"true"},
	}
	authURL := spAccounts + "/authorize?" + q.Encode()
	if req.Browser {
		openExternal(authURL)
	}
	writeJSON(w, map[string]any{"url": authURL})
}

func spFail(msg string) {
	spMu.Lock()
	spLastError = msg
	spPending = nil
	spMu.Unlock()
	log.Println("spotify login:", msg)
}

func spCallbackHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	spMu.Lock()
	pend := spPending
	spMu.Unlock()
	if e := q.Get("error"); e != "" {
		msg := "Spotify login failed: " + e
		if e == "access_denied" {
			msg = "You cancelled the Spotify login. Click Connect to try again."
		}
		spFail(msg)
		callbackPage(w, false, msg)
		return
	}
	if pend == nil || time.Since(pend.started) > 10*time.Minute {
		msg := "This login link has expired. Go back to Nagham and click Connect again."
		spFail(msg)
		callbackPage(w, false, msg)
		return
	}
	if q.Get("state") != pend.state {
		msg := "Security check failed (the login response didn't match). Please try connecting again."
		spFail(msg)
		callbackPage(w, false, msg)
		return
	}
	code := q.Get("code")
	if code == "" {
		msg := "Spotify didn't send a login code. Please try again."
		spFail(msg)
		callbackPage(w, false, msg)
		return
	}
	spMu.Lock()
	clientID := sp.ClientID
	spMu.Unlock()
	tok, err := spTokenRequest(url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {spRedirectURI},
		"client_id":     {clientID},
		"code_verifier": {pend.verifier},
	})
	if err != nil {
		spFail(err.Error())
		callbackPage(w, false, err.Error())
		return
	}
	spMu.Lock()
	sp.AccessToken, sp.RefreshToken, sp.Scope = tok.AccessToken, tok.RefreshToken, tok.Scope
	sp.Expiry = time.Now().Add(time.Duration(tok.ExpiresIn-60) * time.Second)
	spPending = nil
	spLastError = ""
	spSave()
	spMu.Unlock()
	// who is this?
	if b, status, err := spDo("GET", "/v1/me", nil); err == nil && status == 200 {
		spMu.Lock()
		sp.User = b
		spSave()
		spMu.Unlock()
	} else if status == 403 {
		msg := "Spotify blocked this account for your app. In developer.spotify.com, open your app → User Management and add this account's email, then connect again."
		spMu.Lock()
		sp = spTokens{ClientID: clientID}
		spLastError = msg
		spSave()
		spMu.Unlock()
		callbackPage(w, false, msg)
		return
	}
	callbackPage(w, true, "")
}

type tokenResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

func spTokenRequest(form url.Values) (*tokenResp, error) {
	req, _ := http.NewRequest("POST", spAccounts+"/api/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, errors.New("Couldn't reach Spotify. Check your internet connection and try again.")
	}
	defer resp.Body.Close()
	var t tokenResp
	json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&t)
	if resp.StatusCode != 200 || t.AccessToken == "" {
		switch {
		case t.Error == "invalid_client":
			return nil, errors.New("Spotify rejected the Client ID. Check that you copied it correctly from your app's Settings page.")
		case t.Error == "invalid_grant" && strings.Contains(strings.ToLower(t.ErrorDesc), "redirect"):
			return nil, errors.New("The Redirect URI doesn't match. In your Spotify app settings, add exactly: " + spRedirectURI)
		case t.Error == "invalid_grant" && form.Get("grant_type") == "refresh_token":
			return nil, errSessionExpired
		case t.Error != "":
			return nil, fmt.Errorf("Spotify login failed (%s%s).", t.Error, map[bool]string{true: ": " + t.ErrorDesc, false: ""}[t.ErrorDesc != ""])
		}
		return nil, fmt.Errorf("Spotify login failed (HTTP %d).", resp.StatusCode)
	}
	return &t, nil
}

var errSessionExpired = errors.New("Your Spotify session has expired. Please connect again.")

// spAccess returns a valid access token, refreshing it when needed.
func spAccess() (string, error) {
	spMu.Lock()
	defer spMu.Unlock()
	if sp.RefreshToken == "" {
		return "", errors.New("not connected to Spotify")
	}
	if sp.AccessToken != "" && time.Now().Before(sp.Expiry) {
		return sp.AccessToken, nil
	}
	clientID, refresh := sp.ClientID, sp.RefreshToken
	spMu.Unlock()
	t, err := spTokenRequest(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {clientID}})
	spMu.Lock()
	if err != nil {
		if err == errSessionExpired {
			sp = spTokens{ClientID: clientID}
			spLastError = err.Error()
			spSave()
		}
		return "", err
	}
	sp.AccessToken = t.AccessToken
	if t.RefreshToken != "" {
		sp.RefreshToken = t.RefreshToken
	}
	sp.Expiry = time.Now().Add(time.Duration(t.ExpiresIn-60) * time.Second)
	spSave()
	return sp.AccessToken, nil
}

func spDo(method, path string, body io.Reader) ([]byte, int, error) {
	for attempt := 0; attempt < 2; attempt++ {
		tok, err := spAccess()
		if err != nil {
			return nil, 401, err
		}
		var rd io.Reader
		var bodyBytes []byte
		if body != nil {
			bodyBytes, _ = io.ReadAll(io.LimitReader(body, 1<<20))
			rd = strings.NewReader(string(bodyBytes))
			body = strings.NewReader(string(bodyBytes))
		}
		req, _ := http.NewRequest(method, spAPI+path, rd)
		req.Header.Set("Authorization", "Bearer "+tok)
		if rd != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := httpc.Do(req)
		if err != nil {
			return nil, 502, errors.New("Couldn't reach Spotify. Check your internet connection.")
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
		resp.Body.Close()
		if resp.StatusCode == 401 && attempt == 0 { // token revoked/expired early
			spMu.Lock()
			sp.AccessToken = ""
			spMu.Unlock()
			continue
		}
		return b, resp.StatusCode, nil
	}
	return nil, 401, errSessionExpired
}

// /api/spotify/v1/... → https://api.spotify.com/v1/...
func spProxy(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/spotify")
	if !strings.HasPrefix(path, "/v1/") {
		http.NotFound(w, r)
		return
	}
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	var body io.Reader
	if r.Method == "PUT" || r.Method == "POST" {
		body = r.Body
	}
	if r.Method == "DELETE" && !strings.HasSuffix(strings.SplitN(path, "?", 2)[0], "/followers") {
		http.Error(w, "not allowed", 403)
		return
	}
	b, status, err := spDo(r.Method, path, body)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	if status >= 400 {
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		json.Unmarshal(b, &e)
		msg := e.Error.Message
		switch {
		case status == 403 && strings.Contains(strings.ToLower(msg), "registered"):
			msg = "This Spotify account isn't allowed to use your app yet. In developer.spotify.com → your app → User Management, add the account's email."
		case status == 403 && strings.Contains(strings.ToLower(msg), "scope"):
			msg = "Nagham needs permission to change your Spotify playlists. Unlink and link Spotify again to allow it."
		case status == 403 && strings.Contains(strings.ToLower(msg), "premium"):
			msg = "This needs Spotify Premium."
		case status == 404:
			msg = "Spotify couldn't find that (some Spotify-made playlists aren't available to apps)."
		case status == 429:
			msg = "Spotify says we're asking too fast. Wait a minute and try again."
		case msg == "":
			msg = fmt.Sprintf("Spotify error (HTTP %d)", status)
		}
		http.Error(w, msg, status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if len(b) == 0 {
		b = []byte("{}")
	}
	w.WriteHeader(status)
	w.Write(b)
}

// /api/spotify/token → short-lived access token for the in-app Web Playback SDK
func spToken(w http.ResponseWriter, r *http.Request) {
	tok, err := spAccess()
	if err != nil {
		http.Error(w, err.Error(), 401)
		return
	}
	spMu.Lock()
	exp := int(time.Until(sp.Expiry).Seconds())
	spMu.Unlock()
	writeJSON(w, map[string]any{"accessToken": tok, "expiresIn": exp})
}

func callbackPage(w http.ResponseWriter, ok bool, msg string) { callbackPageFor(w, "Spotify", ok, msg) }

func callbackPageFor(w http.ResponseWriter, service string, ok bool, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	title, body, color := "Linked to "+service, "You can close this window and go back to Nagham.", "#1ed760"
	if service != "Spotify" {
		color = "#ff4e45"
	}
	if !ok {
		title, body, color = "Couldn't connect", html.EscapeString(msg), "#ff5c7a"
	}
	fmt.Fprintf(w, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nagham – Spotify</title><meta name="theme-color" content="#160b2e">
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(900px 600px at 10%% -10%%,rgba(169,112,255,.35),transparent 60%%),linear-gradient(160deg,#160b2e,#05030b);color:#fff;font-family:"Segoe UI",system-ui,sans-serif}
.c{text-align:center;max-width:440px;padding:40px;border-radius:24px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(20px);animation:in .5s cubic-bezier(.2,.8,.2,1)}
@keyframes in{from{opacity:0;transform:translateY(12px) scale(.98)}}
.i{width:72px;height:72px;border-radius:50%%;margin:0 auto 18px;display:grid;place-items:center;background:%s;color:#000;font-size:38px;font-weight:900;box-shadow:0 10px 40px %s66}
h1{margin:0 0 10px;font-size:26px}p{margin:0;opacity:.8;line-height:1.5}</style></head>
<body><div class="c"><div class="i">%s</div><h1>%s</h1><p>%s</p></div>
<script>%s</script></body></html>`, color, color, map[bool]string{true: "✓", false: "!"}[ok], title, body,
		map[bool]string{true: "setTimeout(function(){window.close()},1600)", false: ""}[ok])
}
