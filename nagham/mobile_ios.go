//go:build ios

package main

// The iPhone app: Nagham's server is built into the app (c-archive) and started from Swift.
// The app's own window then shows the UI and plays YouTube Music hidden, like the PC version.

/*
#include <stdlib.h>
*/
import "C"

import (
	"net"
	"os"
	"path/filepath"
	"time"
)

// NaghamStart starts the server with the app's own folders and returns its port (0 if it failed).
//
//export NaghamStart
func NaghamStart(data, music *C.char) C.int {
	os.Setenv("NAGHAM_DATA", C.GoString(data))
	os.Setenv("NAGHAM_MUSIC", C.GoString(music))
	os.Setenv("NAGHAM_HEADLESS", "1")
	os.MkdirAll(C.GoString(music), 0o755)
	os.Setenv("NAGHAM_BACKUPS", filepath.Join(filepath.Dir(C.GoString(music)), "Backups")) // shows in Files → Nagham
	// a fixed port keeps the page's address (and what it remembers) the same every launch
	addr := "127.0.0.1:41789"
	if ln, err := net.Listen("tcp", addr); err == nil {
		ln.Close()
	} else {
		addr = "127.0.0.1:0"
	}
	os.Setenv("NAGHAM_ADDR", addr)
	os.Remove(C.GoString(data) + "/port")
	go main()
	select {
	case p := <-portReady:
		return C.int(p)
	case <-time.After(20 * time.Second):
		return 0
	}
}

// NaghamSetNative tells the server the app can play YouTube Music hidden (like Nagham's PC window).
//
//export NaghamSetNative
func NaghamSetNative(on C.int) { nativeWindowActive.Store(on != 0) }
