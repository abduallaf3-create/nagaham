package main

// The Mac's download tools: yt-dlp (yt-dlp_macos), deno, and ffmpeg / ffprobe from Martin Riedl's
// build server (ready-made Mac builds, for Apple chips and Intel). Intel builds from evermeet.cx are
// the backup (they also run on Apple chips through Rosetta).

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"time"
)

func dlDenoZip() string {
	switch {
	case runtime.GOOS == "darwin" && runtime.GOARCH == "arm64":
		return "deno-aarch64-apple-darwin.zip"
	case runtime.GOOS == "darwin":
		return "deno-x86_64-apple-darwin.zip"
	}
	return "deno-x86_64-pc-windows-msvc.zip"
}

var macFfRe = regexp.MustCompile(`/info/detail/macos/(arm64|amd64)/([0-9]+_[A-Za-z0-9._-]+)`)

// the newest release build's download folder for this Mac
func macFfmpegBase() (string, error) {
	arch := runtime.GOARCH
	if v := os.Getenv("NAGHAM_DL_MACFF"); v != "" {
		return v, nil
	}
	c := &http.Client{Timeout: 25 * time.Second}
	resp, err := c.Get("https://ffmpeg.martin-riedl.de/info/history/macos/" + arch + "/release")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	m := macFfRe.FindSubmatch(b)
	if m == nil {
		return "", errors.New("no Mac build listed")
	}
	return "https://ffmpeg.martin-riedl.de/download/macos/" + string(m[1]) + "/" + string(m[2]) + "/", nil
}

func dlMacFfmpeg(cb func(float64)) error {
	get := func(u, name string, from, to float64) error {
		z := filepath.Join(dlToolsDir(), name+".zip")
		defer os.Remove(z)
		if err := dlFetch(u, z, func(p float64) { cb(from + (to-from)*p/100) }); err != nil {
			return err
		}
		if err := dlUnzip(z, map[string]string{name: dlToolPath(name)}); err != nil {
			return err
		}
		return os.Chmod(dlToolPath(name), 0o755)
	}
	if base, err := macFfmpegBase(); err == nil {
		if err = get(base+"ffmpeg.zip", "ffmpeg", 0, 70); err == nil {
			if err = get(base+"ffprobe.zip", "ffprobe", 70, 100); err == nil {
				return nil
			}
		}
	}
	// backup: evermeet.cx (Intel builds)
	if err := get("https://evermeet.cx/ffmpeg/getrelease/zip", "ffmpeg", 0, 70); err != nil {
		return err
	}
	return get("https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip", "ffprobe", 70, 100)
}
