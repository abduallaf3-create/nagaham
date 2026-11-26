import Cocoa
import WebKit

/// "For you": a page of YouTube Music or Spotify inside Nagham's window. Normally hidden (behind
/// Nagham's page); shown only inside the small sign-in card. Nagham asks it for your home feed
/// with a script from the server (acctJS) and gets the answer back. Closed after 2 idle minutes.
final class AcctPanel: NSObject, WKNavigationDelegate, WKUIDelegate {
    private weak var host: NSView?
    private weak var mainWeb: NSView?
    private var page: WKWebView?
    private var base = ""
    private var js = ""
    private var navNow = -1
    private var taken = 0
    private var pending: [AcctReq] = []
    private var inflight = 0
    private var polling = false
    private var pollAt = Date.distantPast
    private var reqAt = Date()
    private var lastUse = Date()
    private var st: WinState?
    private var timer: Timer?

    init(host: NSView, main: NSView) {
        self.host = host
        self.mainWeb = main
        super.init()
    }

    func start(base: String) {
        self.base = base
        loadJS()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func loadJS() {
        guard let u = URL(string: base + "/api/yt/acct/js") else { return }
        URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
            guard let self = self else { return }
            if let d = data, let s = String(data: d, encoding: .utf8), s.contains("__REQ__") {
                DispatchQueue.main.async { self.js = s }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.loadJS() }
            }
        }.resume()
    }

    func apply(_ s: WinState) {
        st = s
        for r in s.acctReqs ?? [] where r.seq > taken {
            taken = r.seq
            pending.append(r)
            reqAt = Date()
        }
        let show = s.acctShow ?? false
        let want = (s.acctOpen ?? false) || show || !pending.isEmpty
        if !want { close(); return }
        lastUse = Date()
        if page == nil {
            create()
            navNow = s.acctNavSeq ?? 0
            if show, let n = s.acctNav, n.hasPrefix("https://") { load(n) }
            else if pending.first?.svc == "sp" { load("https://open.spotify.com/") }
            else { load("https://music.youtube.com/") }
        }
        place()
        if let seq = s.acctNavSeq, seq != navNow {
            navNow = seq
            let u = s.acctNav ?? ""
            load(u.hasPrefix("https://") ? u : "https://music.youtube.com/")
        }
    }

    private func load(_ u: String) {
        guard let url = URL(string: u) else { return }
        page?.load(URLRequest(url: url))
    }

    // shown: exactly over the sign-in card's box (the page gives physical pixels); hidden: behind Nagham's page
    private var placed = ""
    private func place() {
        guard let page = page, let host = host, let s = st else { return }
        let r = s.acctRect ?? [0, 0, 0, 0]
        let key = "\(s.acctShow ?? false)|\(r)|\(ObjectIdentifier(page).hashValue)"
        if key == placed { return }
        placed = key
        if (s.acctShow ?? false) && r.count == 4 && r[2] >= 100 && r[3] >= 100 {
            let scale = host.window?.backingScaleFactor ?? 2
            page.autoresizingMask = []
            page.frame = NSRect(x: CGFloat(r[0]) / scale, y: CGFloat(r[1]) / scale, width: CGFloat(r[2]) / scale, height: CGFloat(r[3]) / scale)
            page.alphaValue = 1
            host.addSubview(page, positioned: .above, relativeTo: nil)
            host.window?.makeFirstResponder(page)
        } else {
            page.frame = host.bounds
            page.autoresizingMask = [.width, .height]
            page.alphaValue = 0
            if let main = mainWeb { host.addSubview(page, positioned: .below, relativeTo: main) }
        }
    }

    private func create() {
        guard let host = host else { return }
        let cfg = WKWebViewConfiguration()
        cfg.mediaTypesRequiringUserActionForPlayback = [.all]
        cfg.websiteDataStore = .default() // the same sign-ins as the player
        let w = WKWebView(frame: host.bounds, configuration: cfg)
        w.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        w.navigationDelegate = self
        w.uiDelegate = self
        w.alphaValue = 0
        if let main = mainWeb { host.addSubview(w, positioned: .below, relativeTo: main) }
        page = w
        inflight = 0
        polling = false
    }

    private func close() {
        guard let p = page else { return }
        p.stopLoading()
        p.navigationDelegate = nil
        p.uiDelegate = nil
        p.removeFromSuperview()
        page = nil
        placed = ""
        navNow = -1
        polling = false
        inflight = 0
    }

    private func poll() {
        guard let page = page, !js.isEmpty else { return }
        let show = st?.acctShow ?? false
        if pending.isEmpty {
            if !show && Date().timeIntervalSince(lastUse) > 120 { close() } // idle: it's a whole web page
            return
        }
        lastUse = Date()
        if show { // signing in: only "are you signed in yet?" may run (nothing may move the page)
            guard let j = pending.firstIndex(where: { $0.kind == "status" }) else { reqAt = Date(); return }
            if j > 0 && !polling { pending.swapAt(0, j) }
        }
        let r = pending[0]
        if Date().timeIntervalSince(reqAt) > 45 {
            pending.removeFirst()
            reqAt = Date()
            send(r.seq, "{\"error\":\"the page didn't answer\"}")
            return
        }
        if polling && Date().timeIntervalSince(pollAt) < 5 { return }
        guard let rb = try? JSONEncoder().encode(r), let rs = String(data: rb, encoding: .utf8) else { return }
        let code = js.replacingOccurrences(of: "__REQ__", with: rs)
        polling = true
        pollAt = Date()
        inflight = r.seq
        page.evaluateJavaScript(code) { [weak self] result, _ in
            guard let self = self else { return }
            self.polling = false
            guard let out = result as? String, !out.isEmpty else { return } // not ready yet
            if let first = self.pending.first, first.seq == self.inflight {
                self.pending.removeFirst()
                self.reqAt = Date()
            }
            self.send(self.inflight, out)
        }
    }

    private func send(_ seq: Int, _ data: String) {
        var d = data
        if (try? JSONSerialization.jsonObject(with: Data(d.utf8), options: [.fragmentsAllowed])) == nil { d = "{\"error\":\"bad answer\"}" }
        guard let u = URL(string: base + "/api/yt/acct/result") else { return }
        var req = URLRequest(url: u)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = Data("{\"seq\":\(seq),\"data\":\(d)}".utf8)
        req.timeoutInterval = 10
        URLSession.shared.dataTask(with: req).resume()
    }

    // sign-in popups (Google / Apple…) stay in the same page
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { close() }
}
