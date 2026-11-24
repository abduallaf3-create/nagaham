package main

// On the iPhone, apps can't start programs, so yt-dlp runs inside the app's own Python
// (python/app/naghambridge.py) and is reached over a small local web service.
// ytCommand behaves like exec.Cmd for the few ways Nagham uses yt-dlp, so the rest of the
// download code is the same as on the PC. Off the iPhone (tests) it simply runs the program.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

const bridgeName = "bridge" // what dlResolve("yt-dlp") gives on the phone

func phoneMode() bool { return runtime.GOOS == "ios" || os.Getenv("NAGHAM_PHONE") == "1" }

func bridgeURL() string {
	if u := os.Getenv("NAGHAM_BRIDGE"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return "http://127.0.0.1:41790"
}

var (
	bridgeMu      sync.Mutex
	bridgeOK      bool
	bridgeChecked time.Time
	bridgeInfo    map[string]any
	bridgeClient  = &http.Client{Timeout: 0}
)

// bridgeReady: is the iPhone's yt-dlp up (it takes a few seconds after the app starts)
func bridgeReady() bool {
	bridgeMu.Lock()
	if time.Since(bridgeChecked) < 5*time.Second {
		ok := bridgeOK
		bridgeMu.Unlock()
		return ok
	}
	bridgeMu.Unlock()
	c := &http.Client{Timeout: 70 * time.Second}
	ok := false
	var info map[string]any
	if resp, err := c.Get(bridgeURL() + "/health"); err == nil {
		json.NewDecoder(resp.Body).Decode(&info)
		resp.Body.Close()
		ok, _ = info["ok"].(bool)
	}
	bridgeMu.Lock()
	bridgeOK, bridgeChecked, bridgeInfo = ok, time.Now(), info
	bridgeMu.Unlock()
	return ok
}

func bridgeStatus() map[string]any {
	bridgeReady()
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	return bridgeInfo
}

// bridgeTag writes the song's name, singer, album and cover into a downloaded file
func bridgeTag(ctx context.Context, file, title, artist, album, cover string) error {
	b, _ := json.Marshal(map[string]string{"file": file, "title": title, "artist": artist, "album": album, "cover": cover})
	cctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(cctx, "POST", bridgeURL()+"/tag", bytes.NewReader(b))
	resp, err := bridgeClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		m, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
		return fmt.Errorf("tag: %s", strings.TrimSpace(string(m)))
	}
	return nil
}

type ytExitError struct{ code int }

func (e *ytExitError) Error() string { return fmt.Sprintf("exit status %d", e.code) }

// ytCmd: a yt-dlp run, either through the bridge or as a normal program
type ytCmd struct {
	ctx      context.Context
	args     []string
	cmd      *exec.Cmd // when not using the bridge
	Env      []string
	outR     *io.PipeReader
	outW     *io.PipeWriter
	errR     *io.PipeReader
	errW     *io.PipeWriter
	wantOut  bool
	wantErr  bool
	done     chan struct{}
	code     int
	startErr error
}

func ytCommand(ctx context.Context, ytdlp string, args ...string) *ytCmd {
	c := &ytCmd{ctx: ctx, args: args}
	if ytdlp != bridgeName {
		c.cmd = hidden(exec.CommandContext(ctx, ytdlp, args...))
	}
	return c
}

func (c *ytCmd) StdoutPipe() (io.ReadCloser, error) {
	if c.cmd != nil {
		return c.cmd.StdoutPipe()
	}
	c.outR, c.outW = io.Pipe()
	c.wantOut = true
	return c.outR, nil
}

func (c *ytCmd) StderrPipe() (io.ReadCloser, error) {
	if c.cmd != nil {
		return c.cmd.StderrPipe()
	}
	c.errR, c.errW = io.Pipe()
	c.wantErr = true
	return c.errR, nil
}

func (c *ytCmd) Start() error {
	if c.cmd != nil {
		if c.Env != nil {
			c.cmd.Env = c.Env
		}
		return c.cmd.Start()
	}
	body, _ := json.Marshal(map[string]any{"args": c.args})
	req, err := http.NewRequestWithContext(c.ctx, "POST", bridgeURL()+"/run", bytes.NewReader(body))
	if err != nil {
		return err
	}
	resp, err := bridgeClient.Do(req)
	if err != nil {
		return errors.New("yt-dlp isn't running inside the app yet: " + err.Error())
	}
	c.done = make(chan struct{})
	c.code = -1
	go func() {
		defer close(c.done)
		defer resp.Body.Close()
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 1<<20), 16<<20)
		for sc.Scan() {
			line := sc.Text()
			if len(line) < 2 {
				continue
			}
			tag, text := line[0], line[2:]
			switch tag {
			case 'o':
				if c.wantOut {
					c.outW.Write([]byte(text + "\n"))
				}
			case 'e':
				if c.wantErr {
					c.errW.Write([]byte(text + "\n"))
				}
			case 'x':
				fmt.Sscanf(text, "%d", &c.code)
			}
		}
		if c.outW != nil {
			c.outW.Close()
		}
		if c.errW != nil {
			c.errW.Close()
		}
	}()
	return nil
}

func (c *ytCmd) Wait() error {
	if c.cmd != nil {
		return c.cmd.Wait()
	}
	<-c.done
	if c.ctx.Err() != nil {
		return c.ctx.Err()
	}
	if c.code != 0 {
		return &ytExitError{c.code}
	}
	return nil
}

// Output: stdout of a finished run (stderr goes into the error, like exec.Cmd)
func (c *ytCmd) Output() ([]byte, error) {
	if c.cmd != nil {
		if c.Env != nil {
			c.cmd.Env = c.Env
		}
		return c.cmd.Output()
	}
	out, _ := c.StdoutPipe()
	errp, _ := c.StderrPipe()
	if err := c.Start(); err != nil {
		return nil, err
	}
	var ob, eb bytes.Buffer
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); io.Copy(&eb, errp) }()
	io.Copy(&ob, out)
	wg.Wait()
	err := c.Wait()
	if err != nil {
		var ee *ytExitError
		if errors.As(err, &ee) {
			return ob.Bytes(), &ytStderrError{code: ee.code, Stderr: eb.Bytes()}
		}
	}
	return ob.Bytes(), err
}

// CombinedOutput: stdout and stderr together
func (c *ytCmd) CombinedOutput() ([]byte, error) {
	if c.cmd != nil {
		return c.cmd.CombinedOutput()
	}
	out, err := c.Output()
	var se *ytStderrError
	if errors.As(err, &se) {
		return append(out, se.Stderr...), err
	}
	return out, err
}

type ytStderrError struct {
	code   int
	Stderr []byte
}

func (e *ytStderrError) Error() string { return fmt.Sprintf("exit status %d", e.code) }

// ytErrStderr: what yt-dlp printed as errors, from either kind of run
func ytErrStderr(err error) []byte {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.Stderr
	}
	var se *ytStderrError
	if errors.As(err, &se) {
		return se.Stderr
	}
	return nil
}
