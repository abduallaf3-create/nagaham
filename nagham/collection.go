package main

// Whole albums and playlists for the Download page: a link (Spotify, YouTube / YouTube Music, Deezer, Apple Music)
// or a search is turned into the list of its songs; the page then downloads them one by one (dlStart with a query).

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type colTrack struct {
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	N        int     `json:"n,omitempty"`
	URL      string  `json:"url,omitempty"` // a YouTube video: downloaded straight from it, no searching
	Cover    string  `json:"cover,omitempty"`
}

type colInfo struct {
	Kind   string     `json:"kind"`   // album | playlist
	Source string     `json:"source"` // spotify | youtube | deezer | apple
	Title  string     `json:"title"`
	Artist string     `json:"artist,omitempty"` // album artist, or who made the playlist
	Cover  string     `json:"cover,omitempty"`
	Link   string     `json:"link,omitempty"`
	Tracks []colTrack `json:"tracks"`
	Note   string     `json:"note,omitempty"`
}

type colHit struct {
	Kind   string `json:"kind"`
	Source string `json:"source"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Cover  string `json:"cover"`
	Count  int    `json:"count,omitempty"`
	Year   string `json:"year,omitempty"`
	URL    string `json:"url"`
}

var (
	colSpRe     = regexp.MustCompile(`(?i)(?:open\.spotify\.com/(?:intl-[a-z-]+/)?(?:embed/)?(playlist|album)/|spotify:(playlist|album):)([A-Za-z0-9]{10,40})`)
	colDzRe     = regexp.MustCompile(`(?i)deezer\.com/(?:[a-z]{2}/)?(album|playlist)/(\d+)`)
	colAppleRe  = regexp.MustCompile(`(?i)music\.apple\.com/.*/album/[^/?#]*/?(\d+)`)
	colAppleRe2 = regexp.MustCompile(`(?i)music\.apple\.com/.*/album/(\d+)`)
	colYtRe     = regexp.MustCompile(`(?i)(?:youtube\.com|youtu\.be)/`)
	colNextRe   = regexp.MustCompile(`(?s)<script id="__NEXT_DATA__" type="application/json">(.*?)</script>`)
)

// GET /api/dl/expand?url=…  → the songs of an album or playlist
// GET /api/dl/expand?q=…    → albums and playlists matching a search
func dlExpand(w http.ResponseWriter, r *http.Request) {
	if !dlSameOrigin(w, r) {
		return
	}
	if q := strings.Join(strings.Fields(r.URL.Query().Get("q")), " "); q != "" {
		if len(q) > 300 {
			http.Error(w, "that search is too long", 400)
			return
		}
		writeJSON(w, map[string]any{"results": colSearch(r.Context(), q, r.URL.Query().Get("source") == "spotify")})
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	if raw == "" || len(raw) > 2000 {
		http.Error(w, "paste a link to an album or a playlist", 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	info, err := colResolve(ctx, raw, country(r))
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	if len(info.Tracks) == 0 {
		http.Error(w, "no songs found in that "+info.Kind, 404)
		return
	}
	writeJSON(w, info)
}

func colResolve(ctx context.Context, raw, cc string) (*colInfo, error) {
	if m := colSpRe.FindStringSubmatch(raw); m != nil {
		kind := strings.ToLower(m[1] + m[2])
		return colSpotify(ctx, kind, m[3])
	}
	if m := colDzRe.FindStringSubmatch(raw); m != nil {
		return colDeezer(strings.ToLower(m[1]), m[2])
	}
	if strings.Contains(strings.ToLower(raw), "music.apple.com") {
		if strings.Contains(raw, "/playlist/") {
			return nil, errors.New("Apple Music playlists can't be read — paste an album link, or a Spotify / YouTube playlist")
		}
		id := ""
		if m := colAppleRe.FindStringSubmatch(raw); m != nil {
			id = m[1]
		} else if m := colAppleRe2.FindStringSubmatch(raw); m != nil {
			id = m[1]
		}
		if id == "" {
			return nil, errors.New("couldn't read that Apple Music link")
		}
		return colApple(id, cc)
	}
	if colYtRe.MatchString(raw) {
		u, err := dlValidURL(raw)
		if err != nil {
			return nil, err
		}
		pu, _ := url.Parse(u)
		if pu.Query().Get("list") == "" && !strings.Contains(pu.Path, "/browse/") && !strings.Contains(pu.Path, "/playlist") && !strings.HasPrefix(pu.Path, "/@") && !strings.HasPrefix(pu.Path, "/channel/") {
			return nil, errors.New("that's a link to one song — paste it in the song search instead")
		}
		list := pu.Query().Get("list")
		if strings.HasPrefix(pu.Path, "/browse/VL") {
			list = strings.TrimPrefix(pu.Path, "/browse/VL")
		}
		info, err := colYouTube(ctx, u)
		if err != nil && list != "" && (list == "LM" || list == "LL" || strings.Contains(strings.ToLower(err.Error()), "private") || strings.Contains(strings.ToLower(err.Error()), "does not exist") || strings.Contains(strings.ToLower(err.Error()), "sign in")) {
			return nil, errors.New("this playlist is private — make it public or unlisted in YouTube Music, then paste the link again")
		}
		return info, err
	}
	return nil, errors.New("paste a link to a Spotify, YouTube Music, YouTube, Deezer or Apple Music album or playlist")
}

// ---------- Spotify: the public embed page (no account)
func colSpotify(ctx context.Context, kind, id string) (*colInfo, error) {
	return colSpotifyEmbed(ctx, kind, id, false)
}

type spAPITrack struct {
	Name    string  `json:"name"`
	Type    string  `json:"type"`
	DurMs   float64 `json:"duration_ms"`
	Number  int     `json:"track_number"`
	Artists []struct {
		Name string `json:"name"`
	} `json:"artists"`
	Album struct {
		Name   string `json:"name"`
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
	} `json:"album"`
}

// the public embed page (the "Spotify player" websites show) lists the songs without any account
func colSpotifyEmbed(ctx context.Context, kind, id string, linked bool) (*colInfo, error) {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(cctx, "GET", dlSpotifyWeb+"/embed/"+kind+"/"+id, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
	req.Header.Set("Accept-Language", "en")
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, errors.New("couldn't reach Spotify — check your internet")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		if linked {
			return nil, errors.New("Spotify says that " + kind + " doesn't exist, or your linked account can't open it")
		}
		return nil, errors.New("that " + kind + " is private (or doesn't exist) — private Spotify playlists need your account linked (Spotify page → box B), or make the playlist public in Spotify")
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	m := colNextRe.FindSubmatch(body)
	if m == nil {
		return nil, errors.New("couldn't read that Spotify " + kind + " — if it's private, make it public or link your Spotify account")
	}
	var nd struct {
		Props struct {
			PageProps struct {
				State struct {
					Data struct {
						Entity struct {
							Type     string `json:"type"`
							Name     string `json:"name"`
							Title    string `json:"title"`
							Subtitle string `json:"subtitle"`
							CoverArt struct {
								Sources []struct {
									URL   string `json:"url"`
									Width int    `json:"width"`
								} `json:"sources"`
							} `json:"coverArt"`
							Visual struct {
								Image []struct {
									URL      string `json:"url"`
									MaxWidth int    `json:"maxWidth"`
								} `json:"image"`
							} `json:"visualIdentity"`
							TrackList []struct {
								URI      string  `json:"uri"`
								Title    string  `json:"title"`
								Subtitle string  `json:"subtitle"`
								Duration float64 `json:"duration"`
							} `json:"trackList"`
						} `json:"entity"`
					} `json:"data"`
				} `json:"state"`
			} `json:"pageProps"`
		} `json:"props"`
	}
	if err := json.Unmarshal(m[1], &nd); err != nil {
		return nil, errors.New("couldn't read that Spotify " + kind)
	}
	e := nd.Props.PageProps.State.Data.Entity
	info := &colInfo{Kind: kind, Source: "spotify", Title: html.UnescapeString(firstNonEmpty(e.Name, e.Title)), Artist: e.Subtitle, Link: "https://open.spotify.com/" + kind + "/" + id}
	best := 0
	for _, s := range e.CoverArt.Sources {
		if info.Cover == "" || s.Width > best {
			info.Cover, best = s.URL, s.Width
		}
	}
	for _, s := range e.Visual.Image {
		if s.MaxWidth > best {
			info.Cover, best = s.URL, s.MaxWidth
		}
	}
	for i, t := range e.TrackList {
		if t.Title == "" || (t.URI != "" && !strings.HasPrefix(t.URI, "spotify:track:")) {
			continue
		}
		c := colTrack{Title: t.Title, Artist: t.Subtitle, Duration: t.Duration / 1000}
		if kind == "album" {
			c.Album, c.N, c.Cover = info.Title, i+1, info.Cover
		}
		info.Tracks = append(info.Tracks, c)
	}
	if kind == "playlist" && len(e.TrackList) >= 100 {
		if linked {
			info.Note = "Spotify only showed the first 100 songs of this playlist."
		} else {
			info.Note = "Without a linked Spotify account, Spotify only shows the first 100 songs of a playlist. Link your account (Spotify page) to get all of them."
		}
	}
	return info, nil
}

// ---------- Deezer (free catalogue, no account)
func colDeezer(kind, id string) (*colInfo, error) {
	info := &colInfo{Kind: kind, Source: "deezer", Link: "https://www.deezer.com/" + kind + "/" + id}
	var head struct {
		dzErr
		Title      string                `json:"title"`
		CoverXL    string                `json:"cover_xl"`
		PictureXL  string                `json:"picture_xl"`
		NbTracks   int                   `json:"nb_tracks"`
		Artist     struct{ Name string } `json:"artist"`
		Creator    struct{ Name string } `json:"creator"`
		ReleaseDay string                `json:"release_date"`
	}
	if err := fetchJSON(apiBase["deezer"]+"/"+kind+"/"+id, time.Hour, &head); err != nil || head.Error != nil || head.Title == "" {
		return nil, errors.New("couldn't find that " + kind + " on Deezer")
	}
	info.Title = head.Title
	info.Cover = firstNonEmpty(head.CoverXL, head.PictureXL)
	info.Artist = firstNonEmpty(head.Artist.Name, head.Creator.Name)
	next := apiBase["deezer"] + "/" + kind + "/" + id + "/tracks?limit=100&index=0"
	n := 0
	for guard := 0; next != "" && guard < 25 && len(info.Tracks) < 2000; guard++ {
		var page struct {
			dzErr
			Data []dzTrack `json:"data"`
			Next string    `json:"next"`
		}
		if err := fetchJSON(next, time.Hour, &page); err != nil || page.Error != nil {
			break
		}
		for _, t := range page.Data {
			n++
			c := colTrack{Title: t.Title, Artist: t.Artist.Name, Duration: t.Duration, Album: firstNonEmpty(t.Album.Title, info.Title), Cover: firstNonEmpty(t.Album.CoverXL, t.Album.CoverMedium)}
			if kind == "album" {
				c.Album, c.N, c.Cover = info.Title, n, info.Cover
			}
			info.Tracks = append(info.Tracks, c)
		}
		next = page.Next
		if next != "" && !strings.HasPrefix(next, apiBase["deezer"]) { // keep to the same server (tests point it elsewhere)
			if u, err := url.Parse(next); err == nil {
				next = apiBase["deezer"] + u.Path + "?" + u.RawQuery
			}
		}
	}
	return info, nil
}

// ---------- Apple Music albums (iTunes lookup)
func colApple(id, cc string) (*colInfo, error) {
	var res struct {
		Results []struct {
			WrapperType string  `json:"wrapperType"`
			Kind        string  `json:"kind"`
			Collection  string  `json:"collectionName"`
			Artist      string  `json:"artistName"`
			Track       string  `json:"trackName"`
			TimeMs      float64 `json:"trackTimeMillis"`
			Number      int     `json:"trackNumber"`
			Disc        int     `json:"discNumber"`
			Art         string  `json:"artworkUrl100"`
		} `json:"results"`
	}
	if err := fetchJSON(apiBase["itunes"]+"/lookup?entity=song&limit=200&country="+url.QueryEscape(cc)+"&id="+url.QueryEscape(id), time.Hour, &res); err != nil || len(res.Results) == 0 {
		return nil, errors.New("couldn't find that album on Apple Music")
	}
	info := &colInfo{Kind: "album", Source: "apple"}
	for _, x := range res.Results {
		if x.WrapperType == "collection" {
			info.Title, info.Artist = x.Collection, x.Artist
			info.Cover = strings.Replace(x.Art, "100x100", "600x600", 1)
			continue
		}
		if x.Kind != "song" || x.Track == "" {
			continue
		}
		if info.Title == "" {
			info.Title, info.Artist = x.Collection, x.Artist
		}
		info.Tracks = append(info.Tracks, colTrack{Title: x.Track, Artist: x.Artist, Album: x.Collection, Duration: x.TimeMs / 1000, N: x.Number, Cover: strings.Replace(x.Art, "100x100", "600x600", 1)})
	}
	if info.Cover == "" && len(info.Tracks) > 0 {
		info.Cover = info.Tracks[0].Cover
	}
	return info, nil
}

// ---------- YouTube / YouTube Music playlists and albums (yt-dlp reads the list, songs download straight from their videos)
func colYouTube(ctx context.Context, link string) (*colInfo, error) {
	ytdlp, err := dlEnsureYtdlp()
	if err != nil {
		return nil, errors.New("couldn't get the downloader (check your internet): " + err.Error())
	}
	cctx, cancel := context.WithTimeout(ctx, 80*time.Second)
	defer cancel()
	cmd := hidden(exec.CommandContext(cctx, ytdlp, "--flat-playlist", "-J", "--no-warnings", "--ignore-config", "--encoding", "utf-8", "--playlist-end", "1000", "--", link))
	cmd.Env = append(os.Environ(), "PATH="+dlToolsDir()+string(os.PathListSeparator)+os.Getenv("PATH"), "PYTHONIOENCODING=utf-8")
	out, err := cmd.Output()
	if err != nil {
		msg := "couldn't read that playlist"
		if ee, ok := err.(*exec.ExitError); ok {
			if l := dlLastError(strings.Split(strings.TrimSpace(string(ee.Stderr)), "\n")); l != "" {
				msg += ": " + l
			}
		}
		if cctx.Err() != nil {
			msg = "YouTube took too long to answer — try again"
		}
		return nil, errors.New(msg)
	}
	var v struct {
		Title    string `json:"title"`
		Channel  string `json:"channel"`
		Uploader string `json:"uploader"`
		Thumbs   []struct {
			URL   string `json:"url"`
			Width int    `json:"width"`
		} `json:"thumbnails"`
		Entries []struct {
			ID       string  `json:"id"`
			Title    string  `json:"title"`
			Channel  string  `json:"channel"`
			Uploader string  `json:"uploader"`
			Duration float64 `json:"duration"`
			Thumbs   []struct {
				URL string `json:"url"`
			} `json:"thumbnails"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return nil, errors.New("couldn't read that playlist")
	}
	clean := func(s string) string { return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), " - Topic")) }
	isAlbum := strings.HasPrefix(v.Title, "Album - ") || strings.Contains(link, "OLAK5uy_") || strings.Contains(link, "/browse/MPREb")
	title := strings.TrimPrefix(v.Title, "Album - ")
	info := &colInfo{Kind: "playlist", Source: "youtube", Title: title, Artist: clean(firstNonEmpty(v.Channel, v.Uploader)), Link: link}
	if isAlbum {
		info.Kind = "album"
	}
	bw := 0
	for _, t := range v.Thumbs {
		if t.Width >= bw {
			info.Cover, bw = t.URL, t.Width
		}
	}
	n := 0
	for _, e := range v.Entries {
		if e.ID == "" || e.Title == "" || e.Title == "[Private video]" || e.Title == "[Deleted video]" {
			continue
		}
		n++
		c := colTrack{Title: e.Title, Artist: clean(firstNonEmpty(e.Channel, e.Uploader)), Duration: e.Duration, URL: "https://music.youtube.com/watch?v=" + e.ID}
		if len(e.Thumbs) > 0 {
			c.Cover = e.Thumbs[len(e.Thumbs)-1].URL // shown in the list; the file gets YouTube's own picture, cut square
		}
		if info.Kind == "album" {
			c.Album, c.N = info.Title, n
			if c.Artist == "" {
				c.Artist = info.Artist
			}
		}
		info.Tracks = append(info.Tracks, c)
	}
	if info.Cover == "" && len(info.Tracks) > 0 {
		info.Cover = info.Tracks[0].Cover
	}
	return info, nil
}

// ---------- search: albums and playlists (Deezer's free catalogue)
func colSearch(ctx context.Context, q string, withSpotify bool) []colHit {
	qe := url.QueryEscape(q)
	var mu sync.Mutex
	var wg sync.WaitGroup
	var albums, pls []colHit
	wg.Add(2)
	go func() {
		defer wg.Done()
		var a struct {
			Data []struct {
				ID      json.Number           `json:"id"`
				Title   string                `json:"title"`
				CoverXL string                `json:"cover_xl"`
				CoverM  string                `json:"cover_medium"`
				Count   int                   `json:"nb_tracks"`
				Type    string                `json:"record_type"`
				Artist  struct{ Name string } `json:"artist"`
			} `json:"data"`
		}
		if fetchJSON(apiBase["deezer"]+"/search/album?limit=16&q="+qe, 10*time.Minute, &a) != nil {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		for _, x := range a.Data {
			albums = append(albums, colHit{Kind: "album", Source: "deezer", Title: x.Title, Artist: x.Artist.Name, Cover: firstNonEmpty(x.CoverXL, x.CoverM), Count: x.Count, URL: "https://www.deezer.com/album/" + x.ID.String()})
		}
	}()
	go func() {
		defer wg.Done()
		var a struct {
			Data []struct {
				ID        json.Number           `json:"id"`
				Title     string                `json:"title"`
				PictureXL string                `json:"picture_xl"`
				Count     int                   `json:"nb_tracks"`
				User      struct{ Name string } `json:"user"`
			} `json:"data"`
		}
		if fetchJSON(apiBase["deezer"]+"/search/playlist?limit=8&q="+qe, 10*time.Minute, &a) != nil {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		for _, x := range a.Data {
			pls = append(pls, colHit{Kind: "playlist", Source: "deezer", Title: x.Title, Artist: x.User.Name, Cover: x.PictureXL, Count: x.Count, URL: "https://www.deezer.com/playlist/" + x.ID.String()})
		}
	}()
	wg.Wait()
	out := []colHit{}
	out = append(out, albums...)
	out = append(out, pls...)
	return out
}

// ---------------------------------------------------------------- many songs at once

// POST /api/dl/batch  {batch, folder, format, songs:[{title,artist,album,duration,n,url}]}  → starts every song (2 at a time)
// GET  /api/dl/batch?id=…  → how every song of that batch is doing
// POST /api/dl/batch?id=…&cancel=1 → stops the rest
func dlBatch(w http.ResponseWriter, r *http.Request) {
	if !dlSameOrigin(w, r) {
		return
	}
	id := r.URL.Query().Get("id")
	if r.Method == "GET" {
		dlMu.Lock()
		jobs := []dlJob{}
		for _, k := range dlOrder {
			if j := dlJobs[k]; j != nil && j.Batch == id && id != "" {
				c := *j
				c.cancel, c.q = nil, nil
				jobs = append(jobs, c)
			}
		}
		dlMu.Unlock()
		writeJSON(w, map[string]any{"jobs": jobs})
		return
	}
	if r.Method != "POST" {
		http.Error(w, "GET or POST", 405)
		return
	}
	if r.URL.Query().Get("cancel") == "1" {
		dlMu.Lock()
		var stop []*dlJob
		for _, j := range dlJobs {
			if j.Batch == id && id != "" && j.cancel != nil && j.Status != "done" && j.Status != "error" {
				stop = append(stop, j)
			}
		}
		dlMu.Unlock()
		for _, j := range stop {
			dlSet(j, func(j *dlJob) { j.Status, j.Phase = "cancelled", "Cancelled" })
			j.cancel()
		}
		writeJSON(w, map[string]any{"ok": true, "stopped": len(stop)})
		return
	}
	var in struct {
		Batch  string     `json:"batch"`
		Folder string     `json:"folder"`
		Format string     `json:"format"`
		Songs  []colTrack `json:"songs"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&in); err != nil || len(in.Songs) == 0 {
		http.Error(w, "no songs to download", 400)
		return
	}
	if len(in.Songs) > 2000 {
		in.Songs = in.Songs[:2000]
	}
	if in.Batch == "" || len(in.Batch) > 40 {
		http.Error(w, "bad batch", 400)
		return
	}
	folder, err := dlSongsDir()
	if err != nil {
		http.Error(w, "couldn't prepare the songs folder: "+err.Error(), 500)
		return
	}
	if sub := dlFolderName(in.Folder); sub != "" {
		folder = filepath.Join(folder, sub)
	}
	ids := []string{}
	for _, s := range in.Songs {
		s.Title, s.Artist = strings.TrimSpace(s.Title), strings.TrimSpace(s.Artist)
		if s.Title == "" || len(s.Title)+len(s.Artist)+len(s.Album) > 900 {
			ids = append(ids, "")
			continue
		}
		q := &dlQuery{Title: s.Title, Artist: s.Artist, Album: s.Album, Duration: s.Duration, N: s.N}
		if !colYtRe.MatchString(s.URL) && (strings.HasPrefix(s.Cover, "https://") || (os.Getenv("NAGHAM_TEST") != "" && strings.HasPrefix(s.Cover, "http://"))) { // catalogue songs: their real cover goes into the file
			q.Cover = s.Cover
		}
		if s.URL != "" {
			if u, err := dlValidURL(s.URL); err == nil && colYtRe.MatchString(u) {
				q.URL = u
			}
		}
		ctx, cancel := context.WithCancel(context.Background())
		j := &dlJob{ID: randB64(9), URL: "song:" + strings.Trim(s.Artist+" - "+s.Title, " -"), Status: "queued", Phase: "Waiting…", Folder: folder, cancel: cancel, q: q, Batch: in.Batch, Title: strings.Trim(s.Artist+" - "+s.Title, " -")}
		dlMu.Lock()
		dlJobs[j.ID] = j
		dlOrder = append(dlOrder, j.ID)
		for len(dlOrder) > 3000 { // forget the oldest finished ones
			old := dlJobs[dlOrder[0]]
			if old != nil && old.Status != "done" && old.Status != "error" && old.Status != "cancelled" {
				break
			}
			delete(dlJobs, dlOrder[0])
			dlOrder = dlOrder[1:]
		}
		dlMu.Unlock()
		go func() { defer cancel(); dlRun(j, ctx, in.Format) }()
		ids = append(ids, j.ID)
	}
	writeJSON(w, map[string]any{"ids": ids})
}
