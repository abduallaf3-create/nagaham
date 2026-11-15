//go:build !windows

package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
)

func dialDiscord() (net.Conn, error) {
	dirs := []string{os.Getenv("NAGHAM_DISCORD_DIR"), os.Getenv("XDG_RUNTIME_DIR"), os.Getenv("TMPDIR"), "/tmp"}
	for _, d := range dirs {
		if d == "" {
			continue
		}
		for i := 0; i < 10; i++ {
			if c, err := net.Dial("unix", filepath.Join(d, fmt.Sprintf("discord-ipc-%d", i))); err == nil {
				return c, nil
			}
		}
	}
	return nil, fmt.Errorf("discord not running")
}
