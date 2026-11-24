"""Nagham for iPhone: yt-dlp inside the app.

iOS apps can't start other programs, so the iPhone app runs yt-dlp here, inside its own Python,
and Nagham's built-in server talks to it over a small local web service:

  POST /run   {"args": [...yt-dlp command-line arguments...]}
              → streams lines: "o <stdout line>", "e <stderr line>", and finally "x <exit code>"
  POST /tag   {"file", "title", "artist", "album", "cover"}  → writes tags + cover into an .m4a/.mp3
  GET  /health → {"ok": true, "ytdlp": "<version>", "jsc": true|false}

YouTube's "JS challenges" are solved with the iPhone's own JavaScript engine (JavaScriptCore).
"""

from __future__ import annotations

import ctypes
import http.server
import json
import os
import socketserver
import ssl
import sys
import threading
import traceback
import urllib.request

PORT = int(os.environ.get("NAGHAM_BRIDGE_PORT", "41790"))

# Python on iOS has no system certificate store: use certifi's
try:
    import certifi

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    _SSL = ssl.create_default_context(cafile=certifi.where())
except Exception:  # pragma: no cover
    _SSL = ssl.create_default_context()


# ---------------------------------------------------------------- JavaScriptCore

class _JSC:
    """Runs a script in a fresh JavaScriptCore context and returns what it console.log()'d."""

    def __init__(self):
        self.lib = None
        self.err = ""
        try:
            lib = ctypes.CDLL("/System/Library/Frameworks/JavaScriptCore.framework/JavaScriptCore")
        except OSError as e:
            self.err = str(e)
            return
        vp = ctypes.c_void_p
        lib.JSGlobalContextCreate.restype = vp
        lib.JSGlobalContextCreate.argtypes = [vp]
        lib.JSGlobalContextRelease.argtypes = [vp]
        lib.JSGlobalContextRelease.restype = None
        lib.JSStringCreateWithUTF8CString.restype = vp
        lib.JSStringCreateWithUTF8CString.argtypes = [ctypes.c_char_p]
        lib.JSStringRelease.argtypes = [vp]
        lib.JSStringRelease.restype = None
        lib.JSEvaluateScript.restype = vp
        lib.JSEvaluateScript.argtypes = [vp, vp, vp, vp, ctypes.c_int, ctypes.POINTER(vp)]
        lib.JSValueToStringCopy.restype = vp
        lib.JSValueToStringCopy.argtypes = [vp, vp, ctypes.POINTER(vp)]
        lib.JSStringGetMaximumUTF8CStringSize.restype = ctypes.c_size_t
        lib.JSStringGetMaximumUTF8CStringSize.argtypes = [vp]
        lib.JSStringGetUTF8CString.restype = ctypes.c_size_t
        lib.JSStringGetUTF8CString.argtypes = [vp, ctypes.c_char_p, ctypes.c_size_t]
        self.lib = lib
        self.lock = threading.Lock()

    def _str(self, ctx, val) -> str:
        lib = self.lib
        exc = ctypes.c_void_p()
        s = lib.JSValueToStringCopy(ctx, val, ctypes.byref(exc))
        if not s:
            return ""
        n = lib.JSStringGetMaximumUTF8CStringSize(s)
        buf = ctypes.create_string_buffer(n)
        lib.JSStringGetUTF8CString(s, buf, n)
        lib.JSStringRelease(s)
        return buf.value.decode("utf-8", "replace")

    def _eval(self, ctx, code: str):
        lib = self.lib
        src = lib.JSStringCreateWithUTF8CString(code.encode("utf-8"))
        exc = ctypes.c_void_p()
        try:
            val = lib.JSEvaluateScript(ctx, src, None, None, 1, ctypes.byref(exc))
        finally:
            lib.JSStringRelease(src)
        if exc.value:
            raise RuntimeError("JavaScript error: " + self._str(ctx, exc))
        return val

    def run(self, script: str) -> str:
        if not self.lib:
            raise RuntimeError("JavaScriptCore isn't available: " + self.err)
        with self.lock:
            ctx = self.lib.JSGlobalContextCreate(None)
            try:
                self._eval(ctx, "var __ngOut=[];var console={log:function(){__ngOut.push(Array.prototype.map.call(arguments,String).join(' '))},"
                                "info:function(){},warn:function(){},error:function(){},debug:function(){}};")
                self._eval(ctx, script)
                return self._str(ctx, self._eval(ctx, "__ngOut.join('\\n')"))
            finally:
                self.lib.JSGlobalContextRelease(ctx)


JSC = _JSC()


def _js_eval(script: str) -> str:
    """JavaScriptCore on the iPhone; Node only when testing on a computer (NAGHAM_JSC_TEST=node)."""
    if JSC.lib is None and os.environ.get("NAGHAM_JSC_TEST") == "node":
        import subprocess
        pre = "var __ngOut=[];var console={log:function(){__ngOut.push(Array.prototype.map.call(arguments,String).join(' '))},info(){},warn(){},error(){},debug(){}};"
        r = subprocess.run(["node", "-"], input=pre + script + "\n;process.stdout.write(__ngOut.join('\\n'))", capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stderr[-500:])
        return r.stdout
    return JSC.run(script)


def _register_jsc_provider():
    """Teaches yt-dlp to solve YouTube's JS challenges with JavaScriptCore."""
    from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
    from yt_dlp.extractor.youtube.jsc.provider import register_preference, register_provider
    from yt_dlp.extractor.youtube.pot._provider import BuiltinIEContentProvider

    @register_provider
    class JavaScriptCoreJCP(EJSBaseJCP, BuiltinIEContentProvider):
        PROVIDER_NAME = "javascriptcore"
        JS_RUNTIME_NAME = "javascriptcore"

        def is_available(self, /) -> bool:
            return JSC.lib is not None or os.environ.get("NAGHAM_JSC_TEST") == "node"

        def _run_js_runtime(self, stdin: str, /) -> str:
            return _js_eval(stdin)

    @register_preference(JavaScriptCoreJCP)
    def _pref(provider, requests) -> int:
        return 2000


# ---------------------------------------------------------------- running yt-dlp

class _Lines:
    """A file-like object that turns yt-dlp's output into tagged lines for the caller."""

    def __init__(self, tag, emit):
        self.tag, self.emit, self.buf = tag, emit, ""
        self.encoding = "utf-8"

    def write(self, s):
        if not isinstance(s, str):
            s = s.decode("utf-8", "replace")
        self.buf += s.replace("\r", "\n")
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            if line.strip():
                self.emit(self.tag, line)
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False

    def fileno(self):
        raise OSError("no fileno")


_ready = threading.Event()
_import_error = ""


def _prepare():
    global _import_error
    try:
        import yt_dlp  # noqa: F401
        _register_jsc_provider()
    except Exception:
        _import_error = traceback.format_exc()
    _ready.set()


class Cancelled(Exception):
    pass


def run_ytdlp(args, emit, cancel: threading.Event) -> int:
    _ready.wait(60)
    if _import_error:
        emit("e", "ERROR: yt-dlp couldn't start: " + _import_error.strip().splitlines()[-1])
        return 1
    import yt_dlp
    from yt_dlp.utils import DownloadCancelled, Namespace

    try:
        parsed = yt_dlp.parse_options(list(args))
    except SystemExit as e:
        emit("e", "ERROR: bad options")
        return int(e.code or 2)
    opts = dict(parsed.ydl_opts)
    opts["js_runtimes"] = {}  # JavaScriptCore is used instead (see _register_jsc_provider)
    opts.setdefault("noprogress", False)

    def hook(_):
        if cancel.is_set():
            raise DownloadCancelled("cancelled")

    opts["progress_hooks"] = list(opts.get("progress_hooks") or []) + [hook]
    out, err = _Lines("o", emit), _Lines("e", emit)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl._out_files = Namespace(out=out, error=err, screen=out, console=None)
            if cancel.is_set():
                return 1
            code = ydl.download(parsed.urls)
    except DownloadCancelled:
        emit("e", "ERROR: cancelled")
        return 1
    except SystemExit as e:
        return int(e.code or 0)
    except Exception as e:  # yt-dlp normally reports errors itself; this is for crashes
        emit("e", f"ERROR: {type(e).__name__}: {e}")
        return 1
    out.write("\n")
    err.write("\n")
    return int(code or 0)


# ---------------------------------------------------------------- tags

def tag_file(path, title="", artist="", album="", cover=""):
    import mutagen
    from mutagen.id3 import APIC, ID3, TALB, TIT2, TPE1
    from mutagen.mp4 import MP4, MP4Cover

    img = b""
    if cover.startswith("http"):
        try:
            with urllib.request.urlopen(urllib.request.Request(cover, headers={"User-Agent": "Mozilla/5.0"}), timeout=15, context=_SSL) as r:
                img = r.read(8 << 20)
        except Exception:
            img = b""
    low = path.lower()
    if low.endswith((".m4a", ".mp4", ".aac")):
        f = MP4(path)
        if f.tags is None:
            f.add_tags()
        if title:
            f.tags["\xa9nam"] = [title]
        if artist:
            f.tags["\xa9ART"] = [artist]
        if album:
            f.tags["\xa9alb"] = [album]
        if img:
            fmt = MP4Cover.FORMAT_PNG if img[:4] == b"\x89PNG" else MP4Cover.FORMAT_JPEG
            f.tags["covr"] = [MP4Cover(img, imageformat=fmt)]
        f.save()
    elif low.endswith(".mp3"):
        try:
            tags = ID3(path)
        except Exception:
            tags = ID3()
        if title:
            tags.setall("TIT2", [TIT2(encoding=3, text=title)])
        if artist:
            tags.setall("TPE1", [TPE1(encoding=3, text=artist)])
        if album:
            tags.setall("TALB", [TALB(encoding=3, text=album)])
        if img:
            tags.setall("APIC", [APIC(encoding=3, mime="image/png" if img[:4] == b"\x89PNG" else "image/jpeg", type=3, desc="Cover", data=img)])
        tags.save(path)
    else:
        f = mutagen.File(path, easy=True)
        if f is None:
            return False
        if title:
            f["title"] = title
        if artist:
            f["artist"] = artist
        if album:
            f["album"] = album
        f.save()
    return True


# ---------------------------------------------------------------- the local web service

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _local(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        if not self._local():
            return self._json(403, {})
        if self.path.startswith("/health"):
            _ready.wait(60)
            v = ""
            try:
                from yt_dlp.version import __version__ as v
            except Exception:
                pass
            return self._json(200, {"ok": not _import_error, "ytdlp": v, "jsc": JSC.lib is not None,
                                    "error": _import_error.strip().splitlines()[-1] if _import_error else ""})
        self._json(404, {})

    def do_POST(self):
        if not self._local():
            return self._json(403, {})
        try:
            req = self._body()
        except Exception:
            return self._json(400, {"error": "bad json"})
        if self.path.startswith("/tag"):
            try:
                ok = tag_file(req.get("file", ""), req.get("title", ""), req.get("artist", ""), req.get("album", ""), req.get("cover", ""))
                return self._json(200, {"ok": ok})
            except Exception as e:
                return self._json(500, {"error": str(e)})
        if not self.path.startswith("/run"):
            return self._json(404, {})
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        cancel = threading.Event()
        lock = threading.Lock()

        def emit(tag, line):
            if cancel.is_set():
                return
            data = (tag + " " + line.replace("\n", " ") + "\n").encode("utf-8", "replace")
            with lock:
                try:
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(data), data))
                    self.wfile.flush()
                except OSError:  # the caller went away (song skipped, download cancelled)
                    cancel.set()

        code = run_ytdlp(req.get("args") or [], emit, cancel)
        emit("x", str(code))
        with lock:
            try:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except OSError:
                pass
        self.close_connection = True


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve(port: int = PORT):
    threading.Thread(target=_prepare, daemon=True).start()
    srv = Server(("127.0.0.1", port), Handler)
    print(f"nagham bridge on 127.0.0.1:{port}", flush=True)
    srv.serve_forever()


def start_in_background(port: int = PORT):
    """Called from the app (Swift) right after Python starts."""
    threading.Thread(target=serve, args=(port,), daemon=True, name="nagham-bridge").start()


if __name__ == "__main__":
    serve(int(sys.argv[1]) if len(sys.argv) > 1 else PORT)
