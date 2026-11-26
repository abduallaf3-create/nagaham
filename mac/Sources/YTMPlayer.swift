import Cocoa
import WebKit

/// YouTube Music playing hidden inside Nagham's window: a second page, behind Nagham's own page,
/// that Nagham's page controls through the built-in server (the same way the PC window does it).
final class YTMPlayer: NSObject, WKNavigationDelegate, WKUIDelegate {
    private weak var host: NSView?
    private weak var mainWeb: NSView?
    private var page: WKWebView?
    private var base = ""
    private var urlNow = ""
    private var cmdNow = -1
    private var vol: Double = -1
    private var stateJS = ""
    private var polling = false
    private var pollAt = Date.distantPast
    private var timer: Timer?
    private var adRules: WKContentRuleList?

    init(host: NSView, below: NSView) {
        self.host = host
        self.mainWeb = below
        super.init()
        // block ad servers; the page script skips any ad that still comes
        let rules = #"""
        [{"trigger":{"url-filter":"doubleclick\\.net"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"googleadservices\\.com"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"googlesyndication\\.com"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"/pagead/"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"/api/stats/ads"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"/get_midroll_"},"action":{"type":"block"}}]
        """#
        WKContentRuleListStore.default()?.compileContentRuleList(forIdentifier: "nagham-ads", encodedContentRuleList: rules) { [weak self] list, _ in
            if let list = list { DispatchQueue.main.async { self?.adRules = list } }
        }
    }

    func start(base: String) {
        self.base = base
        loadStateJS()
        timer = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func loadStateJS() {
        guard let u = URL(string: base + "/api/ytm/js") else { return }
        URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
            guard let self = self else { return }
            if let d = data, let s = String(data: d, encoding: .utf8), s.contains("__VOL__") {
                DispatchQueue.main.async { self.stateJS = s }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.loadStateJS() }
            }
        }.resume()
    }

    func apply(_ st: WinState) {
        vol = (st.ytmVolSet ?? false) ? (st.ytmVol ?? -1) : -1
        let url = st.ytmUrl ?? ""
        let wanted = (st.ytmVisible ?? false) || (st.ytmHidden ?? false)
        // stopped, or another song: never reuse a page that has been playing
        if page != nil && !urlNow.isEmpty && url != urlNow { close() }
        if page == nil {
            guard !url.isEmpty && wanted else { return }
            create()
        }
        guard let page = page else { return }
        if !url.isEmpty && url != urlNow, let u = URL(string: url) {
            urlNow = url
            page.load(URLRequest(url: u))
        }
        if cmdNow < 0 { cmdNow = st.ytmCmdSeq ?? 0 } // commands from before this page existed don't apply
        for c in st.ytmCmds ?? [] where c.seq > cmdNow {
            cmdNow = c.seq
            page.evaluateJavaScript(c.js, completionHandler: nil)
        }
    }

    private func create() {
        guard let host = host else { return }
        let cfg = WKWebViewConfiguration()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default() // a YouTube sign-in stays
        if let r = adRules { cfg.userContentController.add(r) }
        // full size but behind Nagham's page: never seen, still "on screen" so it keeps playing
        let w = WKWebView(frame: host.bounds, configuration: cfg)
        w.autoresizingMask = [.width, .height]
        w.alphaValue = 0
        w.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        w.navigationDelegate = self
        w.uiDelegate = self
        if let main = mainWeb { host.addSubview(w, positioned: .below, relativeTo: main) } else { host.addSubview(w, positioned: .below, relativeTo: nil) }
        page = w
        cmdNow = -1
        polling = false
    }

    // closes the player completely (a page that is playing can refuse to navigate away)
    private func close() {
        guard let p = page else { return }
        p.evaluateJavaScript("document.querySelectorAll('video,audio').forEach(v=>{try{v.pause();v.removeAttribute('src');v.load()}catch(e){}})", completionHandler: nil)
        p.stopLoading()
        p.navigationDelegate = nil
        p.uiDelegate = nil
        p.removeFromSuperview()
        page = nil
        urlNow = ""
        cmdNow = -1
        polling = false
    }

    // asks the YouTube Music page what it's doing and passes it to Nagham (twice a second)
    private func poll() {
        guard let page = page, !urlNow.isEmpty, !stateJS.isEmpty else { return }
        if polling && Date().timeIntervalSince(pollAt) < 3 { return }
        polling = true
        pollAt = Date()
        let js = stateJS.replacingOccurrences(of: "__VOL__", with: String(format: "%.3f", vol))
        page.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self else { return }
            self.polling = false
            guard let dict = result as? [String: Any],
                  let body = try? JSONSerialization.data(withJSONObject: dict),
                  let u = URL(string: self.base + "/api/ytm/state") else { return }
            var req = URLRequest(url: u)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
            req.timeoutInterval = 3
            URLSession.shared.dataTask(with: req).resume()
        }
    }

    // YouTube Music's own popups / new windows: keep them in the same page
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }

    // "leave site?" and other dialogs nobody can see in a hidden player
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        close() // Nagham's page notices the song stopped and starts it again
    }
}
