package main

// Songs downloaded by older versions of Nagham (folder Nagham\Songs) can carry a picture from the video instead of the
// album cover, and a video title ("Artist - Song (Official Video)"). Once per file, Nagham looks the song up in the
// free catalogue and — only when title AND artist clearly match — writes the real cover, title and album into it.

import (
	"context"
	"encoding/json"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

var (
	sfMu     sync.Mutex
	sfJunk   = regexp.MustCompile(`(?i)\s*[\(\[][^\)\]]*\b(official|video|audio|lyrics?|hd|4k|visuali[sz]er|m/?v|clip|remaster(ed)?)\b[^\)\]]*[\)\]]`)
	sfNoise  = regexp.MustCompile(`(?i)\s*[\(\[][^\)\]]*[\)\]]`)
	sfFeatRe = regexp.MustCompile(`(?i)\s+(ft\.?|feat\.?|featuring)\s+.*$`)
)

func sfNorm(s string) string {
	return strings.Join(strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) }), " ")
}

// "Artist - Song (Official Video) ft. X" → "Song"
func sfCleanTitle(title, artist string) string {
	t := strings.TrimSpace(title)
	if i := strings.Index(t, " - "); i > 0 && sfNorm(t[:i]) != "" && (strings.Contains(sfNorm(artist), sfNorm(t[:i])) || strings.Contains(sfNorm(t[:i]), sfNorm(artist))) {
		t = t[i+3:]
	}
	t = sfJunk.ReplaceAllString(t, "")
	t = sfFeatRe.ReplaceAllString(t, "")
	return strings.TrimSpace(t)
}

func songFixStart() {
	go func() {
		time.Sleep(20 * time.Second)
		for {
			songFixRun()
			time.Sleep(15 * time.Minute)
		}
	}()
}

func songFixRun() {
	if !sfMu.TryLock() {
		return
	}
	defer sfMu.Unlock()
	ffmpeg, ok := dlResolve("ffmpeg")
	if !ok {
		return
	}
	songs := filepath.Join(dataDir, "Songs") + string(filepath.Separator)
	recPath := filepath.Join(dataDir, "songfix2.json") // 2: the first version never found anything (see sfLookup)
	rec := map[string]int64{}
	if b, err := os.ReadFile(recPath); err == nil {
		json.Unmarshal(b, &rec)
	}
	mu.Lock()
	var todo []Track
	for _, t := range store.Tracks {
		if strings.HasPrefix(strings.ToLower(t.Path), strings.ToLower(songs)) && rec[t.Path] != t.ModTime {
			todo = append(todo, *t)
		}
	}
	mu.Unlock()
	changed := 0
	for i, t := range todo {
		if i >= 300 {
			break
		}
		ext := strings.ToLower(filepath.Ext(t.Path))
		if ext != ".mp3" && ext != ".m4a" {
			rec[t.Path] = t.ModTime
			continue
		}
		artist := strings.TrimSpace(strings.Split(strings.ReplaceAll(t.Artist, " ", " "), ",")[0])
		title := sfCleanTitle(t.Title, artist)
		album := t.Album
		if strings.EqualFold(album, "Songs") || strings.EqualFold(album, filepath.Base(filepath.Dir(t.Path))) {
			album = "" // that's just the folder's name
		}
		hit := sfLookup(title, artist, album)
		if hit == nil {
			rec[t.Path] = t.ModTime // no sure match: leave the file as it is
			continue
		}
		newArtist := t.Artist
		if !strings.Contains(sfNorm(t.Artist), sfNorm(hit.Artist.Name)) {
			newArtist = hit.Artist.Name
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		err := dlEmbedCover(ctx, ffmpeg, t.Path, firstNonEmpty(hit.Album.CoverXL, hit.Album.CoverMedium), "title", hit.Title, "artist", newArtist, "album", hit.Album.Title)
		cancel()
		if err != nil { // probably playing right now: try again next time
			log.Printf("songfix %s: %v", filepath.Base(t.Path), err)
			continue
		}
		if st, err := os.Stat(t.Path); err == nil {
			rec[t.Path] = st.ModTime().Unix()
		}
		changed++
		log.Printf("songfix: %s → %s — %s (%s)", filepath.Base(t.Path), hit.Title, newArtist, hit.Album.Title)
		time.Sleep(300 * time.Millisecond)
	}
	if b, err := json.Marshal(rec); err == nil {
		os.WriteFile(recPath, b, 0o644)
	}
	if changed > 0 {
		go scanAll()
	}
}

// the catalogue's song, only when both the title and the artist match
// (Deezer's artist:"…" track:"…" search stopped answering, so it's a plain search, checked strictly here)
func sfLookup(title, artist, album string) *dzTrack {
	if sfNorm(title) == "" || sfNorm(artist) == "" || strings.EqualFold(artist, "Unknown artist") {
		return nil
	}
	var res struct {
		Data []dzTrack `json:"data"`
	}
	if fetchJSON(apiBase["deezer"]+"/search?limit=15&q="+url.QueryEscape(artist+" "+title), 24*time.Hour, &res) != nil {
		return nil
	}
	nt, na, nal := sfNorm(title), sfNorm(artist), sfNorm(album)
	artistOK := func(d *dzTrack) bool {
		da := sfNorm(d.Artist.Name)
		return da != "" && (da == na || strings.Contains(na, da) || strings.Contains(da, na))
	}
	hasCover := func(d *dzTrack) bool { return d.Album.CoverXL+d.Album.CoverMedium != "" }
	// best first: same title and the album the file already names → same title → same title without "(…)"
	passes := []func(d *dzTrack) bool{
		func(d *dzTrack) bool { return sfNorm(d.Title) == nt && nal != "" && sfNorm(d.Album.Title) == nal },
		func(d *dzTrack) bool { return sfNorm(d.Title) == nt },
		func(d *dzTrack) bool {
			return sfNorm(sfNoise.ReplaceAllString(sfFeatRe.ReplaceAllString(d.Title, ""), "")) == nt && !regexp.MustCompile(`(?i)live|karaoke|instrumental|remix|acoustic|cover`).MatchString(d.Title)
		},
	}
	for _, ok := range passes {
		for i := range res.Data {
			d := &res.Data[i]
			if artistOK(d) && hasCover(d) && ok(d) {
				return d
			}
		}
	}
	return nil
}
