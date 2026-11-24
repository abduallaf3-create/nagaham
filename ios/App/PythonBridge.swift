import Foundation

/// Starts the app's own Python with yt-dlp in it (python/app/naghambridge.py), so songs can play and
/// download straight from YouTube — no YouTube Music page, no ads.
enum PythonBridge {
    static func start() {
        guard let res = Bundle.main.resourcePath else { return }
        let fm = FileManager.default
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("python", isDirectory: true)
        try? fm.createDirectory(at: caches, withIntermediateDirectories: true)
        setenv("PYTHONHOME", res + "/python", 1)
        setenv("PYTHONPATH", res + "/app:" + res + "/app_packages", 1)
        setenv("PYTHONUTF8", "1", 1)
        setenv("PYTHONUNBUFFERED", "1", 1)
        setenv("PYTHONDONTWRITEBYTECODE", "1", 1)
        setenv("XDG_CACHE_HOME", caches.path, 1)
        setenv("HOME", fm.urls(for: .libraryDirectory, in: .userDomainMask)[0].path, 1)
        setenv("SSL_CERT_FILE", res + "/app_packages/certifi/cacert.pem", 1)
        setenv("NAGHAM_BRIDGE_PORT", "41790", 1)
        Py_Initialize()
        let code = """
        import sys, traceback
        try:
            import naghambridge
            naghambridge.start_in_background()
        except Exception:
            traceback.print_exc()
        """
        _ = code.withCString { PyRun_SimpleStringFlags($0, nil) }
        // let Python's own threads (the bridge) run from now on
        _ = PyEval_SaveThread()
    }
}
