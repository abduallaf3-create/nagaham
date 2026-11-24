package main

// Lightweight, dependency-free tag readers for MP3 (ID3v1/ID3v2), FLAC and WAV.

import (
	"bytes"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf16"
)

type Meta struct {
	Title     string
	Artist    string
	Album     string
	TrackNo   int
	Duration  float64
	Cover     []byte
	CoverMime string
}

func readMeta(path string, wantCover bool) Meta {
	var m Meta
	f, err := os.Open(path)
	if err != nil {
		return m
	}
	defer f.Close()
	st, _ := f.Stat()
	size := st.Size()
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp3":
		tagEnd := readID3v2(f, &m, wantCover)
		if m.Title == "" {
			readID3v1(f, size, &m)
		}
		m.Duration = mp3Duration(f, tagEnd, size)
	case ".flac":
		readFLAC(f, &m, wantCover)
	case ".wav":
		m.Duration = wavDuration(f)
	}
	return m
}

// ---------- ID3v2 ----------

func synchsafe(b []byte) int {
	return int(b[0]&0x7f)<<21 | int(b[1]&0x7f)<<14 | int(b[2]&0x7f)<<7 | int(b[3]&0x7f)
}

func decodeText(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	enc, b := b[0], b[1:]
	var s string
	switch enc {
	case 1, 2:
		be := enc == 2
		if len(b) >= 2 {
			if b[0] == 0xFF && b[1] == 0xFE {
				be, b = false, b[2:]
			} else if b[0] == 0xFE && b[1] == 0xFF {
				be, b = true, b[2:]
			}
		}
		u := make([]uint16, 0, len(b)/2)
		for i := 0; i+1 < len(b); i += 2 {
			var c uint16
			if be {
				c = uint16(b[i])<<8 | uint16(b[i+1])
			} else {
				c = uint16(b[i+1])<<8 | uint16(b[i])
			}
			if c == 0 {
				break
			}
			u = append(u, c)
		}
		s = string(utf16.Decode(u))
	case 3:
		if i := bytes.IndexByte(b, 0); i >= 0 {
			b = b[:i]
		}
		s = string(b)
	default:
		s = latin1(b)
	}
	return strings.TrimSpace(s)
}

func latin1(b []byte) string {
	if i := bytes.IndexByte(b, 0); i >= 0 {
		b = b[:i]
	}
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

func removeUnsync(b []byte) []byte {
	out := make([]byte, 0, len(b))
	for i := 0; i < len(b); i++ {
		out = append(out, b[i])
		if b[i] == 0xFF && i+1 < len(b) && b[i+1] == 0x00 {
			i++
		}
	}
	return out
}

func parseTrackNo(s string) int {
	if i := strings.IndexByte(s, '/'); i >= 0 {
		s = s[:i]
	}
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

// readID3v2 returns the byte offset where the audio data starts.
func readID3v2(f *os.File, m *Meta, wantCover bool) int64 {
	hdr := make([]byte, 10)
	if _, err := f.ReadAt(hdr, 0); err != nil || string(hdr[:3]) != "ID3" {
		return 0
	}
	ver := hdr[3]
	flags := hdr[5]
	size := synchsafe(hdr[6:10])
	end := int64(10 + size)
	if flags&0x10 != 0 {
		end += 10
	}
	if size <= 0 || size > 64<<20 {
		return end
	}
	tag := make([]byte, size)
	if _, err := f.ReadAt(tag, 10); err != nil && err != io.EOF {
		return end
	}
	if flags&0x80 != 0 && ver < 4 {
		tag = removeUnsync(tag)
	}
	pos := 0
	if flags&0x40 != 0 && len(tag) >= 4 { // extended header
		if ver == 4 {
			pos = synchsafe(tag[0:4])
		} else {
			pos = int(binary.BigEndian.Uint32(tag[0:4])) + 4
		}
	}
	idLen, hdrLen := 4, 10
	if ver == 2 {
		idLen, hdrLen = 3, 6
	}
	for pos+hdrLen <= len(tag) {
		id := string(tag[pos : pos+idLen])
		if id[0] == 0 {
			break
		}
		var fsz int
		var fflags byte
		switch ver {
		case 2:
			fsz = int(tag[pos+3])<<16 | int(tag[pos+4])<<8 | int(tag[pos+5])
		case 3:
			fsz = int(binary.BigEndian.Uint32(tag[pos+4 : pos+8]))
			fflags = tag[pos+9]
		default:
			fsz = synchsafe(tag[pos+4 : pos+8])
			fflags = tag[pos+9]
		}
		pos += hdrLen
		if fsz <= 0 || pos+fsz > len(tag) {
			break
		}
		data := tag[pos : pos+fsz]
		pos += fsz
		if ver == 4 {
			if fflags&0x0C != 0 { // compressed/encrypted: skip
				continue
			}
			if fflags&0x01 != 0 && len(data) > 4 { // data length indicator
				data = data[4:]
			}
			if fflags&0x02 != 0 {
				data = removeUnsync(data)
			}
		}
		switch id {
		case "TIT2", "TT2":
			m.Title = decodeText(data)
		case "TPE1", "TP1":
			m.Artist = decodeText(data)
		case "TPE2", "TP2":
			if m.Artist == "" {
				m.Artist = decodeText(data)
			}
		case "TALB", "TAL":
			m.Album = decodeText(data)
		case "TRCK", "TRK":
			m.TrackNo = parseTrackNo(decodeText(data))
		case "APIC", "PIC":
			if m.Cover != nil || len(data) < 4 {
				continue
			}
			m.Cover = []byte{} // mark as present
			if !wantCover {
				continue
			}
			enc := data[0]
			p := 1
			if id == "PIC" {
				fmtS := strings.ToLower(string(data[1:4]))
				m.CoverMime = "image/jpeg"
				if fmtS == "png" {
					m.CoverMime = "image/png"
				}
				p = 4
			} else {
				i := bytes.IndexByte(data[p:], 0)
				if i < 0 {
					continue
				}
				m.CoverMime = string(data[p : p+i])
				p += i + 1
			}
			p++ // picture type
			// skip description
			if enc == 1 || enc == 2 {
				for p+1 < len(data) && !(data[p] == 0 && data[p+1] == 0) {
					p += 2
				}
				p += 2
			} else {
				for p < len(data) && data[p] != 0 {
					p++
				}
				p++
			}
			if p < len(data) {
				m.Cover = data[p:]
			}
		}
	}
	return end
}

func readID3v1(f *os.File, size int64, m *Meta) {
	if size < 128 {
		return
	}
	b := make([]byte, 128)
	if _, err := f.ReadAt(b, size-128); err != nil || string(b[:3]) != "TAG" {
		return
	}
	m.Title = strings.TrimSpace(latin1(b[3:33]))
	if m.Artist == "" {
		m.Artist = strings.TrimSpace(latin1(b[33:63]))
	}
	if m.Album == "" {
		m.Album = strings.TrimSpace(latin1(b[63:93]))
	}
	if b[125] == 0 && b[126] != 0 && m.TrackNo == 0 {
		m.TrackNo = int(b[126])
	}
}

// ---------- MP3 duration ----------

var mp3Bitrates = [2][3][16]int{
	{ // MPEG1: layer1, layer2, layer3
		{0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0},
		{0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0},
		{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0},
	},
	{ // MPEG2/2.5
		{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0},
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},
	},
}
var mp3Rates = [4][3]int{{11025, 12000, 8000}, {0, 0, 0}, {22050, 24000, 16000}, {44100, 48000, 32000}}

func mp3Duration(f *os.File, start, size int64) float64 {
	buf := make([]byte, 64*1024)
	n, _ := f.ReadAt(buf, start)
	buf = buf[:n]
	for i := 0; i+4 <= len(buf); i++ {
		if buf[i] != 0xFF || buf[i+1]&0xE0 != 0xE0 {
			continue
		}
		verBits := (buf[i+1] >> 3) & 3
		layerBits := (buf[i+1] >> 1) & 3
		brIdx := buf[i+2] >> 4
		srIdx := (buf[i+2] >> 2) & 3
		if verBits == 1 || layerBits == 0 || brIdx == 0 || brIdx == 15 || srIdx == 3 {
			continue
		}
		layer := 3 - int(layerBits) // 0=L1,1=L2,2=L3
		vi := 0
		if verBits != 3 {
			vi = 1
		}
		br := mp3Bitrates[vi][layer][brIdx] * 1000
		sr := mp3Rates[verBits][srIdx]
		if br == 0 || sr == 0 {
			continue
		}
		spf := 1152
		if layer == 0 {
			spf = 384
		} else if layer == 2 && vi == 1 {
			spf = 576
		}
		mono := buf[i+3]>>6 == 3
		// Xing / Info header
		off := 36
		if vi == 0 && !mono {
			off = 36
		} else if vi == 0 && mono {
			off = 21
		} else if vi == 1 && !mono {
			off = 21
		} else {
			off = 13
		}
		if i+off+12 <= len(buf) {
			tagS := string(buf[i+off : i+off+4])
			if tagS == "Xing" || tagS == "Info" {
				fl := binary.BigEndian.Uint32(buf[i+off+4 : i+off+8])
				if fl&1 != 0 {
					frames := binary.BigEndian.Uint32(buf[i+off+8 : i+off+12])
					return float64(frames) * float64(spf) / float64(sr)
				}
			}
		}
		if i+36+18 <= len(buf) && string(buf[i+36:i+40]) == "VBRI" {
			frames := binary.BigEndian.Uint32(buf[i+36+14 : i+36+18])
			return float64(frames) * float64(spf) / float64(sr)
		}
		audio := size - start - int64(i)
		return float64(audio) * 8 / float64(br)
	}
	return 0
}

// ---------- FLAC ----------

func readFLAC(f *os.File, m *Meta, wantCover bool) {
	h := make([]byte, 4)
	if _, err := f.ReadAt(h, 0); err != nil || string(h) != "fLaC" {
		return
	}
	pos := int64(4)
	for i := 0; i < 64; i++ {
		bh := make([]byte, 4)
		if _, err := f.ReadAt(bh, pos); err != nil {
			return
		}
		last := bh[0]&0x80 != 0
		typ := bh[0] & 0x7f
		ln := int64(bh[1])<<16 | int64(bh[2])<<8 | int64(bh[3])
		pos += 4
		if typ == 6 && !wantCover {
			m.Cover = []byte{}
		} else if typ == 0 || typ == 4 || (typ == 6 && len(m.Cover) == 0) {
			if ln > 32<<20 {
				return
			}
			d := make([]byte, ln)
			if _, err := f.ReadAt(d, pos); err != nil {
				return
			}
			switch typ {
			case 0:
				if len(d) >= 18 {
					sr := int(d[10])<<12 | int(d[11])<<4 | int(d[12])>>4
					total := int64(d[13]&0x0F)<<32 | int64(binary.BigEndian.Uint32(d[14:18]))
					if sr > 0 {
						m.Duration = float64(total) / float64(sr)
					}
				}
			case 4:
				parseVorbis(d, m)
			case 6:
				m.Cover = []byte{}
				if wantCover {
					parseFlacPicture(d, m)
				}
			}
		}
		pos += ln
		if last {
			return
		}
	}
}

func parseVorbis(d []byte, m *Meta) {
	if len(d) < 8 {
		return
	}
	p := 4 + int(binary.LittleEndian.Uint32(d[0:4]))
	if p+4 > len(d) {
		return
	}
	n := int(binary.LittleEndian.Uint32(d[p : p+4]))
	p += 4
	for i := 0; i < n && p+4 <= len(d); i++ {
		l := int(binary.LittleEndian.Uint32(d[p : p+4]))
		p += 4
		if p+l > len(d) {
			return
		}
		kv := string(d[p : p+l])
		p += l
		eq := strings.IndexByte(kv, '=')
		if eq < 0 {
			continue
		}
		k, v := strings.ToUpper(kv[:eq]), strings.TrimSpace(kv[eq+1:])
		switch k {
		case "TITLE":
			m.Title = v
		case "ARTIST":
			if m.Artist == "" {
				m.Artist = v
			}
		case "ALBUMARTIST":
			if m.Artist == "" {
				m.Artist = v
			}
		case "ALBUM":
			m.Album = v
		case "TRACKNUMBER":
			m.TrackNo = parseTrackNo(v)
		}
	}
}

func parseFlacPicture(d []byte, m *Meta) {
	rd := func(p int) int {
		if p+4 > len(d) {
			return -1
		}
		return int(binary.BigEndian.Uint32(d[p : p+4]))
	}
	p := 4
	ml := rd(p)
	if ml < 0 || p+4+ml > len(d) {
		return
	}
	m.CoverMime = string(d[p+4 : p+4+ml])
	p += 4 + ml
	dl := rd(p)
	if dl < 0 {
		return
	}
	p += 4 + dl + 16
	pl := rd(p)
	if pl < 0 || p+4+pl > len(d) {
		return
	}
	m.Cover = d[p+4 : p+4+pl]
}

// ---------- WAV ----------

func wavDuration(f *os.File) float64 {
	h := make([]byte, 12)
	if _, err := f.ReadAt(h, 0); err != nil || string(h[:4]) != "RIFF" || string(h[8:12]) != "WAVE" {
		return 0
	}
	pos := int64(12)
	var byteRate uint32
	for i := 0; i < 64; i++ {
		ch := make([]byte, 8)
		if _, err := f.ReadAt(ch, pos); err != nil {
			return 0
		}
		id := string(ch[:4])
		ln := int64(binary.LittleEndian.Uint32(ch[4:8]))
		if id == "fmt " {
			fb := make([]byte, 16)
			f.ReadAt(fb, pos+8)
			byteRate = binary.LittleEndian.Uint32(fb[8:12])
		} else if id == "data" && byteRate > 0 {
			return float64(ln) / float64(byteRate)
		}
		pos += 8 + ln + ln%2
	}
	return 0
}
