package main

// Online catalogue: Deezer + Apple (30-second previews of almost every released
// song, including new releases) and Audius (full-length, free tracks).
// Everything is proxied through this local server so the UI never deals with
// CORS, and responses are normalised to one Track shape.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const audiusApp = "Nagham"

type OTrack struct {
	ID         string  `json:"id"` // "dz:123" | "it:123" | "au:abc"
	Src        string  `json:"src"`
	Title      string  `json:"title"`
	Artist     string  `json:"artist"`
	ArtistID   string  `json:"artistId,omitempty"`
	Album      string  `json:"album"`
	AlbumID    string  `json:"albumId,omitempty"`
	Cover      string  `json:"cover,omitempty"`
	CoverSmall string  `json:"coverSmall,omitempty"`
	Duration   float64 `json:"duration"`     // length of what will actually play
	FullLength float64 `json:"fullDuration"` // length of the real song
	Full       bool    `json:"full"`         // true when the whole song plays
	Online     bool    `json:"online"`
}

type OAlbum struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Cover    string `json:"cover"`
	Release  string `json:"release,omitempty"`
	Type     string `json:"type,omitempty"`   // album | single | ep | compile
	Tracks   int    `json:"tracks,omitempty"` // number of songs
	ArtistID string `json:"artistId,omitempty"`
}

type OArtist struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
	Fans    int    `json:"fans,omitempty"`
}

var (
	httpc = &http.Client{Timeout: 15 * time.Second}

	cacheMu sync.Mutex
	cache   = map[string]cacheEntry{}

	apiBase = map[string]string{ // overridable for testing
		"deezer":   envOr("NAGHAM_DEEZER", "https://api.deezer.com"),
		"itunes":   envOr("NAGHAM_ITUNES", "https://itunes.apple.com"),
		"applerss": envOr("NAGHAM_APPLERSS", "https://rss.applemarketingtools.com"),
		"audius":   envOr("NAGHAM_AUDIUS", "https://api.audius.co"),
	}
)

type cacheEntry struct {
	at   time.Time
	body []byte
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func fetchJSON(u string, ttl time.Duration, v any) error {
	cacheMu.Lock()
	if e, ok := cache[u]; ok && time.Since(e.at) < ttl {
		cacheMu.Unlock()
		return json.Unmarshal(e.body, v)
	}
	cacheMu.Unlock()
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("User-Agent", "Nagham/2.0 (desktop music player)")
	req.Header.Set("Accept", "application/json")
	resp, err := httpc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("%s: HTTP %d", u, resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return err
	}
	if ttl > 0 {
		cacheMu.Lock()
		if len(cache) > 500 {
			cache = map[string]cacheEntry{}
		}
		cache[u] = cacheEntry{time.Now(), b}
		cacheMu.Unlock()
	}
	return nil
}

// ---------------- Deezer ----------------

type dzTrack struct {
	ID       json.Number `json:"id"`
	Title    string      `json:"title"`
	Duration float64     `json:"duration"`
	Preview  string      `json:"preview"`
	Readable *bool       `json:"readable"`
	Artist   struct {
		ID   json.Number `json:"id"`
		Name string      `json:"name"`
	} `json:"artist"`
	Album struct {
		ID          json.Number `json:"id"`
		Title       string      `json:"title"`
		CoverMedium string      `json:"cover_medium"`
		CoverXL     string      `json:"cover_xl"`
	} `json:"album"`
}

type dzAlbum struct {
	ID          json.Number `json:"id"`
	Title       string      `json:"title"`
	CoverMedium string      `json:"cover_medium"`
	CoverXL     string      `json:"cover_xl"`
	ReleaseDate string      `json:"release_date"`
	RecordType  string      `json:"record_type"`
	NbTracks    int         `json:"nb_tracks"`
	Artist      struct {
		ID   json.Number `json:"id"`
		Name string      `json:"name"`
	} `json:"artist"`
	Tracks struct {
		Data []dzTrack `json:"data"`
	} `json:"tracks"`
}

type dzArtist struct {
	ID         json.Number `json:"id"`
	Name       string      `json:"name"`
	PictureXL  string      `json:"picture_xl"`
	PictureBig string      `json:"picture_big"`
	Fans       int         `json:"nb_fan"`
}

type dzErr struct {
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (t dzTrack) norm() OTrack {
	return OTrack{ID: "dz:" + t.ID.String(), Src: "dz", Title: t.Title, Artist: t.Artist.Name, ArtistID: "dz:" + t.Artist.ID.String(),
		Album: t.Album.Title, AlbumID: "dz:" + t.Album.ID.String(), Cover: t.Album.CoverXL, CoverSmall: t.Album.CoverMedium,
		Duration: 30, FullLength: t.Duration, Online: true}
}

func dzTracks(path string, ttl time.Duration) ([]OTrack, error) {
	var r struct {
		dzErr
		Data []dzTrack `json:"data"`
	}
	if err := fetchJSON(apiBase["deezer"]+path, ttl, &r); err != nil {
		return nil, err
	}
	if r.Error != nil {
		return nil, fmt.Errorf("deezer: %s", r.Error.Message)
	}
	out := make([]OTrack, 0, len(r.Data))
	for _, t := range r.Data {
		if t.Preview == "" || (t.Readable != nil && !*t.Readable) {
			continue
		}
		out = append(out, t.norm())
	}
	return out, nil
}

// ---------------- Apple / iTunes ----------------

type itTrack struct {
	TrackID        int64   `json:"trackId"`
	TrackName      string  `json:"trackName"`
	ArtistName     string  `json:"artistName"`
	CollectionName string  `json:"collectionName"`
	CollectionID   int64   `json:"collectionId"`
	Artwork        string  `json:"artworkUrl100"`
	PreviewURL     string  `json:"previewUrl"`
	Millis         float64 `json:"trackTimeMillis"`
	Kind           string  `json:"kind"`
}

func (t itTrack) norm() OTrack {
	big := strings.Replace(t.Artwork, "100x100bb", "600x600bb", 1)
	return OTrack{ID: "it:" + strconv.FormatInt(t.TrackID, 10), Src: "it", Title: t.TrackName, Artist: t.ArtistName,
		Album: t.CollectionName, AlbumID: "it:" + strconv.FormatInt(t.CollectionID, 10), Cover: big, CoverSmall: t.Artwork,
		Duration: 30, FullLength: t.Millis / 1000, Online: true}
}

func itResults(u string, ttl time.Duration) ([]OTrack, error) {
	var r struct {
		Results []itTrack `json:"results"`
	}
	if err := fetchJSON(u, ttl, &r); err != nil {
		return nil, err
	}
	out := []OTrack{}
	for _, t := range r.Results {
		if t.PreviewURL != "" && t.TrackID != 0 {
			out = append(out, t.norm())
		}
	}
	return out, nil
}

// ---------------- Audius ----------------

type auTrack struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Duration float64 `json:"duration"`
	User     struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"user"`
	Artwork map[string]any `json:"artwork"`
	Genre   string         `json:"genre"`
}

func (t auTrack) norm() OTrack {
	art := func(k string) string {
		if s, ok := t.Artwork[k].(string); ok {
			return s
		}
		return ""
	}
	return OTrack{ID: "au:" + t.ID, Src: "au", Title: t.Title, Artist: t.User.Name, ArtistID: "au:" + t.User.ID,
		Album: "Audius", Cover: firstNonEmpty(art("1000x1000"), art("480x480")), CoverSmall: firstNonEmpty(art("150x150"), art("480x480")),
		Duration: t.Duration, FullLength: t.Duration, Full: true, Online: true}
}

func firstNonEmpty(s ...string) string {
	for _, x := range s {
		if x != "" {
			return x
		}
	}
	return ""
}

func auTracks(path string, ttl time.Duration) ([]OTrack, error) {
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	var r struct {
		Data []auTrack `json:"data"`
	}
	if err := fetchJSON(apiBase["audius"]+"/v1"+path+sep+"app_name="+audiusApp, ttl, &r); err != nil {
		return nil, err
	}
	out := make([]OTrack, 0, len(r.Data))
	for _, t := range r.Data {
		if t.ID != "" {
			out = append(out, t.norm())
		}
	}
	return out, nil
}

// ---------------- handlers ----------------

func country(r *http.Request) string {
	c := strings.ToLower(r.URL.Query().Get("country"))
	if len(c) != 2 {
		c = "sa"
	}
	return c
}

func onlineSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, map[string]any{})
		return
	}
	qe := url.QueryEscape(q)
	cc := country(r)
	var wg sync.WaitGroup
	var mu sync.Mutex
	res := map[string]any{}
	errs := []string{}
	run := func(key string, f func() (any, error)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, err := f()
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err.Error())
				return
			}
			res[key] = v
		}()
	}
	run("tracks", func() (any, error) {
		t, err := dzTracks("/search?limit=40&q="+qe, 10*time.Minute)
		if err != nil || len(t) == 0 { // fall back to Apple
			t2, err2 := itResults(apiBase["itunes"]+"/search?media=music&entity=song&limit=40&country="+cc+"&term="+qe, 10*time.Minute)
			if err2 == nil {
				return t2, nil
			}
			if err == nil {
				err = err2
			}
		}
		return t, err
	})
	run("artists", func() (any, error) {
		var a struct {
			Data []dzArtist `json:"data"`
		}
		if err := fetchJSON(apiBase["deezer"]+"/search/artist?limit=12&q="+qe, 10*time.Minute, &a); err != nil {
			return nil, err
		}
		out := []OArtist{}
		for _, x := range a.Data {
			out = append(out, OArtist{ID: "dz:" + x.ID.String(), Name: x.Name, Picture: firstNonEmpty(x.PictureXL, x.PictureBig), Fans: x.Fans})
		}
		return out, nil
	})
	run("albums", func() (any, error) {
		var a struct {
			Data []dzAlbum `json:"data"`
		}
		if err := fetchJSON(apiBase["deezer"]+"/search/album?limit=12&q="+qe, 10*time.Minute, &a); err != nil {
			return nil, err
		}
		return normAlbums(a.Data), nil
	})
	run("full", func() (any, error) { return auTracks("/tracks/search?query="+qe, 10*time.Minute) })
	wg.Wait()
	res["errors"] = errs
	writeJSON(w, res)
}

func normAlbums(in []dzAlbum) []OAlbum {
	out := []OAlbum{}
	for _, x := range in {
		out = append(out, OAlbum{ID: "dz:" + x.ID.String(), Title: x.Title, Artist: x.Artist.Name, Cover: x.CoverXL, Release: x.ReleaseDate, Type: x.RecordType, Tracks: x.NbTracks})
	}
	return out
}

func onlineHome(w http.ResponseWriter, r *http.Request) {
	cc := country(r)
	var wg sync.WaitGroup
	var mu sync.Mutex
	res := map[string]any{}
	set := func(k string, v any) { mu.Lock(); res[k] = v; mu.Unlock() }
	wg.Add(4)
	go func() { // worldwide chart
		defer wg.Done()
		if t, err := dzTracks("/chart/0/tracks?limit=50", 30*time.Minute); err == nil {
			set("chart", t)
		}
	}()
	go func() { // brand-new albums
		defer wg.Done()
		var a struct {
			Data []dzAlbum `json:"data"`
		}
		if fetchJSON(apiBase["deezer"]+"/editorial/0/releases?limit=30", 30*time.Minute, &a) == nil {
			set("releases", normAlbums(a.Data))
		}
	}()
	go func() { // top songs in the user's country (Apple Music chart)
		defer wg.Done()
		var feed struct {
			Feed struct {
				Results []struct {
					ID string `json:"id"`
				} `json:"results"`
			} `json:"feed"`
		}
		if fetchJSON(apiBase["applerss"]+"/api/v2/"+cc+"/music/most-played/40/songs.json", time.Hour, &feed) != nil {
			return
		}
		ids := []string{}
		for _, x := range feed.Feed.Results {
			ids = append(ids, x.ID)
		}
		if len(ids) == 0 {
			return
		}
		t, err := itResults(apiBase["itunes"]+"/lookup?entity=song&country="+cc+"&id="+strings.Join(ids, ","), time.Hour)
		if err != nil {
			return
		}
		// keep chart order
		pos := map[string]int{}
		for i, id := range ids {
			pos["it:"+id] = i
		}
		sorted := make([]OTrack, len(t))
		copy(sorted, t)
		for i := 0; i < len(sorted); i++ {
			for j := i + 1; j < len(sorted); j++ {
				if pos[sorted[j].ID] < pos[sorted[i].ID] {
					sorted[i], sorted[j] = sorted[j], sorted[i]
				}
			}
		}
		set("local", sorted)
	}()
	go func() { // full-length trending (Audius)
		defer wg.Done()
		if t, err := auTracks("/tracks/trending?limit=30", 30*time.Minute); err == nil {
			set("full", t)
		}
	}()
	wg.Wait()
	writeJSON(w, res)
}

func splitID(id string) (string, string) {
	if i := strings.IndexByte(id, ':'); i > 0 {
		return id[:i], id[i+1:]
	}
	return "", id
}

func onlineAlbum(w http.ResponseWriter, r *http.Request) {
	src, id := splitID(r.URL.Query().Get("id"))
	switch src {
	case "dz":
		var a struct {
			dzErr
			dzAlbum
		}
		if err := fetchJSON(apiBase["deezer"]+"/album/"+url.PathEscape(id), time.Hour, &a); err != nil || a.Error != nil {
			http.Error(w, "album not found", 404)
			return
		}
		tr := []OTrack{}
		for _, t := range a.Tracks.Data {
			if t.Preview == "" {
				continue
			}
			t.Album.ID, t.Album.Title, t.Album.CoverXL, t.Album.CoverMedium = a.ID, a.Title, a.CoverXL, a.CoverMedium
			tr = append(tr, t.norm())
		}
		writeJSON(w, map[string]any{"album": OAlbum{ID: "dz:" + a.ID.String(), Title: a.Title, Artist: a.Artist.Name, Cover: a.CoverXL, Release: a.ReleaseDate}, "artistId": "dz:" + a.Artist.ID.String(), "tracks": tr})
	case "it":
		t, err := itResults(apiBase["itunes"]+"/lookup?entity=song&country="+country(r)+"&id="+url.QueryEscape(id), time.Hour)
		if err != nil || len(t) == 0 {
			http.Error(w, "album not found", 404)
			return
		}
		writeJSON(w, map[string]any{"album": OAlbum{ID: "it:" + id, Title: t[0].Album, Artist: t[0].Artist, Cover: t[0].Cover}, "tracks": t})
	default:
		http.Error(w, "unknown source", 400)
	}
}

func onlineArtist(w http.ResponseWriter, r *http.Request) {
	src, id := splitID(r.URL.Query().Get("id"))
	switch src {
	case "dz":
		var a struct {
			dzErr
			dzArtist
		}
		if err := fetchJSON(apiBase["deezer"]+"/artist/"+url.PathEscape(id), time.Hour, &a); err != nil || a.Error != nil {
			http.Error(w, "artist not found", 404)
			return
		}
		top, _ := dzTracks("/artist/"+url.PathEscape(id)+"/top?limit=50", time.Hour)
		al := dzArtistAlbums(id) // every album, single and EP, newest first
		for i := range al {
			al[i].Artist.Name = a.Name
		}
		writeJSON(w, map[string]any{"artist": OArtist{ID: "dz:" + a.ID.String(), Name: a.Name, Picture: firstNonEmpty(a.PictureXL, a.PictureBig), Fans: a.Fans}, "tracks": top, "albums": normAlbums(al)})
	case "au":
		t, err := auTracks("/users/"+url.PathEscape(id)+"/tracks?limit=50", time.Hour)
		if err != nil {
			http.Error(w, "artist not found", 404)
			return
		}
		name := ""
		if len(t) > 0 {
			name = t[0].Artist
		}
		writeJSON(w, map[string]any{"artist": OArtist{ID: "au:" + id, Name: name}, "tracks": t, "albums": []OAlbum{}})
	default:
		http.Error(w, "unknown source", 400)
	}
}

// resolveTrack fetches up-to-date info (and the playable URL) for one track.
func resolveTrack(src, id, cc string) (OTrack, string, error) {
	switch src {
	case "dz":
		var t struct {
			dzErr
			dzTrack
		}
		// preview links are signed and expire, so cache only briefly
		if err := fetchJSON(apiBase["deezer"]+"/track/"+url.PathEscape(id), 5*time.Minute, &t); err != nil {
			return OTrack{}, "", err
		}
		if t.Error != nil || t.Preview == "" {
			return OTrack{}, "", fmt.Errorf("track unavailable")
		}
		return t.norm(), t.Preview, nil
	case "it":
		var r struct {
			Results []itTrack `json:"results"`
		}
		if err := fetchJSON(apiBase["itunes"]+"/lookup?country="+cc+"&id="+url.QueryEscape(id), time.Hour, &r); err != nil {
			return OTrack{}, "", err
		}
		for _, t := range r.Results {
			if t.PreviewURL != "" {
				return t.norm(), t.PreviewURL, nil
			}
		}
		return OTrack{}, "", fmt.Errorf("track unavailable")
	case "au":
		var r struct {
			Data auTrack `json:"data"`
		}
		err := fetchJSON(apiBase["audius"]+"/v1/tracks/"+url.PathEscape(id)+"?app_name="+audiusApp, time.Hour, &r)
		stream := apiBase["audius"] + "/v1/tracks/" + url.PathEscape(id) + "/stream?app_name=" + audiusApp
		if err != nil || r.Data.ID == "" {
			return OTrack{ID: "au:" + id, Src: "au", Full: true, Online: true}, stream, err
		}
		return r.Data.norm(), stream, nil
	}
	return OTrack{}, "", fmt.Errorf("unknown source")
}

func onlineTrack(w http.ResponseWriter, r *http.Request) {
	src, id := splitID(r.URL.Query().Get("id"))
	t, _, err := resolveTrack(src, id, country(r))
	if err != nil {
		http.Error(w, err.Error(), 404)
		return
	}
	writeJSON(w, t)
}

// /api/online/ytinfo?id=VIDEOID → title/channel/thumbnail via YouTube oEmbed (no key needed)
func ytInfo(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if len(id) < 6 || len(id) > 20 || strings.ContainsAny(id, "/?&#") {
		http.Error(w, "bad id", 400)
		return
	}
	var o struct {
		Title  string `json:"title"`
		Author string `json:"author_name"`
		Thumb  string `json:"thumbnail_url"`
	}
	u := envOr("NAGHAM_YT_OEMBED", "https://www.youtube.com/oembed") + "?format=json&url=" + url.QueryEscape("https://www.youtube.com/watch?v="+id)
	if err := fetchJSON(u, time.Hour, &o); err != nil || o.Title == "" {
		http.Error(w, "That YouTube video couldn't be found (it may be private or not allow playing in other apps).", 404)
		return
	}
	writeJSON(w, map[string]any{"id": id, "title": o.Title, "author": o.Author, "thumb": o.Thumb})
}

// /stream/{src}/{id} → redirect to the playable audio
func streamHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/stream/"), "/", 2)
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	_, u, err := resolveTrack(parts[0], parts[1], country(r))
	if u == "" {
		msg := "unavailable"
		if err != nil {
			msg = err.Error()
		}
		http.Error(w, msg, 404)
		return
	}
	proxyStream(w, r, u)
}

// /img?u=https://... → same-origin copy of a cover image (lets the UI read its colours)
func imgProxy(w http.ResponseWriter, r *http.Request) {
	u := r.URL.Query().Get("u")
	pu, err := url.Parse(u)
	if err != nil || (pu.Scheme != "https" && os.Getenv("NAGHAM_TEST") == "") || pu.Host == "" {
		http.Error(w, "bad url", 400)
		return
	}
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("User-Agent", "Nagham/2.0")
	resp, err := httpc.Do(req)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode != 200 || !strings.HasPrefix(ct, "image/") {
		http.Error(w, "not an image", 502)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "max-age=604800")
	io.Copy(w, io.LimitReader(resp.Body, 10<<20))
}
