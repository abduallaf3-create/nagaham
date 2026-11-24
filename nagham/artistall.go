package main

// An artist's whole catalogue: every album / single / EP, and every song from all of them
// (shown on the artist page and at the top of search when you search a singer's name).

import (
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// dzGet reads one Deezer page, waiting and retrying when Deezer says "too many requests" (~50 per 5 seconds)
func dzGet(path string, ttl time.Duration, v any) error {
	var err error
	for attempt := 0; attempt < 6; attempt++ {
		var raw json.RawMessage
		if err = fetchJSON(apiBase["deezer"]+path, ttl, &raw); err != nil {
			time.Sleep(600 * time.Millisecond)
			if attempt >= 2 {
				return err
			}
			continue
		}
		var e struct {
			Error *struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		json.Unmarshal(raw, &e)
		if e.Error != nil && e.Error.Code == 4 { // quota: wait and try again (not cached by us)
			cacheMu.Lock()
			delete(cache, apiBase["deezer"]+path)
			cacheMu.Unlock()
			time.Sleep(time.Duration(1500+700*attempt) * time.Millisecond)
			continue
		}
		return json.Unmarshal(raw, v)
	}
	return err
}

// dzArtistAlbums returns all of an artist's releases (every page), newest first
func dzArtistAlbums(id string) []dzAlbum {
	var all []dzAlbum
	for index := 0; index < 500; {
		var page struct {
			Data []dzAlbum `json:"data"`
			Next string    `json:"next"`
		}
		if err := dzGet("/artist/"+url.PathEscape(id)+"/albums?limit=100&index="+strconv.Itoa(index), time.Hour, &page); err != nil || len(page.Data) == 0 {
			break
		}
		all = append(all, page.Data...)
		if page.Next == "" {
			break
		}
		index += len(page.Data)
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].ReleaseDate > all[j].ReleaseDate })
	return all
}

var (
	asMu    sync.Mutex
	asCache = map[string]asEntry{}
	asWait  = map[string]chan struct{}{}
	asParen = regexp.MustCompile(`(?i)\s*[\(\[][^)\]]*(remaster|live|version|edit|mix|acoustic|instrumental|feat|ft\.|with |مباشر|حفلة)[^)\]]*[\)\]]`)
	asDash  = regexp.MustCompile(`(?i)\s+-\s+.*(remaster|live|version|edit|mix).*$`)
	asJunk  = regexp.MustCompile(`[^\p{L}\p{N}]+`)
)

type asEntry struct {
	at     time.Time
	tracks []OTrack
	n      int
}

func asKey(title string) string {
	t := strings.ToLower(title)
	t = asParen.ReplaceAllString(t, "")
	t = asDash.ReplaceAllString(t, "")
	return asJunk.ReplaceAllString(t, "")
}

// GET /api/online/artistsongs?id=dz:123 – every song by the artist, each once, newest album first
func onlineArtistSongs(w http.ResponseWriter, r *http.Request) {
	src, id := splitID(r.URL.Query().Get("id"))
	if src != "dz" || id == "" {
		writeJSON(w, map[string]any{"tracks": []OTrack{}, "albums": 0})
		return
	}
	for {
		asMu.Lock()
		if e, ok := asCache[id]; ok && time.Since(e.at) < 2*time.Hour {
			asMu.Unlock()
			writeJSON(w, map[string]any{"tracks": e.tracks, "albums": e.n})
			return
		}
		if ch := asWait[id]; ch != nil { // someone is already gathering them
			asMu.Unlock()
			<-ch
			continue
		}
		ch := make(chan struct{})
		asWait[id] = ch
		asMu.Unlock()
		tracks, n := artistAllSongs(id)
		asMu.Lock()
		if len(tracks) > 0 {
			asCache[id] = asEntry{time.Now(), tracks, n}
		}
		delete(asWait, id)
		close(ch)
		asMu.Unlock()
		if len(tracks) == 0 {
			http.Error(w, "couldn't read this artist's songs", 502)
			return
		}
		writeJSON(w, map[string]any{"tracks": tracks, "albums": n})
		return
	}
}

func artistAllSongs(id string) ([]OTrack, int) {
	albums := dzArtistAlbums(id)
	if len(albums) > 200 {
		albums = albums[:200]
	}
	got := make([][]dzTrack, len(albums))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i := range albums {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var page struct {
				Data []dzTrack `json:"data"`
			}
			// not kept in the shared page cache (a big artist would push everything else out)
			if dzGet("/album/"+albums[i].ID.String()+"/tracks?limit=300", 0, &page) == nil {
				got[i] = page.Data
			}
		}(i)
	}
	wg.Wait()
	// a song belongs to its first real album: albums before EPs before singles, oldest first
	rank := map[string]int{"album": 0, "ep": 1, "single": 2, "compile": 3}
	order := make([]int, len(albums))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		ra, rb := rank[albums[order[a]].RecordType], rank[albums[order[b]].RecordType]
		if ra != rb {
			return ra < rb
		}
		return albums[order[a]].ReleaseDate < albums[order[b]].ReleaseDate
	})
	seen := map[string]bool{}
	type item struct {
		t        OTrack
		date     string
		pos, alb int
	}
	var items []item
	for _, ai := range order {
		al := albums[ai]
		for k, t := range got[ai] {
			key := asKey(t.Title)
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			t.Album.ID = al.ID
			t.Album.Title = al.Title
			t.Album.CoverMedium = al.CoverMedium
			t.Album.CoverXL = al.CoverXL
			items = append(items, item{t.norm(), al.ReleaseDate, k, ai})
		}
	}
	sort.SliceStable(items, func(a, b int) bool {
		if items[a].date != items[b].date {
			return items[a].date > items[b].date // newest first
		}
		if items[a].alb != items[b].alb {
			return items[a].alb < items[b].alb
		}
		return items[a].pos < items[b].pos
	})
	out := make([]OTrack, 0, len(items))
	for _, it := range items {
		out = append(out, it.t)
	}
	return out, len(albums)
}

// GET /api/online/fresh?ids=dz:1,dz:2 – new albums & singles (last 4 months) from the artists you follow, newest first
func onlineFresh(w http.ResponseWriter, r *http.Request) {
	var ids []string
	for _, x := range strings.Split(r.URL.Query().Get("ids"), ",") {
		if src, id := splitID(strings.TrimSpace(x)); src == "dz" && id != "" && len(ids) < 60 {
			ids = append(ids, id)
		}
	}
	cutoff := time.Now().AddDate(0, -4, 0).Format("2006-01-02")
	var mu sync.Mutex
	var out []OAlbum
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var page struct {
				Data []dzAlbum `json:"data"`
			}
			if dzGet("/artist/"+url.PathEscape(id)+"/albums?limit=30", 3*time.Hour, &page) != nil {
				return
			}
			for _, a := range normAlbums(page.Data) {
				if a.Release >= cutoff && a.Release <= time.Now().AddDate(0, 0, 1).Format("2006-01-02") {
					a.ArtistID = "dz:" + id
					mu.Lock()
					out = append(out, a)
					mu.Unlock()
				}
			}
		}(id)
	}
	wg.Wait()
	sort.SliceStable(out, func(i, j int) bool { return out[i].Release > out[j].Release })
	if len(out) > 40 {
		out = out[:40]
	}
	if out == nil {
		out = []OAlbum{}
	}
	writeJSON(w, map[string]any{"releases": out})
}
