package main

// Finds the full version of a song on YouTube (only videos that are allowed
// to play in other apps), so 30-second previews can be replaced by the whole
// song. Results are cached on disk because every YouTube search uses part of
// the user's daily quota.

import (
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

type ytMatchEntry struct {
	IDs []string  `json:"ids"`
	At  time.Time `json:"at"`
}

var (
	ymMu    sync.Mutex
	ymCache = map[string]ytMatchEntry{}
	ymLoad  sync.Once
	isoRe   = regexp.MustCompile(`P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?`)
)

func ymFile() string { return filepath.Join(dataDir, "ytmatch.json") }

func ymEnsure() {
	ymLoad.Do(func() {
		if b, err := os.ReadFile(ymFile()); err == nil {
			json.Unmarshal(b, &ymCache)
		}
	})
}

func normKey(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func isoSeconds(s string) float64 {
	m := isoRe.FindStringSubmatch(s)
	if m == nil {
		return 0
	}
	n := func(i int) float64 { v, _ := strconv.Atoi(m[i]); return float64(v) }
	return n(1)*86400 + n(2)*3600 + n(3)*60 + n(4)
}

// GET /api/match?title=&artist=&dur=   →  {ids:[videoId,...]}
func ytMatch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	title, artist := strings.TrimSpace(q.Get("title")), strings.TrimSpace(q.Get("artist"))
	if title == "" {
		http.Error(w, "missing title", 400)
		return
	}
	if i := strings.Index(artist, ","); i > 0 {
		artist = strings.TrimSpace(artist[:i])
	}
	want, _ := strconv.ParseFloat(q.Get("dur"), 64)
	key := normKey(artist) + "|" + normKey(title)
	ymEnsure()
	ymMu.Lock()
	if e, ok := ymCache[key]; ok && time.Since(e.At) < 90*24*time.Hour {
		ymMu.Unlock()
		writeJSON(w, map[string]any{"ids": e.IDs, "cached": true})
		return
	}
	ymMu.Unlock()

	search := "/youtube/v3/search?part=snippet&type=video&maxResults=8&q=" + url.QueryEscape(strings.TrimSpace(artist+" "+title))
	b, status, err := ytDo("GET", search)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	if status >= 400 {
		http.Error(w, ytErrorText(b, status), status)
		return
	}
	var sr struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
			Snippet struct {
				Title   string `json:"title"`
				Channel string `json:"channelTitle"`
			} `json:"snippet"`
		} `json:"items"`
	}
	json.Unmarshal(b, &sr)
	type cand struct {
		id    string
		score float64
	}
	var cands []cand
	var ids []string
	for _, it := range sr.Items {
		if it.ID.VideoID != "" {
			ids = append(ids, it.ID.VideoID)
		}
	}
	durs := map[string]float64{}
	if len(ids) > 0 {
		if vb, st, err := ytDo("GET", "/youtube/v3/videos?part=contentDetails,status&id="+strings.Join(ids, ",")); err == nil && st == 200 {
			var vr struct {
				Items []struct {
					ID             string `json:"id"`
					ContentDetails struct {
						Duration string `json:"duration"`
					} `json:"contentDetails"`
					Status struct {
						Embeddable bool `json:"embeddable"`
					} `json:"status"`
				} `json:"items"`
			}
			json.Unmarshal(vb, &vr)
			for _, v := range vr.Items {
				durs[v.ID] = isoSeconds(v.ContentDetails.Duration) // songs now play on YouTube Music itself, so embedding rules don't matter
			}
		}
	}
	nt, na := normKey(title), normKey(artist)
	for i, it := range sr.Items {
		id := it.ID.VideoID
		if id == "" || durs[id] < 0 {
			continue
		}
		vt, ch := normKey(it.Snippet.Title), normKey(it.Snippet.Channel)
		s := float64(8 - i) // YouTube's own ranking
		if strings.Contains(vt, nt) {
			s += 10
		}
		if na != "" && (strings.Contains(vt, na) || strings.Contains(ch, na)) {
			s += 6
		}
		if strings.HasSuffix(strings.ToLower(it.Snippet.Channel), "- topic") {
			s += 6 // auto-generated "Topic" audio usually plays everywhere
		}
		for _, bad := range []string{"cover", "karaoke", "instrumental", "8d", "slowed", "sped up", "reverb", "nightcore", "remix", "live", "reaction"} {
			if strings.Contains(vt, bad) && !strings.Contains(nt, bad) {
				s -= 8
			}
		}
		if d := durs[id]; d > 0 && want > 0 {
			diff := math.Abs(d - want)
			switch {
			case diff < 6:
				s += 8
			case diff < 20:
				s += 3
			case diff > 90:
				s -= 10
			}
		}
		if d := durs[id]; d > 0 && (d < 45 || d > 20*60) {
			s -= 12
		}
		cands = append(cands, cand{id, s})
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].score > cands[j].score })
	out := []string{}
	for _, c := range cands {
		if c.score > 0 && len(out) < 4 {
			out = append(out, c.id)
		}
	}
	ymMu.Lock()
	ymCache[key] = ytMatchEntry{IDs: out, At: time.Now()}
	if len(ymCache) > 5000 {
		ymCache = map[string]ytMatchEntry{}
	}
	if b, err := json.Marshal(ymCache); err == nil {
		os.WriteFile(ymFile(), b, 0o644)
	}
	ymMu.Unlock()
	writeJSON(w, map[string]any{"ids": out})
}
