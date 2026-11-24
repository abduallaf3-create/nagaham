//go:build windows

package main

import (
	"fmt"
	"net"
	"os"
	"syscall"
	"time"
)

var procCancelIoEx = syscall.NewLazyDLL("kernel32.dll").NewProc("CancelIoEx")

// pipeConn wraps a Windows named pipe opened as a file.
type pipeConn struct{ f *os.File }

func (p pipeConn) Read(b []byte) (int, error)  { return p.f.Read(b) }
func (p pipeConn) Write(b []byte) (int, error) { return p.f.Write(b) }
func (p pipeConn) Close() error {
	procCancelIoEx.Call(p.f.Fd(), 0) // unblock a read that is still waiting
	return p.f.Close()
}
func (p pipeConn) LocalAddr() net.Addr                { return pipeAddr{} }
func (p pipeConn) RemoteAddr() net.Addr               { return pipeAddr{} }
func (p pipeConn) SetDeadline(t time.Time) error      { return nil }
func (p pipeConn) SetReadDeadline(t time.Time) error  { return nil }
func (p pipeConn) SetWriteDeadline(t time.Time) error { return nil }

type pipeAddr struct{}

func (pipeAddr) Network() string { return "pipe" }
func (pipeAddr) String() string  { return "discord-ipc" }

func dialDiscord() (net.Conn, error) {
	for i := 0; i < 10; i++ {
		name := fmt.Sprintf(`\\.\pipe\discord-ipc-%d`, i)
		p, _ := syscall.UTF16PtrFromString(name)
		h, err := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_EXISTING, 0, 0)
		if err == nil {
			return pipeConn{os.NewFile(uintptr(h), name)}, nil
		}
	}
	return nil, fmt.Errorf("discord not running")
}
