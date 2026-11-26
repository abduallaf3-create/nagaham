package main

import (
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

func randB64(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
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

// Spotify and YouTube account linking were removed (3.19.0): the saved sign-ins are deleted from this PC
func dropLinkedAccounts() {
	for _, f := range []string{"spotify.json", "youtube.json", "ytmatch.json"} {
		os.Remove(filepath.Join(dataDir, f))
	}
}
